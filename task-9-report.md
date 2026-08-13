# Task 9 Report — Dealer Catalogue and Ordering Journey

## Delivered

- `/products` shell integration with a responsive dealer catalogue.
- Products, Upcoming, and Prebook tabs; search, brand filters, MRP sorting, desktop filter rail, and mobile filter drawer.
- Three/two/one-column responsive grid, exact colourway media, and Article-specific missing-media treatment.
- Product detail journey with enabled size quantities, MOQ and order-multiple feedback, and sticky Add to Current Order tray.
- Authoritative draft persistence through `PUT /api/drafts/current`; the browser sends only offering and quantities.
- Current Order summary, Retail Value, delivery-location allocation, review, fresh purpose-specific OTP request, idempotent `POST /api/orders/submit`, and immutable Version 1 confirmation.
- No dealer price, margin, GST estimate, payable amount, or numeric availability in dealer UI.
- 180ms motion, visible focus, reduced-motion behavior, and responsive controls in feature-scoped CSS.

## API contracts

- Catalogue: `GET /api/catalogue` with `credentials: include`.
- Draft: `PUT /api/drafts/current` with `{ offeringId, quantities }`.
- Order OTP: `POST /api/orders/otp` with `{ purpose: "ORDER_SUBMISSION" }`.
- Submission: `POST /api/orders/submit` with OTP challenge/code and an `Idempotency-Key` header.

The authenticated `/api/orders/otp` issue route was not present when Task 9 completed. The UI reports a precise temporary-unavailability message on 404; controller will add the missing server route during consolidated integration.

Task 6's catalogue response does not yet expose offering type. The UI accepts the optional field and keeps the Upcoming/Prebook tabs functional for the production adapter to populate; records without type remain in Products.

## Verification

- Focused catalogue/order UI and connected smoke: 8 passed.
- Full suite: 31 files, 99 tests passed.
- Typecheck: passed.
- Production build: passed.
