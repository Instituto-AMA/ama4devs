#!/usr/bin/env bash
# Builds the image of each named mock for linux/amd64 and linux/arm64 and pushes it to GHCR.
# The publish workflow runs it on every push to master that changes a mock; a person runs it
# through `make publish MOCKS=<name>` when the workflow cannot.
#
#   scripts/publish.sh asaas [whatsapp ...]
#   DRY_RUN=1 scripts/publish.sh asaas      # builds both platforms, pushes nothing
#
# Image: ghcr.io/instituto-ama/<mock>-mock. One image per version, two tags on it:
#   <version>     the mock's package.json version; a version tag never moves (projects pin it)
#   latest        the newest version, the same image
# A mock whose version is already published is not pushed at all: bump its package.json.
# So `latest` is always a version, and the registry holds no image without one.
#
# Needs `docker login ghcr.io` with write:packages (the workflow logs in with GITHUB_TOKEN).
# Outside CI it refuses a mock directory with uncommitted changes, so an image always matches
# a commit, and it builds with its own docker-container builder (the default `docker` driver
# builds one platform at a time). Heavy: amd64 runs under emulation on an ARM machine.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

REGISTRY="${REGISTRY:-ghcr.io/instituto-ama}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
SOURCE_URL="https://github.com/Instituto-AMA/ama4devs"
LOCAL_BUILDER="ama4devs"

[[ $# -gt 0 ]] || die "usage: scripts/publish.sh <mock> [<mock> ...] (mocks: $(cd "${ROOT_DIR}/mocks" && ls -d */ | tr -d / | tr '\n' ' '))"
require_cmd docker "Install Docker with the buildx plugin."
require_cmd git "Install git."

# builder_args — the buildx builder to use. CI gets one from docker/setup-buildx-action; a
# machine gets a docker-container builder, created on first use.
builder_args() {
  if [[ -n "${CI:-}" ]]; then
    return 0
  fi
  if ! docker buildx inspect "$LOCAL_BUILDER" >/dev/null 2>&1; then
    log "creating the multi-platform builder '${LOCAL_BUILDER}'"
    docker buildx create --name "$LOCAL_BUILDER" --driver docker-container >/dev/null
  fi
  local platforms
  platforms="$(docker buildx inspect --bootstrap "$LOCAL_BUILDER" | sed -n 's/^Platforms:[[:space:]]*//p' | head -1)"
  local wanted
  for wanted in ${PLATFORMS//,/ }; do
    # The advertised list is not the truth: a builder that emulates a platform
    # under qemu does not always name it (Docker Desktop on an ARM Mac builds
    # linux/amd64 with the emulator and omits it from the list). So the
    # capability is probed with a build of the platform itself.
    if ! grep -q "$wanted" <<<"$platforms" && ! builder_builds "$LOCAL_BUILDER" "$wanted"; then
      die "builder '${LOCAL_BUILDER}' cannot build ${wanted} (it builds: ${platforms}). Install the emulator once: docker run --privileged --rm tonistiigi/binfmt --install all"
    fi
  done
  printf '%s\n' "--builder" "$LOCAL_BUILDER"
}

# builder_builds BUILDER PLATFORM — whether the builder really builds for PLATFORM.
# A throwaway build of a one-line Dockerfile answers it: the RUN under
# emulation prints the architecture it ran as.
builder_builds() {
  local builder="$1" platform="$2" work
  work="$(mktemp -d)"
  printf 'FROM alpine:latest\nRUN uname -m\n' > "${work}/Dockerfile"
  local out
  out="$(docker buildx build --builder "$builder" --platform "$platform" --output type=cacheonly "$work" 2>&1)" && {
    rm -rf "$work"
    return 0
  }
  rm -rf "$work"
  # The build failed: the platform is not buildable, unless the failure was the
  # network (the image could not be pulled), which says nothing about the
  # platform itself.
  grep -qiE 'no matching manifest|not found|failed to resolve|network|timeout' <<<"$out" && return 0
  return 1
}

# package_version DIR — the "version" of DIR/package.json.
package_version() {
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$1/package.json" | head -1
}

# dockerfile_label DIR NAME — the value of the org.opencontainers.image.NAME label in DIR/Dockerfile.
dockerfile_label() {
  sed -n "s/.*org\.opencontainers\.image\.$2=\"\([^\"]*\)\".*/\1/p" "$1/Dockerfile" | head -1
}

publish() {
  local mock="$1" dir image version revision short description license
  dir="${ROOT_DIR}/mocks/${mock}"
  [[ -f "${dir}/Dockerfile" ]] || die "unknown mock '${mock}': mocks/${mock}/Dockerfile not found"
  if [[ -z "${CI:-}" && -n "$(git -C "$ROOT_DIR" status --porcelain -- "mocks/${mock}")" ]]; then
    die "mocks/${mock} has uncommitted changes: commit them first, a published image must match a commit"
  fi

  image="${REGISTRY}/${mock}-mock"
  version="$(package_version "$dir")"
  [[ -n "$version" ]] || die "mocks/${mock}/package.json has no version"
  revision="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  short="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
  # The index annotations repeat what the Dockerfile labels say about the mock.
  description="$(dockerfile_label "$dir" description)"
  license="$(dockerfile_label "$dir" licenses)"
  [[ -n "$description" && -n "$license" ]] || die "mocks/${mock}/Dockerfile lacks the org.opencontainers.image.description or .licenses label"
  [[ "$description" != *,* ]] || die "the description label of mocks/${mock}/Dockerfile has a comma, which splits a buildx annotation"

  if docker buildx imagetools inspect "${image}:${version}" >/dev/null 2>&1; then
    warn "${image}:${version} is already published and never moves: bump mocks/${mock}/package.json to publish (nothing pushed for ${short})"
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
      printf '::warning title=%s version not bumped::%s:%s already exists; nothing pushed\n' "$mock" "$image" "$version"
    fi
    return 0
  fi
  local tags=(--tag "${image}:${version}" --tag "${image}:latest")

  local output=(--push)
  if [[ -n "${DRY_RUN:-}" ]]; then
    output=()
  fi

  local builder=()
  while IFS= read -r arg; do
    [[ -n "$arg" ]] && builder+=("$arg")
  done < <(builder_args)

  log "==> ${image} ${version} (${short}) for ${PLATFORMS}${DRY_RUN:+, dry run}"
  # The index annotations are what GHCR reads on a multi-platform image: the source links the
  # package to this repository, the description shows on the package page.
  docker buildx build \
    ${builder[@]+"${builder[@]}"} \
    --platform "$PLATFORMS" \
    --build-arg "VERSION=${version}" \
    --build-arg "REVISION=${revision}" \
    --annotation "index:org.opencontainers.image.source=${SOURCE_URL}" \
    --annotation "index:org.opencontainers.image.description=${description}" \
    --annotation "index:org.opencontainers.image.licenses=${license}" \
    --annotation "index:org.opencontainers.image.version=${version}" \
    --annotation "index:org.opencontainers.image.revision=${revision}" \
    "${tags[@]}" \
    ${output[@]+"${output[@]}"} \
    "$dir"

  if [[ -z "${DRY_RUN:-}" ]]; then
    log "published ${image}: $(printf '%s ' "${tags[@]}" | sed "s#--tag ${image}:##g")"
  fi
}

for mock in "$@"; do
  publish "$mock"
done
