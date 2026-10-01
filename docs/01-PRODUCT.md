# A. Product definition · B. Experience and journeys

## A1. Positioning

Yalasala UAE is a **conversational smart-commerce platform** that connects UAE households with verified local grocery and household stores. Its unit of commerce is the **basket**, not the product: a customer expresses a household need, receives an editable basket built from _real_ merchant inventory, sees why each choice was made, adjusts it directly or in conversation with the store, approves the final cost, and orders. Messaging exists to clarify needs, ask merchants questions and approve substitutions — it is the interaction layer, not the product.

It is not a generic quick-commerce app, not a marketplace clone, not an open customer-to-customer market, and not an "AI" demo: every number and reason shown maps to stored data or a recorded engine decision.

## A2. Core value proposition

> **EN:** Your household essentials, planned around your needs and budget.
> **AR:** احتياجات بيتك في سلة محسوبة على احتياجاتك وميزانيتك

Build the most suitable household basket from available local products within a clearly defined budget, let the customer discuss and change it easily, and **never order or exceed the budget without explicit approval.**

Differentiators that are actually implemented: budget scope chosen up front (total incl. delivery vs. products only) · server-validated totals after every edit · honest shortfall + recovery options · "Why this basket?" and "Basket health" derived from engine facts · per-order substitution policy with approval workflow · transparent points ledger with pending/available/reversal states · repeat-basket preview of price/availability changes · bilingual RTL/LTR throughout.

## A3. Segments

| Segment                                             | Need                                                                 | How the MVP serves it                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Families managing weekly/monthly consumption        | Predictable AED spend, quantities that fit household size            | Household/duration quantity rules, budget scope, repeat basket                     |
| Working professionals / people living alone         | Minimal time to a useful basket                                      | Natural-language input (EN/AR), single-person ready basket, saved baskets          |
| Budget-conscious households                         | Price transparency, no surprises                                     | Value tier, cheaper alternatives with exact effect, shortfall explanation          |
| Expatriates / shared apartments                     | Arabic/English, manual location, UAE mobile sign-in                  | Full bilingual UI, manual area choice, `+971 5X` verification                      |
| Parents                                             | Baby essentials, allergens                                           | Baby basket, hard allergen/diet filters, baby-safe tags                            |
| **Merchants** (neighbourhood grocers, small chains) | Reach, fewer back-and-forth calls, manageable orders                 | Onboarding, catalog/stock/price tools, order queue, substitution requests, reports |
| **Platform operators**                              | Verify merchants, tune rules, resolve disputes, audit sensitive acts | Admin console with reasons + audit log, configurable packages/rules/loyalty        |

## A4. Explicit assumptions (and their risks)

| #   | Assumption                                                                                                      | Risk if wrong → mitigation                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Launch in **two pilot zones** (Marina/JLT, Al Barsha/JLT) with two merchants                                    | Coverage claims must never exceed this. UI lists unserved areas as "not delivering yet"                |
| 2   | **One store per basket** (no cross-store split)                                                                 | Some baskets are incomplete → engine reports `essential_unavailable`; compare-stores exists            |
| 3   | Stores keep stock/prices current                                                                                | Stale stock → server re-checks at checkout and reports `ITEMS_UNAVAILABLE`; merchant substitution flow |
| 4   | Quantity rules (units per person per week) are a sound first approximation                                      | Over/under-buying → rules are admin-editable with audit; validate in interviews (see below)            |
| 5   | Customers accept "ask before substituting" as default                                                           | Conversion drag → policy is a per-order choice; `auto` works within configurable price limits          |
| 6   | Cash on delivery + sandbox card for the demo; live PSP later                                                    | Real payment needs a PSP contract + PCI scope review (`docs/PROVIDERS.md`)                             |
| 7   | Delivery fees/ETAs are store-defined; no courier network                                                        | No on-time metric yet; ETAs are labelled as estimates                                                  |
| 8   | Loyalty points: 1 pt per AED of products on _delivered_ orders, 3-day hold, 100 pts = AED 1, ≤ 20 % of a basket | Economics unvalidated → all values are admin-configurable; daily earn cap limits abuse                 |
| 9   | OTP-only sign-in (no passwords)                                                                                 | SIM-swap/number recycling risk; acceptable for MVP, see `docs/SECURITY.md`                             |
| 10  | Seed product names/brands are invented; Arabic names are plain MSA                                              | Real catalogs need merchant-supplied Arabic names and photos                                           |

## A5. Working MVP vs later features

