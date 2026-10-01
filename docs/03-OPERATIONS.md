# E. Setup and handoff

## E1. Prerequisites and platform notes

| Tool                             | Version                                                             | Needed for                                            |
| -------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Node.js / npm                    | ≥ 20 (22 tested) / ≥ 10                                             | everything                                            |
| PostgreSQL                       | 16 (client tools `pg_dump`, `psql` for backup scripts and one test) | database                                              |
| Docker + Compose                 | 24+ (optional)                                                      | `docker compose up -d db` instead of a local Postgres |
| Chromium (Playwright)            | installed by `npx playwright install chromium`                      | end-to-end tests                                      |
| JDK 17, Android Studio (SDK 34+) | optional                                                            | Android build                                         |
| macOS, Xcode 15+, CocoaPods      | optional                                                            | iOS build — **iOS cannot be built on Linux/Windows**  |

- **Linux / macOS:** everything runs natively. **Windows:** use WSL2 (recommended) or Docker for PostgreSQL; `scripts/*.sh` need a POSIX shell.
- `npm run db:local:start` starts a throw-away cluster in `.pgdata/` on port **54329** using locally installed PostgreSQL binaries (it creates the `yalasala_owner` superuser and `yalasala` database; as root it runs Postgres as the `postgres` OS user).
- External accounts are **not** needed for development or tests. For production you will need: a host, a managed PostgreSQL (or your own), an SMS/OTP provider, a payment service provider, optionally a speech-to-text and/or AI provider, a push provider, and for the mobile apps an Apple Developer Program membership and a Google Play developer account.

## E2. Local setup (clean machine)

```bash
git clone <repo> yalasala-uae && cd yalasala-uae
npm install
docker compose up -d db              # or: npm run db:local:start
cp .env.example .env                 # placeholders; defaults work locally
npm run db:reset                     # drop + migrate + seed (idempotent migrations, destructive reset)
npm run dev:server                   # terminal 1 → http://localhost:4000/api/health
npm run dev:web                      # terminal 2 → http://localhost:5173
```

Seeded accounts, the test OTP (`123456`) and a guided tour are in the README. `npm run db:migrate` alone applies pending migrations without touching data; `npm run db:seed` expects an empty (freshly migrated) database.

## E3. Tests, format, lint, static analysis

```bash
npm run format:check      # Prettier
npm run lint              # ESLint (server + web)
npm run typecheck         # tsc --noEmit, strict (server + web; Arabic dictionary completeness is a type error)
npm run test:server       # unit + integration + RLS/policy tests against real PostgreSQL (creates yalasala_test)
npm run test:web          # i18n tests
npm run test:e2e          # Playwright (own DB yalasala_e2e, API :4100, web :5273); first: cd web && npx playwright install chromium
```

Tests use `TEST_PG_BASE` (default `localhost:54329`) to find PostgreSQL; the role `yalasala_owner` must be a superuser in that cluster (as created by the Docker/local scripts and the CI service). CI (`.github/workflows/ci.yml`) runs all of the above.

## E4. Web build

```bash
npm run build                                   # tsc + vite → web/dist (static files)
VITE_API_BASE=https://api.example.ae npm run build -w web   # when the API is on another origin
```

Serve `web/dist` from any static host with an SPA fallback (`/index.html`) and reverse-proxy `/api` to the API (see `web/nginx.conf`; disable proxy buffering for the SSE endpoint `/api/events`). Add TLS and security headers at the proxy.

## E5. Android and iOS (Capacitor)

The native apps are the same web bundle in a WebView shell. `web/android` and `web/ios` were generated with `npx cap add`; **they have not been compiled in this repository's authoring environment** (no Android SDK / Xcode).

```bash
# API must be reachable from the phone: set an absolute API origin and allow it in CORS (the server already allows capacitor://localhost and https://localhost)
cd web
VITE_API_BASE=https://api.example.ae npm run build
npx cap sync                      # copies web/dist into the native projects, updates plugins
```

**Android**

```bash
npx cap open android              # Android Studio; Run ▶ on an emulator/device
# Release (AAB for Google Play):
keytool -genkeypair -v -keystore ~/yalasala-release.jks -alias yalasala -keyalg RSA -keysize 2048 -validity 10000   # keep OUTSIDE the repo; back it up
cd android && ./gradlew bundleRelease           # configure signing in android/app/build.gradle via a git-ignored keystore.properties
```

You are responsible for the keystore (losing it blocks updates unless you use Play App Signing), the package id (`ae.yalasala.app` in `capacitor.config.ts` — change before publishing), icons/splash, and the Play Data-safety form (declare location, phone number, messages, photos, audio).

**iOS** (macOS only)

```bash
npx cap open ios                  # Xcode: set Team, bundle id, signing; add Microphone/Location usage strings to Info.plist
# Product ▸ Archive → TestFlight / App Store Connect
```

Requires an Apple Developer Program membership. Add `NSMicrophoneUsageDescription` (voice notes) and `NSLocationWhenInUseUsageDescription` (optional location) before archiving. Native push needs `@capacitor/push-notifications` plus APNs/FCM keys and a server-side sender behind the notification boundary (not included). Apple may reject apps that are only a thin web wrapper — plan native value (push, camera/mic integration) before submission.

## E6. ZIP and GitHub export

