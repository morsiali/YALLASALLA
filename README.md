# Yalasala UAE — يلا سلة

**Conversational smart commerce for UAE households.** Tell us your area, household size, duration and budget (or just describe the need in English or Arabic). We build an editable basket from real, in-stock local products, explain every choice, protect your budget, and never order without your approval.

```
Need or conversation → Smart basket → Optimization → Approval → Order → Tracking → Repeat
```

This repository is a complete, runnable, exportable MVP: bilingual (Arabic RTL / English LTR) web app, Android and iOS shells, a typed API, a PostgreSQL schema with row-level security, seed data, and automated tests. It runs with **no paid credentials** — SMS, payments, voice transcription and AI all have clearly labelled test/sandbox adapters.

## Honest status (read this first)

| Area                                                                                                                                                                               | Status                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Customer, merchant, staff, support and admin flows (browse → build → edit → substitute → checkout → fulfil → track → points → repeat; merchant onboarding; admin review and audit) | **Working and covered by automated tests** (see `docs/04-ACCEPTANCE.md`)                  |
| Arabic RTL / English LTR on every screen, state kept across language switches                                                                                                      | **Working, tested in a real browser**                                                     |
| Totals, delivery, budget status, loyalty ledger and order transitions                                                                                                              | **Validated server-side and in the database** (constraints, triggers, RLS)                |
| Android and iOS apps                                                                                                                                                               | **Capacitor shells generated around the same web app. Not built or run in this sandbox.** |
| Docker images (`docker compose --profile full`)                                                                                                                                    | Written, **not exercised** (no Docker daemon in the authoring environment)                |
| SMS (OTP), card payments, voice transcription, live AI                                                                                                                             | **Test/sandbox adapters only.** Live adapters must be implemented (`docs/PROVIDERS.md`)   |
| Legal text, UAE privacy/commerce compliance, payment-provider contract, delivery operations                                                                                        | **Not done** — see "Needs qualified review" in `docs/SECURITY.md`                         |

### Deliberate deviation from the suggested stack

The brief suggested Flutter. The authoring environment has no Flutter/Dart SDK, so Flutter code could not have been compiled, run or tested here, and an unverified app contradicts the brief's own rule ("a smaller platform that genuinely works"). I chose **React + TypeScript (Vite) PWA, wrapped for Android/iOS with Capacitor**, on **Node/Fastify + PostgreSQL**:

- one codebase for web, Android and iOS (the native apps are the same bundle in a WebView shell);
- first-class RTL via CSS logical properties and typed dictionaries, verified in Chromium (including axe accessibility checks);
- the API is plain REST/JSON, so a Flutter (or native) client can be added later without touching the backend.

Trade-offs: a WebView shell is not as polished as a native Flutter app (no native camera/mic pipelines, push notifications need a plugin, store review for thin wrappers). Supabase was replaced by a small typed Fastify service plus plain PostgreSQL with RLS, which is more portable and fully testable offline; `docs/02-ARCHITECTURE.md` explains the RLS design and how it maps onto Supabase if you prefer it.

## Quick start (about 5 minutes)

Prerequisites: **Node.js ≥ 20** (22 recommended), **npm ≥ 10**, and **PostgreSQL 16** — either Docker or a local install.

```bash
git clone <your-repo-url> yalasala-uae && cd yalasala-uae
npm install

# 1) database (pick one)
docker compose up -d db                 # option A: Docker (port 54329)
npm run db:local:start                  # option B: local postgres binaries, no Docker (Linux/macOS)

# 2) schema + seed data
cp .env.example .env                    # placeholders only; defaults already work locally
npm run db:reset                        # drops, migrates (db/migrations) and seeds

# 3) run (two terminals)
npm run dev:server                      # API on http://localhost:4000
npm run dev:web                         # app on http://localhost:5173
```

Open http://localhost:5173. The first visit asks for your area (location is optional; manual choice always works).

### Seeded accounts (local seed only)

Sign in with the phone number; in test mode the SMS code is always **`123456`** (the app and README say so — nothing is sent).

| Role                           | Phone (type as `05…`)             | Notes                                                                          |
| ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------ |
| Customer (Layla, Arabic)       | `0500000001`                      | Has a delivered past order, points and an address — try **Repeat this basket** |
| Customer (Omar, English)       | `0500000002`                      | Clean account                                                                  |
| Merchant owner — Marina Fresh  | `0500000011`                      | Business 1, "Growth" package                                                   |
| Merchant staff — Marina Fresh  | `0500000012`                      | Scoped: orders + conversations only                                            |
| Merchant owner — Barsha Family | `0500000013`                      | Business 2                                                                     |
| Merchant — pending application | `0500000014`                      | Awaiting admin review                                                          |
| Administrator                  | `0500000099`                      | Full admin console                                                             |
| Support                        | `0500000098`                      | Orders, disputes, reports only                                                 |
| New customer / business        | any other `05XXXXXXXX` UAE mobile | Creates an account; choose "Business" on the sign-in screen to onboard a store |

Pilot zones: **Dubai Marina + JLT** (Marina Fresh Market) and **Al Barsha + JLT** (Barsha Family Grocers). Downtown, Business Bay, Sharjah, Ajman and Abu Dhabi exist in the list but are **not served** — they demonstrate the unsupported-area recovery flow.

## What to try

