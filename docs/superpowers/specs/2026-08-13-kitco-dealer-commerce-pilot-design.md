# KITCO Dealer Commerce Pilot Design

**Date:** 2026-08-13
**Status:** Approved design, ready for implementation planning
**Governing source:** `C:\Users\Siddhesh\Downloads\KITCO_Dealer_Commerce_Final_Handover_v3.0.md`

## 1. Objective

Build a production-shaped pilot that converts the Excel and PDF files KITCO already receives into a private, auditable wholesale catalogue and order workflow. A dealer must be able to activate, browse exact product colourways, order pairs by size, submit through a fresh OTP, and follow fulfilment. KITCO must be able to stage and commit imports, publish catalogue data, review orders, dispatch quantities, apply partial Credit Holds, and audit every material action.

The dealer experience follows the governing principle **Browse like Nike. Order like a wholesaler.** The browser expresses intent; the server and database decide authoritative state.

## 2. Delivery Priority

The initial delivery is a thin but real vertical slice on Cloudflare and Supabase. Work proceeds in this order:

1. Establish deterministic tests for source parsing and core business rules.
2. Create the real database, RLS policies, Worker API, and application shell.
3. Complete one connected happy path from dealer activation through dispatch visibility.
4. Complete all five supplied import profiles and Nike media mapping.
5. Run local smoke tests and a focused ultra-review.
6. Deploy to Cloudflare, run cloud smoke tests, and review the deployed system.
7. Address secondary polish and non-critical breadth only after the connected flow passes.

## 3. Architecture

### 3.1 Runtime

- React, TypeScript, and Vite for the application.
- Cloudflare Worker with Static Assets for the frontend and privileged API routes.
- Supabase Postgres for canonical state, Supabase Auth for identities, and Row Level Security for dealer isolation.
- Private Cloudflare R2 buckets/prefixes for immutable raw imports and product media.
- Replaceable `EmailOTPProvider`; the first deployment uses a test provider restricted to the pilot test dealer and non-production configuration.
- Escapement is initialized against this repository and used for routing, checks, and evidence capture.

### 3.2 Trust Boundaries

- Browser requests never supply authoritative dealer scope, MRP, Retail Value, scheme entitlement, booking state, or remaining dispatch quantity.
- Dealer scope derives from `auth.uid()` through `app_users.dealer_id`.
- Service-role and R2 credentials exist only in server-side environments.
- Privileged actions run through authenticated Worker routes or database functions.
- Raw uploaded files are hashed and stored before parsing.

### 3.3 Application Boundaries

- `src/features/activation`: dealer lookup, pilot email selection, activation state, and activation lock.
- `src/features/auth`: password sign-in, application OTP challenges, and session guards.
- `src/features/catalogue`: family/colourway browsing, filters, offerings, size selection, and media.
- `src/features/imports`: profile detection, source parsing, staging, preview, conflicts, duplicate detection, and transactional commit.
- `src/features/orders`: autosaved Current Order, immutable Order Versions, revision acceptance, idempotency, and cancellation.
- `src/features/dispatch`: dispatch capture and Ordered/Dispatched/Pending reconciliation.
- `src/features/holds`: whole, line, and size-quantity Credit Holds.
- `src/features/reports`: scoped operational summaries and exports.
- `src/features/audit`: append-only audit events and request correlation.

## 4. Data Model

Every business table includes `organisation_id`. The pilot uses one KITCO organisation and does not implement a SaaS tenant-control plane.

Core groups:

- Identity and dealers: `organisations`, `app_users`, `dealers`, `dealer_source_records`, `dealer_gst_registrations`, `dealer_locations`, `dealer_seller_mappings`.
- Catalogue: `brands`, `product_families`, `product_colourways`, `size_sets`, `size_values`, `product_size_values`, `product_media`, `commercial_offerings`, `seasons`, `delivery_windows`.
- Imports: `source_files`, `import_profiles`, `catalogue_import_jobs`, `catalogue_import_rows`, `master_source_links`, `stock_snapshots`, `stock_snapshot_lines`.
- Schemes: `schemes`, `scheme_targets`, `scheme_audiences`, `scheme_rules`.
- Ordering: `draft_orders`, `draft_order_lines`, `draft_order_line_sizes`, `draft_delivery_allocations`, `orders`, `order_versions`, `order_lines`, `order_line_sizes`, `order_delivery_allocations`, `order_status_history`.
- Fulfilment: `dispatches`, `dispatch_lines`, `holds`, `hold_allocations`, `cancellation_requests`.
- Security and evidence: `otp_challenges`, `audit_events`, `export_jobs`.

Submitted Order Versions are immutable. Dispatch and Credit Hold are separate from commercial Order Status. Pending quantity equals approved purchased quantity minus finalised dispatched quantity. Promotional scheme quantity never inflates purchased quantity.

## 5. Source Ingestion

### 5.1 Dealer Master