| Capability                                                                  | MVP (implemented, tested)             | Later phase                                             |
| --------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| Bilingual responsive web app; Android/iOS shells                            | ✅ (native shells not built here)     | Native/Flutter client if WebView limits bite            |
| Phone OTP auth, roles, scoped staff                                         | ✅ (OTP in test mode)                 | Live SMS provider, device binding, passkeys             |
| Service areas, manual + permission-based location                           | ✅                                    | Address search / map pin                                |
| Merchant onboarding, packages (data-driven), catalog, stock, offers         | ✅ (image upload ❌: placeholder art) | Media library, bulk CSV import                          |
| Storefronts, discovery, search/filter, product pages                        | ✅                                    | Ranking, promotions, ads                                |
| 1:1 messaging: text, image, voice, sent/read, references, block/report      | ✅                                    | Typing indicators, delivered receipts, push             |
| Voice transcription with consent                                            | ✅ test mode only                     | Production STT with dialect handling                    |
| Guided + natural-language basket builder, deterministic engine, optional AI | ✅                                    | Personalisation, predictive replenishment               |
| Budget rules, shortfall recovery, why-this-basket, basket health            | ✅                                    | —                                                       |
| Alternatives, substitution policies and approvals                           | ✅                                    | Learned substitution preferences                        |
| Ready baskets (6 templates), saved baskets, repeat basket                   | ✅                                    | Subscriptions / scheduled replenishment                 |
| Checkout, sandbox/COD payments, idempotent orders, webhooks, refunds        | ✅                                    | Live PSP, Apple/Google Pay, partial captures            |
| Order workflow + tracking (status based)                                    | ✅                                    | Courier assignment, live map, route optimisation        |
| Loyalty ledger (append-only), pending/available/redeem/reverse/expire       | ✅                                    | Tiers, partner rewards                                  |
| Disputes, reports, moderation (reported-conversation access), audit log     | ✅                                    | SLA tooling, case management                            |
| Privacy: consents, export, deletion, retention job                          | ✅                                    | DSAR workflow tooling                                   |
| Analytics events + admin KPIs                                               | ✅ (subset)                           | Warehouse, cohort retention (7/30/60 d), unit economics |
| Customer-to-customer selling                                                | ❌ deliberately out of scope          | After identity, moderation, disputes (`docs/05`)        |
| Multi-store baskets, nationwide coverage, owned warehousing                 | ❌                                    | Only with validated demand and operations               |

## A6. Main risks, contradictions and items needing validation

1. **"Never exceed the budget" vs. "never promise what we can't do".** If essentials alone exceed the budget the engine returns a basket _over_ budget and says so (shortfall, options). The only ways to exceed are an explicit customer approval or editing the basket. After an order is placed the delivery fee can never increase because of a store stock-out (`recalcOrder` takes the lower of the agreed and recomputed fee).
2. **Personalisation vs. privacy.** Personalisation is opt-in (consent record); the MVP stores only explicit preferences, not behavioural profiles.
3. **Messaging scale vs. cost/abuse.** Rate limits, upload sniffing, block/report and package reply limits exist; real abuse tooling (spam classifiers, shadow bans) is later.
4. **Substitution fairness.** Prepaid orders refuse pricier substitutes (cannot capture more without a stored token). Cash orders allow approved increases.
5. **Merchant data quality** (stale stock, wrong allergens) is the largest operational risk; allergen/diet tags are merchant-declared and need a verification process before public launch.
6. **Quantity model accuracy** needs user research: cultural cuisine, guests, Ramadan/Eid peaks are not modelled.
7. **Legal**: UAE consumer-protection, e-commerce, data-protection and payments rules must be reviewed by qualified counsel before launch (`docs/SECURITY.md`).
8. **Validation plan** (not performed — no human subjects here): ≥ 5 representative UAE users (Arabic-first, English-first, bilingual, one with a baby, one budget-constrained) and ≥ 2 merchant/operator interviews. Measure: budget comprehension (can they say what is included?), time to a useful basket, trust in "Why this basket?", substitution-approval comprehension, checkout completion, merchant workload per order, repeat-order use, operational feasibility of 45–120 min ETAs.

---

# B. Experience and journeys

## B1. Journeys

**Customer**

