# G. Phased roadmap

Product evolution targeted by the design: **Ready Basket → Custom Basket → Smart Basket → Conversational Basket → Personalized Basket → Predictive Consumption.** The MVP delivers the first four; the rest depend on validated demand, operations, security and unit economics.

## Phase 0 — Pilot readiness (before any public traffic) · 4–8 weeks

| Work                                                                                                                       | Depends on                       | Success criteria                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Live SMS OTP adapter; live PSP adapter (hosted fields, webhooks); S3-compatible storage; push (FCM/APNs)                   | Provider contracts, legal review | Sandbox → live checklist passes; webhook replay/idempotency tests against the real PSP sandbox        |
| Security hardening: cookie-based session or short-lived tokens + CSP, shared rate limiter, malware scanning, WAF, pen test | Hosting decision                 | No high/critical findings; limits survive multi-instance                                              |
| Native builds, signing, store listings, privacy labels                                                                     | Apple/Google accounts            | Internal TestFlight/Play internal track builds pass the e2e smoke manually                            |
| Legal: terms, privacy, consent wording, merchant agreement, refund policy                                                  | Counsel                          | Signed-off documents replace placeholders                                                             |
| Merchant data quality: onboarding KYB documents, image upload, allergen/diet verification process                          | Operations                       | ≥ 95 % of pilot SKUs have Arabic+English names, photos and verified tags                              |
| User research: ≥ 5 UAE users + merchant/operator interviews (plan in `01-PRODUCT.md`)                                      | Recruiting                       | Budget comprehension ≥ 4/5, median time-to-useful-basket < 2 min, substitution flow understood by 5/5 |

## Phase 1 — Pilot (2 zones, 2–5 merchants) · 8–12 weeks

Run the product as built; instrument and learn. Add: delivered receipts and typing indicators (cheap), merchant bulk catalog import (CSV), basic courier assignment fields (driver name/phone) if merchants self-deliver, cohort retention (7/30/60 day) and funnel dashboards, cost tracking (delivery, payment fees).
**Gate to Phase 2:** ≥ 30 % of generated baskets checked out in pilot, ≥ 85 % on-time vs. store ETA, order cancellation < 8 %, substitution acceptance ≥ 70 %, repeat-order rate ≥ 25 % within 30 days, positive contribution per order after fees (modelled with real data).

## Phase 2 — Scale within the pilot city · 3–4 months

- **Personalised baskets:** use opt-in consent + order history for default tiers/brands and per-household quantity calibration (replace static units/person/week with learned rates, with the rules engine kept as the guard-rail and fallback). _Deferred because_ it needs real consumption data and explicit consent flows.
- **Multi-store basket splitting** with coordinated delivery. _Deferred because_ it multiplies fees, ETAs and failure modes; needs courier coordination and a clear price/ETA model.
- **Subscriptions / scheduled baskets** (complex billing). _Deferred_ until repeat behaviour is proven.
- Production-grade multi-provider transcription with Arabic dialect evaluation and human-in-the-loop correction. _Deferred_ until voice usage justifies cost.
- Scale-out: PostgreSQL `LISTEN/NOTIFY` or Redis for events/rate limits, read replicas, queue for notifications and maintenance jobs.

## Phase 3 — Predictive consumption and ecosystem · 6+ months

- **Predictive replenishment** reminders ("you usually run out of rice around now") — only after personalised baskets prove accurate and users opt in.
- Advanced loyalty (tiers, partner rewards) — only if points show healthy redemption without margin damage.
- Real-time courier maps and route optimisation — needs a courier network or partner API.
- Advertising / large-scale promotions — needs enough merchant and customer density; must not compromise price transparency.
- Additional emirates / nationwide coverage / owned warehousing — driven by unit economics, not ambition.

## Customer-to-customer selling (explicitly later)

Not in the MVP. Prerequisites: identity verification, listing moderation, prohibited-item policy, reputation, fraud controls, reporting + disputes at scale, safer payment handling (escrow-like), seller tax/legal treatment, and a trust & safety team. _Deferred because_ it changes the risk profile of the whole platform; the existing report/dispute/audit foundations are the starting point.

## Principles for sequencing

1. Trust and transparency features never get traded for conversion.
2. A feature ships only when operations can actually support the promise (delivery speed, coverage, availability).
3. Every new provider integration lands behind an interface with a sandbox adapter and tests first.
4. Measure before scaling: the KPIs in `/admin` and the analytics events are the minimum instrumentation for each gate.