`Bihar Dealer List new.xlsx` replaces the earlier dealer workbook. The observed source has 135 dealer rows. Empty cells and shared contacts remain valid staged facts and do not block the controlled pilot. Raw source values remain in `dealer_source_records`; operational activation fields live separately on `dealers`.

The deployed seed adds one synthetic operational dealer without modifying the workbook:

- Dealer name: `VLCO`
- State: `Bihar`
- City: `Patna`
- Pilot email: `vlco.pilot@kitco.test`
- Pilot email source: `SELF_DECLARED_PILOT`
- Location: `VLCO Main`
- Activation purpose: controlled end-to-end testing

The password is supplied through deployment secret/configuration and is never committed. The test OTP code is `123456`, accepted only when the test provider is enabled and the challenge belongs to the VLCO test identity.

### 5.2 Nike

`Nike Item master File.xlsx` contains three repeated header regions with different size vocabularies: whole-number footwear sizes, half-number footwear sizes, and `S/M/L` equipment sizes. The parser segments the workbook by detected header rows instead of assuming one global header.

Observed source facts:

- 480 source rows
- 463 unique Article Nos
- 17 Articles repeated across source rows
- two known master conflicts: `IO2091-103` category and `SX7667-906` UOM

Conflicts remain visible in staging and require an explicit resolution. Repeated seasonal rows create multiple offering/source references without duplicating the colourway master.

### 5.3 Reebok

`REEBOK BUY FORM.xlsx` supplies Article No, MRP, colour, gender, brand, and sizes 7-12. Product name, category, and season remain null. Each Article No is its own deterministic family until enriched. Dealer display uses brand, Article No, colour, MRP, and sizes without fabricated descriptions.

### 5.4 DOUBLEU

`DOUBLUE_ITEM _MASTER _FILE.xlsx` uses the detailed `Sheet1` as authoritative. The parser groups 159 size-level rows into 29 colourway Articles, preserves `SIZE US` as source lineage, and displays a configurable 36-44 DOUBLEU size set without claiming a universal US system. Gender variants normalize to `MEN` and `WOMEN` while retaining their raw values.

### 5.5 Lee Cooper

`Lee Cooper 68 pcs Sample Warehouse Stock sheet.pdf` is a two-page, text-based SOH document dated 12.08.26. Continuation colour rows inherit Article, category, and gender until the next Article. The parser ignores the grand-total row, reconciles size totals 39-45 to 1,732 pairs, creates Stock in Hand offerings, and stores quantities only in internal stock snapshots.

### 5.6 Staging and Commit

The fixed lifecycle is:

`Upload -> Hash and preserve raw source -> Detect profile -> Parse -> Stage -> Validate -> Preview -> Resolve conflicts -> Transactional commit -> Audit -> Publish separately`

Import status values are `READY`, `WARNING`, `CONFLICT`, `NEEDS_ENRICHMENT`, `ERROR`, and `IGNORED`. Duplicate hashes open the prior import rather than creating duplicate catalogue state. Every canonical value retains a source file, import job, and source locator.

## 6. Product Media

The folder `C:\Users\Siddhesh\Downloads\NIKE` contains 90 JPEGs. Every filename maps exactly to a Nike Article No and every source image is 1600x1600.

The ingestion pipeline:

1. Preserve the supplied JPEG as the private display master/source asset.
2. Validate MIME, dimensions, byte size, decodeability, and Article mapping.
3. Generate 200, 600, 900, and 1400 pixel WebP variants using contain behavior with no stretching.
4. Store source and variants under private R2 keys associated with the exact colourway.
5. Publish only exact matches; unmatched or ambiguous media enters `MEDIA_REVIEW_REQUIRED`.

Products without media use a polished Article-specific placeholder. Another colourway's image is never substituted.

## 7. Brand and Interface Design

### 7.1 KITCO Branding

The supplied KITCO Sports logo is stored as `public/brand/kitco-sports.png`. It is a 228x89 RGB PNG without transparency and is rendered at no more than approximately 114x45 CSS pixels for crisp 2x display. White surfaces sit behind the mark. A higher-resolution or vector asset can replace it later without layout changes.

Required visible attribution:

- Under the mark: `Dealer Commerce Platform` and `Pilot Run · Developed by V L & CO`.
- Desktop top-right: `PILOT · Developed by V L & CO`.
- Mobile header: compact `PILOT` badge.
- Footer: `Pilot Environment · Developed by V L & CO`.

### 7.2 Dealer Experience

The dealer interface closely follows observable Nike India interaction patterns without using Nike logos, proprietary copy, or retail-only behavior:

- clean sticky global header and shallow secondary navigation
- high-contrast black/white palette with light grey media stages
- bold, compact headlines and generous whitespace
- three-column desktop product grid, two-column practical mobile grid, and one-column narrow states
- large square product imagery with text below rather than boxed dashboard cards
- persistent search, sort, and filter controls; desktop filter rail and mobile filter drawer
- rounded black primary actions and restrained outlined secondary controls
- colourway thumbnails, size grids, and sticky Add to Current Order action on PDP
- 160-220ms motion for hover, press, drawer, modal, and route transitions
- easing based on `cubic-bezier(0.2, 0.8, 0.2, 1)`
- visible focus, reduced-motion support, and no motion that delays ordering