1. _Guest → basket:_ choose language & area → Explore ready baskets or **Build My Basket** → review/edit (no account needed) → sign in only at checkout (basket + checkout draft preserved).
2. _Natural language:_ describe the household → we show "what we understood", flag missing/ambiguous fields (budget scope!) → build → edit → substitution policy → checkout.
3. _Store-first:_ discover store → browse catalog → message merchant (product/store reference) → add items → order.
4. _Voice:_ send voice note → consent → transcript (faithful + readable, uncertain words marked, original audio kept) → **Turn into a basket**.
5. _Track & contact:_ order timeline, message store, report a problem (dispute).
6. _Substitution:_ merchant marks an item unavailable → request appears on the order **and** in the conversation → accept/decline with price and difference shown.
7. _Points:_ earned on delivery (pending → available), redeemed at checkout, reversed on cancellation/refund.
8. _Repeat:_ completed order → **Repeat this basket** → preview of price/availability changes, suggested replacements, new total vs. last time → basket → checkout.

**Merchant:** sign up as business → onboarding (business, store, areas, package) → "waiting for review" (catalog can be prepared) → approved → catalog/stock/prices/offers/alternatives → ready baskets → conversations → order queue (review → prepare → ready → out for delivery → delivered; decline) → report unavailable item + propose replacement → reports (basic/advanced by package) → staff with scoped permissions → export.

**Administrator:** review applications (approve / reject / suspend / reinstate, reason required) → packages (entitlements) → service areas → basket rules → loyalty rules + ledger adjustment (reason, idempotent) → orders (cancel with reason) → disputes (review, resolve, refund) → reports (read _only_ reported conversations, audited) → users (restrict) → audit log → provider status (modes only) → maintenance job.

**Support:** orders, disputes and reports only; cannot change packages, rules, loyalty or users.

## B2. Sitemap and screen map

```
/                         Home (hero, quick entry, how it works, ready baskets, stores, budget control, example, trust, FAQ)
/build                    Basket Builder: guided steps | describe it (natural language)
/basket                   Basket result + edit + Why this basket? + Basket health + recovery options
/ready, /ready/:id        Ready baskets list / detail (customise or use)
/stores, /stores/:id      Discovery / storefront + catalog (search, category, diet, in-stock, cursor paging)
/products/:id             Product details
/checkout                 Address, substitution policy, payment (COD/sandbox card), points, terms, budget gate
/signin                   Phone + OTP (customer or business)
/messages, /messages/:id  Conversations (text, photo, voice, references, transcripts, block, report)
/orders, /orders/:id      Orders, tracking timeline, substitution decisions, cancel, dispute
/orders/:id/repeat        Repeat basket preview
/loyalty, /saved          Points wallet & rules · saved stores/products/baskets
/account                  Profile, addresses, preferences, language, consents, notifications, export, delete
/help, /legal/:kind       FAQ/support · placeholder terms/privacy
/business/*               Merchant: dashboard, orders(+detail), catalog, ready baskets, messages, reports, staff, package, store
/admin/*                  Admin: dashboard, merchants, orders, disputes+reports, users, packages, areas, rules, loyalty, audit, providers
```

Account recovery: there are no passwords. "Recovery" means verifying the number again; a lost number requires support with order details (documented on the sign-in screen). A formal identity-verification process is a pre-launch task.

## B3. Screen specifications

Common behaviour (applies to every screen, stated once):

- **Loading:** skeleton blocks (`SkeletonList`) or an inline spinner on the acting button; never a blank page. **Error & recovery:** `ErrorBox` shows a localised, specific message (server `error.code` → copy), keeps entered data, and offers _Try again_ where it helps. **Empty:** a sentence plus the next action.
- **Mobile (< 900 px):** single column, 44 px minimum touch targets, bottom navigation, sticky **total bar** on the basket. **Tablet/desktop (≥ 900 px):** top navigation, two-column layouts with a sticky summary.
- **Arabic/English:** `dir` and `lang` follow the locale; layout uses CSS logical properties, so it mirrors automatically; prices/numbers are isolated LTR (`bdi`-style `.money`), Latin digits are used in both languages, user-typed text uses `dir="auto"`. Switching language never remounts the app: area, form fields, basket and checkout drafts persist (localStorage) — covered by an e2e test.
- **Accessibility:** skip link, labelled controls, errors tied to fields (`aria-describedby`, `role=alert`), visible focus, status never colour alone (icon + text), `prefers-reduced-motion`, modal focus-trap + Escape. axe (WCAG 2.2 A/AA tags) runs in both languages in CI.

### Customer