```bash
npm run zip                       # → yalasala-uae-source.zip : only git-tracked files (no node_modules, .env, data)
git init -b main                  # if starting from the ZIP
git add -A && git commit -m "Yalasala UAE MVP"
git remote add origin git@github.com:<you>/yalasala-uae.git
git push -u origin main
```

The repository contains no secrets: `.env.example` has placeholders; the dev passwords in it only work against the local seed database and **must** be replaced in any shared environment. `git ls-files | xargs grep -nE "BEGIN (RSA|PRIVATE)|sk-ant|AKIA"` should return nothing.

## E7. Deployment options

All options need: PostgreSQL 16+, the API process (`node server/dist/index.js` after `npm run build -w server`), static web files, a writable media directory (or an S3-compatible adapter — see PROVIDERS), TLS.

1. **Single VM** (simplest): Docker Compose `--profile full` (images provided, not exercised here) or systemd + nginx. Backups via `scripts/backup.sh` on a timer.
2. **PaaS** (Render, Railway, Fly.io, …): API as a web service, managed Postgres, web as a static site with a `/api` rewrite. Set `NODE_ENV=production` and every variable in `.env.example`; the API **refuses to start** with dev secrets, and refuses `OTP_PROVIDER=mock` — implement the live adapter first.
3. **Cloud account** (AWS/Azure/GCP/others): same topology with managed DB + object storage. If data residency matters, choose a UAE region where available (verify with your provider and counsel).

Production checklist: strong random `AUTH_SECRET`, `MEDIA_SIGNING_SECRET`, `PAYMENT_WEBHOOK_SECRET`; distinct DB passwords for `yalasala_app`/`yalasala_service` (`APP_DB_PASSWORD`, `SERVICE_DB_PASSWORD`); TLS + HSTS; set `PUBLIC_WEB_ORIGIN`; run `npm run db:migrate` on release (idempotent, forward-only); schedule `POST /api/admin/jobs/run` (or rely on the hourly in-process job) for retention/expiry; run **one** API instance until the rate limiter and event bus are externalised. If your managed Postgres forbids `BYPASSRLS`, run the service pool as the table owner (RLS is enabled, not forced).

## E8. Data export, backup, restore, migration

| Need                                   | Command                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portable JSON export (all tables)      | `npm run export:data` → `exports/<timestamp>/<table>.json` (OTP hashes excluded)                                                                                                                                                |
| Per-user export (data-subject request) | `POST /api/me/export` (account → "Download my data"); read through the user's own RLS scope                                                                                                                                     |
| Per-merchant export                    | `GET /api/merchant/export` (Reports → Export)                                                                                                                                                                                   |
| Backup (restorable)                    | `DATABASE_URL=postgres://owner@host/db npm run backup` → `backups/*.dump` (custom format)                                                                                                                                       |
| Restore into an empty database         | create the DB → ensure roles exist (run `npm run db:migrate` once against it, or create `yalasala_app` (NOBYPASSRLS) and `yalasala_service` (BYPASSRLS)) → `bash scripts/restore.sh backups/x.dump postgres://owner@host/newdb` |
| Migrate to another PostgreSQL host     | backup → restore on the new host (as above) → set the three `*_DATABASE_URL`s → `npm run db:migrate` (no-op if current) → copy `STORAGE_DIR` (or sync the bucket) → smoke-test → switch traffic                                 |
| Verify a restore                       | row counts of `users, products, orders, order_items, loyalty_ledger, audit_logs` and `select count(*) from pg_policies` (the automated test `pg_dump + restore…` does exactly this)                                             |

Media files (photos, voice) live in `STORAGE_DIR` (default `./storage`), **not** in PostgreSQL — back them up with the database. This procedure was run successfully in the authoring environment (backup → restore into a fresh database → row counts and policies match).

## E9. External services and realistic cost notes

Indicative only — verify current pricing and UAE availability with each provider before budgeting.

| Service                                  | Needed for                  | Cost drivers                                                                                                           |
| ---------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Hosting (API + static web)               | production                  | small VM/PaaS: tens of USD per month for a pilot                                                                       |
| Managed PostgreSQL                       | production                  | roughly 15–60 USD per month for a small HA-less instance; backups/PITR cost extra                                      |
| SMS OTP                                  | sign-in                     | per message; UAE destinations are among the more expensive. Estimate messages = sign-ins × 1–2                         |
| Payment service provider                 | cards, Apple/Google Pay     | percentage + fixed fee per transaction, possible monthly fee, onboarding/KYB; PCI scope stays small with hosted fields |
| Speech-to-text (optional)                | voice transcription         | per audio minute; Arabic dialect quality varies by vendor — evaluate before choosing                                   |
| AI parsing (optional)                    | natural-language assistance | per request; negligible at pilot volume. The rules engine works without it                                             |
| Push notifications                       | native apps                 | FCM/APNs are free; development effort is the cost                                                                      |
| Apple Developer Program                  | iOS distribution            | annual fee                                                                                                             |
| Google Play developer account            | Android distribution        | one-time fee                                                                                                           |
| Domain, TLS, monitoring, backups storage | production                  | small recurring costs                                                                                                  |
| **Not a service but real cost**          | delivery operations         | courier costs, merchant onboarding, support — unit economics are not modelled in the MVP (see roadmap)                 |
