# Upstream Notes — Asaas Mock Server

- **Upstream Repository:** [theoxys/asaas-mock-server](https://github.com/theoxys/asaas-mock-server)
- **Upstream Commit:** `14fa00e`
- **License:** MIT (see `LICENSE`)
- **Date Copied:** 2026-10-26

## Modifications

This copy is maintained internally within `Instituto-AMA/test-utils-hub`. The following changes have been made to the original upstream code:

1. **Dependency Security Updates:**
   - Upgraded `drizzle-orm` to version 0.45 along with in-range patch and minor dependency security updates.
2. **Mock Payment Control Routes (`/_mock`):**
   - Added test-control endpoints under `/_mock/payments` (`GET /_mock/payments`, `POST /_mock/payments/:id/confirm`, `POST /_mock/payments/:id/receive`, `POST /_mock/payments/:id/overdue`, `POST /_mock/payments/:id/fail`, `POST /_mock/payments/:id/refund`) allowing automated test harnesses to drive payment status transitions deterministically across accounts without requiring authentication tokens.
3. **Refund Bank Slip Handler (`refund-bank-slip`):**
   - Implemented the `POST /v3/payments/:id/bankSlip/refund` handler (`refund-bank-slip`) for processing boleto refund flows through `applyTransition`.
4. **Extra Root Accounts Seeding (`SEED_EXTRA_ACCOUNTS`):**
   - Added support for seeding multiple root accounts on startup via the `SEED_EXTRA_ACCOUNTS` environment variable (`apiKey|name|cpfCnpj` separated by `;`), providing deterministic multi-tenant setup for end-to-end test suites.
5. **Local Route Guard (`localGuard`):**
   - Added `localGuard` middleware on `/`, `/_admin/*`, and `/_mock/*` routes, enforcing Host and Origin header validation against allowed local hosts to prevent DNS rebinding and cross-site requests.
6. **Container Optimization:**
   - Pinned Dockerfile base image to `oven/bun:1.4.2-alpine`.
   - Added a separate `prod-deps` multi-stage build layer to ensure production images contain only runtime dependencies.
   - Pinned persistent database path to `/data/asaas.db` with non-root `bun` ownership.
