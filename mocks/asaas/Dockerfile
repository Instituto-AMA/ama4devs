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
# O codegen roda no build, offline: lê só a spec vendorizada. O endpoint da spec
# do Asaas responde 429 com facilidade — buscar durante o build tornaria a
# imagem irreprodutível.
# O painel compila para UM arquivo (`src/admin/ui.html`) e o runtime volta a ser só
# Bun servindo esse arquivo — sem rota de estáticos, sem cache-busting, sem uma segunda
# coisa que pode 404 dentro do container. Este stage some depois do COPY lá embaixo.
RUN bun run codegen && bunx tsc --noEmit && bun run panel:check && bun run panel:build

FROM oven/bun:1.4.2-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

# Sem esta linha o default do código vale (`./data/asaas.db`, dentro de /app), e o
# `VOLUME /data` abaixo vira decoração: um `docker run -v meus-dados:/data` monta um
# volume que fica VAZIO, o banco vive na camada efêmera do container e some no
# primeiro `docker rm` — sem erro nenhum. O compose escapava porque define a
# variável na mão; quem usasse `docker run` perdia os dados em silêncio.
ENV DATABASE_PATH=/data/asaas.db

# Filled by scripts/publish.sh (repository root) when the image is published to GHCR.
ARG VERSION=dev
ARG REVISION=unknown

# `source` links the GHCR package to this repository.
# No comma in the description: publish.sh repeats it as a buildx annotation, a comma-separated value.
LABEL org.opencontainers.image.title="Asaas Mock Server - Asaas API sandbox simulator" \
      org.opencontainers.image.description="Asaas API mock server (v3 sandbox simulator) for local development and tests: customers and charges with Pix and boleto and credit card - installments and subscriptions - webhooks delivered to localhost - payer e-mail and WhatsApp notifications - virtual clock. Simulador local do Asaas." \
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
