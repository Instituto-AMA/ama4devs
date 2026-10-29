# The SMS mock has no runtime dependency: Bun runs the server straight from the
# sources, so the image needs no `bun install` and no build stage.
FROM oven/bun:1.4.2-alpine
WORKDIR /app
ENV NODE_ENV=production

# Filled by scripts/publish.sh (repository root) when the image is published to GHCR.
ARG VERSION=dev
ARG REVISION=unknown

# `source` links the GHCR package to this repository.
# No comma in the description: publish.sh repeats it as a buildx annotation, a comma-separated value.
LABEL org.opencontainers.image.title="SMS Mock - SMS gateway simulator for tests" \
      org.opencontainers.image.description="SMS gateway simulator for local development and tests - native and Twilio-compatible send APIs - message lifecycle with status and inbound webhooks - magic numbers for failures - OTP code extraction - live phone-inbox panel. Simulador local de SMS." \
      org.opencontainers.image.source="https://github.com/Instituto-AMA/ama4devs" \
      org.opencontainers.image.vendor="Instituto-AMA ama4devs" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

COPY package.json ./
COPY src ./src
COPY public ./public

USER bun

EXPOSE 3020
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
  CMD bun -e "await fetch('http://localhost:'+(process.env.PORT??3020)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "src/server.ts"]