| Screen                        | Purpose & hierarchy                                                                                                                        | Primary / secondary action                                            | Validation                                                                                    | Permissions                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| Home                          | Need-first hero → quick household entry → how it works → ready baskets → nearby stores → budget control → real example → trust → FAQ → CTA | Build My Basket / Explore Ready Baskets                               | —                                                                                             | Public                             |
| Area picker (modal)           | Choose supported area; optional "use my location"                                                                                          | Pick area / use location                                              | Unserved areas are labelled; declined permission → friendly fallback                          | Public                             |
| Builder – guided              | 5 steps: area → people & days → budget + scope → type, diet, allergens, tier → exclusions, substitution, optional items                    | Next / Build basket (available from step 3)                           | Area required; budget requires an explicit scope; scope error shown inline                    | Public                             |
| Builder – natural             | Free text → "what we understood" with editable fields; missing/ambiguous fields flagged                                                    | Interpret / Build basket                                              | Same as guided; AI failure shows "used standard rules" notice                                 | Public                             |
| Basket                        | Totals (sticky) · groups by need · per-line reason, stepper, replace, remove · recovery · Why this basket? · Basket health                 | Continue to checkout / Save / Ask the store                           | Essential removal asks confirmation; min-order warning blocks checkout                        | Public (save/ask need sign-in)     |
| Alternatives (modal)          | Save more / similar price / higher-priced option, each with exact basket effect and differences                                            | Use this one                                                          | Only items passing allergen/diet/exclusion filters and in stock                               | Public                             |
| Ready baskets / detail        | Six templates with household, duration, store, areas, live starting price                                                                  | Customize / Use this basket                                           | —                                                                                             | Public                             |
| Stores / storefront / product | Hours, fees, ETA (labelled estimate), COD, areas; catalog with filters and cursor paging                                                   | Add / Message store / Save                                            | —                                                                                             | Public (message/save need sign-in) |
| Checkout                      | Address (saved or new) · store · substitution policy · payment · points · notes · terms · totals + budget gate                             | Confirm Order – AED x                                                 | Building required, terms required, over-budget needs approval, items re-validated server-side | Customer                           |
| Order                         | Status, timeline, items (with substitution status), totals, payment, refunds, disputes                                                     | Message store / Cancel (before preparing) / Repeat / Report a problem | Substitution answers are one-time (409 if repeated)                                           | Owning customer only               |
| Repeat                        | Per-line same / price changed / unavailable / limited, suggestions, last total vs new total                                                | Continue with these items                                             | —                                                                                             | Owning customer only               |
| Messages / conversation       | List with unread; thread with refs, photo, voice, transcript, sent/read, block, report                                                     | Send / attach / record / transcribe                                   | ≤ 4000 chars; image ≤ 5 MB, voice ≤ 3 MB; content sniffed; consent before transcription       | Participants only                  |
| Points                        | Available / pending, rules in plain language, history with status and order reference                                                      | —                                                                     | —                                                                                             | Owner                              |
| Account                       | Profile, addresses, preferences, language, consents, notifications, export, delete                                                         | Save / Download my data / Delete                                      | Delete needs typing `DELETE`; blocked while orders are open                                   | Owner                              |
| Help / legal                  | FAQ, support routes; **placeholder** terms & privacy                                                                                       | —                                                                     | —                                                                                             | Public                             |

### Merchant and administrator

| Screen                                    | Purpose                                                                                                | Primary action                         | Notes (validation / permissions)                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Onboarding                                | Business, licence number, first store, areas, package                                                  | Submit for verification                | Licence ≥ 4 chars; ≥ 1 area; one business per owner                                              |
| Dashboard                                 | Status banner, new orders, waiting substitutions, package usage                                        | Orders                                 | Staff see only what permissions allow                                                            |
| Catalog                                   | Search, inline price/stock edit, create/edit product, map alternatives                                 | New product                            | Offer must be a real discount; package `max_products`; duplicate SKU → 409                       |
| Ready baskets                             | Create/delete templates from catalog items                                                             | New ready basket                       | Package `max_ready_baskets`                                                                      |
| Orders / detail                           | Queue by state; customer, address, items, timeline                                                     | Move to next status / Decline          | Server state machine; preparing is blocked while a substitution is pending                       |
| Mark unavailable                          | Choose a same-category replacement or none, add reason                                                 | Send                                   | Outcome shown: sent for approval / auto-applied within limits / removed                          |
| Messages                                  | Same component as customers                                                                            | Reply                                  | Package `messages_per_day`; blocked conversations refuse messages                                |
| Reports, Staff, Package, Store            | Basic vs advanced analytics, staff permissions, package change, store profile                          | —                                      | Owner-only where stated; downgrade blocked with exact reasons                                    |
| Admin: dashboard                          | KPIs (30 d)                                                                                            | —                                      | Delivery cost / margin / on-time delivery explicitly marked as not collected                     |
| Admin: merchants                          | Review applications                                                                                    | Approve / Reject / Suspend / Reinstate | Reason mandatory for reject/suspend; every decision audited; owner notified                      |
| Admin: packages / areas / rules / loyalty | Edit entitlements, service areas, quantity rules, loyalty rules, ledger adjustment                     | Save                                   | Reason mandatory (≥ 5 chars) and audited; admin only                                             |
| Admin: orders / disputes+reports / users  | Cancel with reason; resolve disputes with optional refund; read reported conversations; restrict users | Resolve                                | Support role limited; reading a conversation is audited and only possible while a report is open |
| Admin: audit / providers                  | Append-only log; provider modes (no secrets); run maintenance                                          | —                                      | Admin only                                                                                       |