Wholesale adaptations:

- Product tabs: All, Stock in Hand, Upcoming, Prebook / Seasons, Schemes.
- Product cards show MRP/Retail Price only.
- PDP shows exact Article, colourway, offerings, configured sizes, MOQ/multiple, and pair quantities.
- No dealer price, margin, GST estimate, invoice payable amount, or numerical availability.
- Current Order groups lines by commercial context and shows purchased pairs and Retail Value.

### 7.3 KITCO Control

KITCO Control uses the same brand system with denser enterprise information architecture. The pilot navigation includes Dashboard, Orders, Dispatch, Credit Holds, Dealers, Catalogue, Catalogue Imports, Media Library, Size Sets, Commercial Offerings, Seasons, Schemes, Reports, Audit Trail, and Settings. Tables, exceptions, and next actions take priority over decorative charts.

## 8. Activation, Authentication, and OTP

Activation begins with dealer-name autocomplete after a minimum input length. City disambiguates similar names. GSTIN and full contact details never appear in suggestions.

The activation state is:

`UNACTIVATED -> DEALER_SELECTED -> EMAIL_SELECTED -> EMAIL_OTP_PENDING -> EMAIL_VERIFIED -> PASSWORD_CREATED -> ACTIVE`

The dealer may use the masked master email or self-declare a pilot email. `master_email` is never overwritten. Successful activation locks the dealer to one Supabase Auth identity. Reset is privileged and audited.

Normal login is Email + Password + application Email OTP. Final order submission and material revision acceptance require fresh purpose-specific OTP challenges. Challenges store secure hashes, expiry, attempts, consumption, and correlation IDs.

## 9. Order and Fulfilment Flow

1. Dealer browses a Product Family and exact Colourway.
2. Dealer selects a Commercial Offering and quantities by enabled size.
3. Server validates size eligibility, MOQ, multiple, offering dates, MRP, and scope.
4. One autosaved Current Order holds all allowed brands/windows/locations.
5. Dealer selects Bill-To and allocates Ship-To quantities.
6. Final review shows MRP-based Retail Value and governing disclaimer.
7. Fresh order OTP and idempotency key create immutable Order Version V1.
8. KITCO reviews, approves, partially approves, rejects, or proposes immutable V2.
9. Dealer accepts material V2 through a fresh OTP.
10. KITCO records one or more dispatches and may apply whole/line/size Credit Holds.
11. Dealer sees Ordered, Dispatched, Pending, fulfilment status, Credit Hold, and cancellation decisions.

## 10. Security and RLS

Required policies and tests prove:

- Dealer A cannot read or mutate Dealer B data through URLs, payloads, reports, or guessed IDs.
- Dealers cannot invoke admin imports, raw-file access, media administration, dispatch, hold, or approval actions.
- Service-role credentials never reach the browser.
- Admin mutations remain server-side and audited.
- R2 media/source access is authenticated and scoped.
- Browser-forged MRP/Retail Value is ignored and recomputed.
- OTP replay, expired OTP, duplicate submission, booking closure, dispatch overrun, and held-quantity dispatch are rejected.

## 11. Verification

Initial smoke suite:

- five source-profile fixture parsers and expected counts
- Nike repeated-header segmentation and two known conflicts
- Lee Cooper continuation rows and 1,732-pair reconciliation
- dealer activation lock and master-email preservation
- OTP expiry, attempts, consumption, purpose, and replay
- family/colourway/size grouping
- offering, MOQ, and order-multiple validation
- authoritative Retail Value calculation
- idempotent immutable submission
- order revision immutability
- partial dispatch, over-dispatch rejection, and pending calculation
- partial Credit Hold enforcement
- dealer isolation/RLS
- build and Worker route smoke test

Local ultra-review follows a passing connected flow and covers type safety, lint, accessibility, responsive behavior, motion craft, secret exposure, RLS, error states, and destructive edge cases. Cloud review repeats the critical activation, catalogue, order, admin approval, dispatch, and dealer status flow against the deployed Worker and Supabase project.

## 12. Explicit Deferrals

The first connected pilot does not promise live numerical inventory, reservation, ERP integration, dealer pricing, margin, GST estimation, invoicing, payment ledger, automated credit checks, multi-user dealers, broad admin RBAC, returns, claims, native mobile apps, a SaaS tenant-control plane, CRD, or scanned-PDF OCR.

Production email-provider credentials, generic future Excel mapping UI, complete export styling, broad load testing, and secondary admin polish follow after the connected happy path and security checks are stable. The provider interface, profile model, export jobs, and load-test hooks are present so these additions do not require architectural replacement.
