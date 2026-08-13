# KITCO pilot handover — 2026-08-13

- Repo: `SiddheshKGupta/kitco-dealer-commerce-pilot`, branch `codex/kitco-pilot`.
- Supabase: project `lvbgpgsgotadoneyrtyt`, region `ap-south-1`. Live data: 136 dealers (includes VLCO), 641 offerings/colourways, 4,736 enabled sizes, 136 locations, 90 media mappings, Lee Cooper stock 1,732 pairs. Core, colourway, relationship-RLS, and atomic-submit migrations applied. Security advisors: no WARN/ERROR.
- Cloudflare: authenticated; private R2 bucket `kitco-dealer-commerce-private-media` created. Wrangler config already binds it as `CATALOGUE_MEDIA`.
- Local baseline before final two commits: 127/127 tests, typecheck and build green. Production Worker is Supabase/R2-backed; frontend routes are `/activate`, `/login`, `/products`, `/orders`, `/reports`, `/control`.
- Still required for a working cloud pilot: configure Worker secrets `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `RESEND_API_KEY`, `OTP_FROM_EMAIL`, `VLCO_TEST_EMAIL`, `ACTIVATION_ACCESS_CODE`; upload 90 Nike images to R2; deploy; run cloud smoke test.
- Never commit `.dev.vars`, secrets, source workbooks/PDFs, or `.kitco-ingestion/` output.

Commands from the worktree:

```powershell
npm.cmd test -- --run --testTimeout=20000
npm.cmd run typecheck
npm.cmd run build
$env:XDG_CONFIG_HOME=(Join-Path $PWD '.wrangler-config')
npm.cmd exec -- wrangler secret put SECRET_NAME
npm.cmd exec -- wrangler deploy
```

Cloud verification: `/api/health`; activation using VLCO + pilot access code; email OTP; catalogue; save draft; order OTP; submit; `/orders`; admin `/control`. If deployment is blocked, inspect `git status`, the latest commits, `docs/deploy/`, and `.dev.vars.example` first.
