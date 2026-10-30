FROM oven/bun:1.4.2-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM oven/bun:1.4.2-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4.2-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The codegen runs in the build, offline: it only reads the vendored spec. Asaas's
# spec endpoint answers 429 easily — fetching during the build would make the
# image irreproducible.
# The panel compiles into ONE file (`src/admin/ui.html`) and the runtime goes back to
# being just Bun serving that file — no static route, no cache-busting, no second
# thing that can 404 inside the container. This stage disappears after the COPY below.
RUN bun run codegen && bunx tsc --noEmit && bun run panel:check && bun run panel:build

FROM oven/bun:1.4.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

# Without this line the code's default applies (`./data/asaas.db`, inside /app), and the
# `VOLUME /data` below becomes decoration: a `docker run -v my-data:/data` mounts a
# volume that stays EMPTY, the database lives in the container's ephemeral layer and
# disappears on the first `docker rm` — with no error at all. The compose escaped it
# because it sets the variable by hand; whoever used `docker run` lost the data silently.
ENV DATABASE_PATH=/data/asaas.db

# Filled by scripts/publish.sh (repository root) when the image is published to GHCR.
ARG VERSION=dev
ARG REVISION=unknown

# `source` links the GHCR package to this repository.
# No comma in the description: publish.sh repeats it as a buildx annotation, a comma-separated value.
LABEL org.opencontainers.image.title="Asaas Mock Server - Asaas API sandbox simulator" \
      org.opencontainers.image.description="Asaas API mock server (v3 sandbox simulator) for local development and tests: customers and charges with Pix and bank slip and credit card - installments and subscriptions - webhooks delivered to localhost - payer e-mail and WhatsApp notifications - virtual clock." \
      org.opencontainers.image.source="https://github.com/Instituto-AMA/ama4devs" \
      org.opencontainers.image.vendor="Instituto-AMA ama4devs" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/spec ./spec
COPY --from=build /app/package.json ./

RUN mkdir -p /data && chown -R bun:bun /data /app
USER bun
VOLUME /data

EXPOSE 45445
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "await fetch('http://localhost:'+(process.env.PORT??45445)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "bun run db:migrate && bun src/index.ts"]