### Gaps stated plainly

Merchant image upload and verification-document upload are not implemented (placeholder art; licence number is a text field). There is no platform-wide support chat (support works through disputes and reports). Billing is not connected (package changes are immediate). Typing indicators, delivered receipts and push notifications are not implemented (in-app notifications and live SSE events are).

## B4. Primary and exception flows

| Situation                                | What the product does                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Unsupported area                         | `UNSUPPORTED_AREA` + list of served areas; one tap to switch                                                                            |
| Location permission declined/unavailable | Friendly message, manual selection; coordinates are never stored                                                                        |
| Budget too low                           | Shortfall in AED, essentials protected, options: raise budget, fewer days/people, drop optionals, compare stores                        |
| Delivery pushes total over budget        | Status becomes "Over budget" (red, icon + text); checkout needs explicit approval                                                       |
| Price/stock changed before confirm       | Checkout re-prices; unavailable items block with a list; `ITEMS_UNAVAILABLE` details                                                    |
| Item unavailable after order             | Merchant flow → policy (`ask` / `auto` within limits / `none`) → request on order + conversation                                        |
| No suitable substitute                   | Request with no replacement: accept = continue without it; decline = cancel order                                                       |
| Merchant rejects / cannot fulfil         | Status `rejected`/`cancelled`, stock restored, points returned, prepaid money refunded, customer notified                               |
| AI/provider failure                      | Deterministic rules result is used; UI says so; flagged in analytics                                                                    |
| Transcription failure / uncertain        | Audio kept, retry or type; uncertain words listed instead of guessed                                                                    |
| Upload failure                           | Message not sent, retry button, specific reason (type/size/content)                                                                     |
| Payment failure / outage / delay         | Declined: no order, stock untouched; outage: 503 no charge, same key retryable; pending: order hidden until signed webhook (idempotent) |
| Network loss                             | Banner, drafts persisted locally, `withRetry` for idempotent order submit                                                               |
| Unfinished basket                        | Builder shows "continue basket"; checkout draft restored after sign-in or reload                                                        |
| Previous basket changed                  | Repeat preview shows old/new price, unavailable, suggestions, difference                                                                |
| Essential removed                        | Confirmation dialog naming the item                                                                                                     |
| Package limit reached                    | `PACKAGE_LIMIT_REACHED` with limit and next step                                                                                        |
| Points pending/reversed/expired          | History shows status and reason; reversal entries are separate rows                                                                     |
| Restricted account                       | Read and export allowed; ordering/messaging refused with explanation                                                                    |

## B5. UX copy

All production copy — screens, validation, budget warnings, substitutions, checkout, tracking, empty states, errors, notifications, privacy and consent — lives in typed dictionaries (`web/src/i18n/en.ts`, `ar.ts`; the Arabic file fails to compile if a key is missing) and is published in **`docs/UX-COPY.md`** (generated). Examples:

| Moment           | English                                                           | العربية                                                     |
| ---------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Planned quantity | Quantities are planned for 4 people for 7 days.                   | الكميات محسوبة لـ4 أفراد لمدة أسبوع.                        |
| Savings          | We saved you AED 18.00 with available, better-value alternatives. | وفرنا لك 18.00 درهم باختيار بدائل متوفرة ومناسبة.           |
| Under budget     | Your total including delivery is AED 12.00 under your budget.     | إجماليك شاملًا التوصيل أقل من ميزانيتك بـ12.00 درهم.        |
| Shortfall        | We need AED 22.00 more to keep all essential items.               | نحتاج 22.00 درهم إضافية للإبقاء على جميع المنتجات الأساسية. |
| Checkout CTA     | Confirm Order - AED 490.00                                        | تأكيد الطلب - 490.00 درهم                                   |
