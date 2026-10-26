# Mocks

This directory contains the provider mock implementations. Each mock operates as an independent service mimicking a third-party vendor API for local development and testing.

## The Mock Contract

Every mock added to this repository must follow these standards:

1. **Self-Contained Directory:** Located under `mocks/<name>` containing all server code, tests, and its own multi-stage `Dockerfile`.
2. **Pinned Base Image & Non-Root User:** The Dockerfile must use an explicitly pinned base image (e.g. `oven/bun:1.4.2-alpine` or `oven/bun:1.4.2`) and run container processes under a non-root user (e.g. `bun` or a dedicated system user).
3. **Health Check (`GET /health`):** Must expose an unauthenticated `GET /health` route returning HTTP 200 OK when operational.
4. **Port Configuration:**
   - A fixed container port (e.g. `45445` or `3010`).
   - A configurable host port variable in root `.env.example` (e.g. `<NAME>_PORT=<port>`).
5. **Docker Compose Profile Bound to Loopback:**
   - Defined in `docker-compose.yml` under a matching profile (`profiles: [<name>]`).
   - Ports must be bound strictly to loopback: `'127.0.0.1:${<NAME>_PORT:-...}:<container_port>'`.
6. **Webhook Host Rewriting:**
   - Must support `WEBHOOK_LOCALHOST_REWRITE` (typically `host.docker.internal`).
   - Any outgoing webhook URLs targeting loopback (`localhost`, `127.0.0.1`, `::1`) must have their hostname rewritten to allow container-to-host callbacks.
   - Compose services must include `extra_hosts: ['host.docker.internal:host-gateway']`.
7. **Control Routes with Local Guard:**
   - Key-free administrative and state-manipulation routes must live under a dedicated, non-API prefix (`/_mock/*` for new mocks; the WhatsApp mock uses `/mock` and `/webhook`).
   - Every mock must protect its key-free routes with a local guard that verifies the `Host` header on every request (DNS rebinding) and the `Origin` header on state-changing requests (cross-site requests) against an allowlist of local hostnames.
   - Both shipped mocks implement it: the Asaas mock guards `/`, `/_admin/*` and `/_mock/*`; the WhatsApp mock guards every route it serves, including the `/ws` upgrade.
   - The allowlist is the loopback defaults (`localhost`, `127.0.0.1`, `::1`, `host.docker.internal`) plus the comma-separated `MOCK_ALLOWED_HOSTS` (the Compose service names belong there).
8. **Automated Test Suite:**
   - Must include automated tests executed by `make test` (and individually via `bun test` inside the mock directory).
9. **Upstream Documentation:**
   - If adapted from an external repository, the mock must include an `UPSTREAM.md` documenting origin URL, commit hash, copy date, license, and modifications.
10. **Profile Entries:**
    - Must be represented in `profiles/generic/mock.env` and `profiles/generic/sandbox.env` (and any application-specific profiles).

---

## Step-by-Step Checklist: Adding a New Mock

Below is the standard walkthrough for adding a new mock, using an **e-mail gateway** (`email`) as an example:

### 1. Create the Mock Directory and Code

Create `mocks/email` with your server files and dependency configuration (`package.json`, etc.):

```
mocks/email/
├── Dockerfile
├── package.json
├── src/
│   ├── index.ts
│   ├── health.ts
│   └── mock/
└── tests/
```

### 2. Implement the Health Check and Local Control Routes

- Add `GET /health` returning `200 OK`.
- Add test-control routes under `/_mock/email/...` (e.g. `GET /_mock/email/messages`, `POST /_mock/email/simulate-bounce`).
- Protect `/` and `/_mock/*` routes using a local guard that checks incoming `Host` and `Origin` headers.

### 3. Implement Webhook Loopback Rewriting

When sending webhooks (such as bounce or delivery events), check `process.env.WEBHOOK_LOCALHOST_REWRITE`:
- If set, rewrite `http://localhost:...` or `http://127.0.0.1:...` to target `http://${WEBHOOK_LOCALHOST_REWRITE}:...`.

### 4. Create the Dockerfile

Add a multi-stage `mocks/email/Dockerfile` with a pinned base image and non-root execution:

```dockerfile
FROM oven/bun:1.4.2-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM oven/bun:1.4.2-alpine AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER bun
EXPOSE 8025
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD bun -e "await fetch('http://localhost:'+(process.env.PORT??8025)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "src/index.ts"]
```

### 5. Add Service to `docker-compose.yml`

In root `docker-compose.yml`, define the service under its profile:

```yaml
  email:
    build: ./mocks/email
    image: test-utils-hub/email:local
    profiles: [email]
    ports:
      - '127.0.0.1:${EMAIL_PORT:-8025}:8025'
    environment:
      PORT: 8025
      WEBHOOK_LOCALHOST_REWRITE: host.docker.internal
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    restart: unless-stopped
```

### 6. Declare Port in `.env.example`

In root `.env.example`, add:

```bash
# Host port of the email gateway mock.
EMAIL_PORT=8025
```

### 7. Update the Makefile

- Append the new mock name to `MOCKS`:
  ```makefile
  MOCKS ?= asaas whatsapp email
  ```
- Update the `status` target to probe the new mock's health endpoint:
  ```makefile
  status: env
  	...
  	for entry in asaas:$$asaas_port whatsapp:$$whatsapp_port email:$$email_port; do \
  	...
  ```
- Add the test command to the `test` target:
  ```makefile
  test:
  	@cd mocks/asaas && bun test
  	@cd mocks/whatsapp && bun run test
  	@cd mocks/email && bun test
  ```

### 8. Update Profiles

In `profiles/generic/mock.env`:
```bash
EMAIL_BASE_URL=http://localhost:${EMAIL_PORT}
```

In `profiles/generic/sandbox.env`:
```bash
EMAIL_BASE_URL=https://api.sandbox-email-provider.com
```

### 9. Document Upstream (if applicable)

If adapted from an existing repository, create `mocks/email/UPSTREAM.md` documenting origin URL, commit hash, copy date, license, and modifications.

### 10. Verify

Test the new mock end-to-end:
```bash
make build
make up MOCKS=email
make status
make test
make down
```