1. **Guest basket:** Home → _Build My Basket_ → area, 4 people, 1 week, budget AED 500 _including delivery_ → read **Why this basket?** and **Basket health**, change quantities, **Replace** an item (exact price effect shown).
2. **Budget honesty:** set the budget to AED 80 → we state the shortfall, protect essentials and offer options. At checkout an over-budget basket needs explicit approval.
3. **Checkout:** sign in as a customer; try the sandbox card outcomes (succeeds / declined / pending confirmation / provider outage).
4. **Merchant:** sign in as `0500000011` → Orders → advance statuses; _Mark unavailable_ on an item and propose a replacement; the customer approves it on the order screen.
5. **Messaging + voice:** open a store → _Message store_; record a voice note, allow transcription, enter test-mode text (use `[?word?]` to mark an uncertain word) → _Turn into a basket_.
6. **Admin:** `0500000099` → approve the pending merchant, edit basket rules / loyalty rules / packages (reason required), read the audit log.
7. **Switch language** at any point; nothing is lost.

## Commands

| Task                                                      | Command                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Install                                                   | `npm install`                                                             |
| Start / stop local PostgreSQL (no Docker)                 | `npm run db:local:start` / `npm run db:local:stop`                        |
| Apply migrations / seed / reset all                       | `npm run db:migrate` / `npm run db:seed` / `npm run db:reset`             |
| Run API / web                                             | `npm run dev:server` / `npm run dev:web`                                  |
| Format (write / check)                                    | `npm run format` / `npm run format:check`                                 |
| Lint, static analysis (TypeScript strict)                 | `npm run lint` · `npm run typecheck`                                      |
| Server unit + integration + RLS/policy tests              | `npm run test:server` (needs PostgreSQL; creates `yalasala_test`)         |
| Web unit tests                                            | `npm run test:web`                                                        |
| End-to-end tests (own DB `yalasala_e2e`, ports 4100/5273) | `cd web && npx playwright install chromium` once, then `npm run test:e2e` |
| Production web build                                      | `npm run build` (output `web/dist`)                                       |
| Export all data as JSON                                   | `npm run export:data` → `exports/<timestamp>/`                            |
| Backup / restore PostgreSQL                               | `npm run backup` / `bash scripts/restore.sh <dump> <url>`                 |
| Regenerate UX copy and licence docs                       | `npm run docs:ux` · `npm run docs:licenses`                               |
| Source ZIP                                                | `npm run zip` → `yalasala-uae-source.zip` (git-tracked files only)        |

Android, iOS, deployment, backup/restore/migration, GitHub export and cost notes are in **`docs/03-OPERATIONS.md`**.

## Repository map

```
db/migrations/        SQL schema, constraints, indexes, RLS policies, triggers (001, 002)
server/src/
  domain/             pure, tested business logic: pricing, budget status, basket engine, NL parser
  providers/          provider interfaces + mock/sandbox adapters (OTP, payments, AI, transcription, storage, geo)
  services/           orders, loyalty, jobs, loaders (privileged workflows)
  http/routes/        auth, public, baskets, orders, messaging, me, merchant, admin, webhooks
  seed/               bilingual seed catalog, stores, packages, rules, accounts
server/test/          121+ tests against a real PostgreSQL
web/src/              React app: i18n (EN/AR), state, components, customer/merchant/admin pages
web/e2e/              Playwright journeys (EN/AR, mobile, axe accessibility)
web/android, web/ios  Capacitor native shells (generated)
scripts/              local postgres, backup/restore, zip, doc generators, placeholder art
docs/                 product, architecture, operations, acceptance, roadmap, security, providers, UX copy
.github/workflows/    CI: format, lint, typecheck, server tests, web tests, e2e
```

## Documents

| Document                  | Contents                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `docs/01-PRODUCT.md`      | A. product definition, assumptions, MVP vs later, risks · B. journeys, sitemap, screen specs, RTL/LTR behaviour                  |
| `docs/UX-COPY.md`         | Production bilingual copy (833 strings) for every screen, validation, budget warning, substitution, checkout, privacy, errors    |
| `docs/02-ARCHITECTURE.md` | C. decisions & trade-offs, modules, data model, permission matrix, RLS, AI + rules fallback, providers, security/retention/audit |
| `docs/03-OPERATIONS.md`   | E. setup, platforms, builds, ZIP/GitHub, deployment, backup/restore/migration, external services and costs                       |
| `docs/04-ACCEPTANCE.md`   | F. every acceptance criterion mapped to an automated test                                                                        |
| `docs/05-ROADMAP.md`      | G. phased roadmap with dependencies, success criteria and deferral reasons                                                       |
| `docs/SECURITY.md`        | Threat model, privacy, retention, limitations, items needing legal review                                                        |
| `docs/PROVIDERS.md`       | Provider interfaces, test/sandbox/live boundary, how to add live adapters                                                        |
| `THIRD_PARTY_LICENSES.md` | Dependency and asset licences (generated)                                                                                        |

## Known limitations (also listed where relevant in the docs)

- Single-store baskets only; the product says so wherever it matters. Multi-store splitting is a later phase.
- Real-time uses Server-Sent Events from a single API instance. Scale-out needs PostgreSQL `LISTEN/NOTIFY` or Redis (and a shared rate limiter).
- Card payments are sandbox-only; no raw card data ever touches the server. Substitutes that cost more are refused on prepaid orders (a documented limitation).
- Messages are protected in transit (TLS in production) and at rest by your database/disk encryption; they are **not** end-to-end encrypted, and the product never claims they are.
- Delivery fees, ETAs and opening hours are whatever the store configured; there is no courier routing or live map.
- The auth token is kept in `localStorage` for simplicity (documented XSS trade-off); production hardening notes are in `docs/SECURITY.md`.
- Voice transcription runs in test mode: the "transcript" is text the tester types, clearly labelled. No audio understanding is claimed.

## License

MIT — see `LICENSE`. No credentials, keys, certificates or production data are included. All demo brands are invented.
