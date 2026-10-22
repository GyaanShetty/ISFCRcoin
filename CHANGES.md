# Hardening pass (on top of the original build)

- **Fails closed:** with `NODE_ENV=production` (the Docker image) the node refuses to start without `ADMIN_TOKEN` (12+ chars), `FAUCET_SEED` and `INSTRUCTOR_SEED`. `ALLOW_INSECURE=1` overrides.
- **Join closed by default:** `OPEN_JOIN` now defaults to `0` (instructor-issued codes only), so students cannot mint unlimited faucet wallets. Setting it to `1` prints a warning.
- **Rate limits:** per-IP, in-memory, no new dependency. `RATE_JOIN_PER_MIN` (join + faucet, default 120) and `RATE_WRITE_PER_MIN` (other POSTs, default 1200); `0` turns a limit off (use for load tests from one machine).
- **Admin auth:** constant-time token comparison and a lockout after 10 failures in 5 minutes.
- **Input caps:** `/api/shares` accepts at most 500 nonces per request.
- **CORS** configurable via `CORS_ORIGINS`; `TRUST_PROXY=1` for tunnel-only deployments.
- **`/api/health`** endpoint for monitoring.
- New tests in `apps/node/test/hardening.test.ts`. All 43 core + 32 node tests pass.

Note: with the Cloudflare Tunnel and `TRUST_PROXY=0`, tunnel users share one rate-limit bucket; the defaults are generous enough for ~100 students.

# Second pass

- **Roster import (PESU stand-in):** `POST /api/admin/roster` plus a textarea on the admin page. Paste PESU IDs and each student joins with their own ID; with `OPEN_JOIN=0`, nobody else can join. This is weaker than real SSO (a student could type a classmate's ID), but it ties wallets to the class list without needing PESU access.
- **WebSocket cap** (1000 clients) and **join-code/name length caps**.
- **Security headers** (`nosniff`, `X-Frame-Options`, `Referrer-Policy`).
- **CI** workflow (`.github/workflows/ci.yml`): typecheck, tests, web build, Python vectors.
- Reviewed and left as is: gossip (only connects to operator-configured peers, and every block is validated), `/api/sessions` (leaderboards only, no tokens), CORS (open by default because the fork view calls the peer from the browser; set `CORS_ORIGINS` to restrict).
- Not built: real PESU SSO, BLE for Proof of Presence, Proof of Useful Work (all optional or stretch in the proposal).
