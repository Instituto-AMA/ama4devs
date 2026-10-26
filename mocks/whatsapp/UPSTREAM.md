# Upstream Notes — Whap (WhatsApp Mock Server)

- **Upstream Repository:** [fdarian/whap](https://github.com/fdarian/whap)
- **Upstream Commit:** `0684423`
- **License:** Apache License, Version 2.0 (see `LICENSE`)
- **Date Copied:** 2026-10-26

## Notice of Modification (Apache License 2.0, Section 4.b)

In compliance with Section 4(b) of the Apache License, Version 2.0, notice is hereby given that files in this directory have been modified from their original upstream versions. Modified files carry this prominent notice through this file and the repository's git history.

## Modifications

This copy is maintained internally within `Instituto-AMA/test-utils-hub`. The following changes have been made to the original upstream code:

1. **Dependency Security & Stability Updates:**
   - Upgraded `hono`.
   - Upgraded `@effect/cli` and `effect` to 4.0.6, accommodating its CLI module relocation.
   - Upgraded `vitest` to version 4.
   - Upgraded `uuid` to version 14.
2. **Test Fixes:**
   - Fixed and stabilized unit and integration test assertions across the suite.
3. **Dynamic Graph API Version Routing:**
   - Updated routes to match any Graph API version dynamically using the path pattern `/:version{v[0-9]+\.[0-9]+}` (e.g. `/v22.0`, `/v23.0`, etc.) rather than hardcoding specific API versions.
4. **Webhook Localhost Rewriting (`WEBHOOK_LOCALHOST_REWRITE`):**
   - Added `rewriteLoopback` in `src/server/webhook-target.ts` to automatically replace loopback hostnames (`localhost`, `127.0.0.1`, `::1`) in webhook delivery URLs with `host.docker.internal` (or the configured `WEBHOOK_LOCALHOST_REWRITE` target).
5. **Port Configuration (`PORT`):**
   - Added environment variable support for `PORT` across the server bootstrap, HTTP listener, and Docker container health checks.
6. **Web Inspection Panel:**
   - Integrated an inline HTML web inspection panel served at `GET /` (`src/server/routes/panel.ts` and `src/server/ui/panel.ts`).
7. **Container Optimization:**
   - Pinned multi-stage Docker build to `oven/bun:1.4.2`.
   - Configured non-root execution under user `whap` (UID 1001).
8. **Tooling & Configuration Cleanup:**
   - Removed upstream repository-specific CI workflows, Cursor rules, and development configurations to integrate cleanly into `test-utils-hub`.
