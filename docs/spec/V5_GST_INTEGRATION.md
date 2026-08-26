# KITCO Dealer Commerce v5 — GST Verification

**Status:** `gst_registrations` applied (Phase 0). Live provider integration **deferred by
client decision** (`V5_EXECUTION_PLAN.md` C12). Mock adapter only until credentials exist.
**Depends on:** `V5_DATA_MODEL.md` §2–§3, `V5_DEALER_GROUP_MODEL.md` §5

v4 treated GSTIN as a plain unvalidated string on `dealers` (decision D5: "no format
validation, no master-record matching, no gate"). v5 makes it a verified entity — but
only when a real provider is wired, and it is honest about the difference until then.

---

## 1. The abstraction

One interface, one service, two implementations, selected by environment variable.

```
GSTVerificationService
      │  caches by gstin, writes gst_registrations, records evidence
      ▼
GstVerificationProvider              ← the seam
      ├── MockGstProvider            deterministic fixtures, marks NOT_LIVE_VERIFIED
      └── <GSP>GstProvider           PLANNED — real GSP/ASP adapter
```

```ts
// PLANNED — Phase 1 wiring, Phase-deferred provider
interface GstVerificationProvider {
  readonly name: string;                       // recorded in gst_registrations.provider
  verify(gstin: string): Promise<GstVerificationResult>;
}
```

Selected by `GST_PROVIDER` in `worker/env.ts` (`mock` | provider key). Unset ⇒ mock. This
is the one place a single-implementation interface is justified: the *second*
implementation is a named, funded, deferred deliverable, not a hypothetical. The seam is
what lets Phase 1 ship the admin flow without waiting on a commercial GSP contract.

`GSTVerificationService` holds the logic that must not be duplicated per provider:
GSTIN shape check, cache lookup (a registration already verified is not re-fetched —
see `V5_DEALER_GROUP_MODEL.md` §5, one call covers every dealer under it), row upsert,
evidence recording, and audit.

---

## 2. Result shape → column mapping

Every provider normalises to this. The raw provider body is kept verbatim alongside it.

| Result field | `gst_registrations` column | Notes |
|---|---|---|
| `gstin` | `gstin` | unique per organisation, on the registration row |
| `status` | `gst_status` | `ACTIVE \| CANCELLED \| SUSPENDED \| PROVISIONAL \| UNKNOWN` — constrained in the schema |
| `legalName` | `legal_name` | stored **exactly** as returned (§4) |
| `tradeName` | `trade_name` | as returned |
| `registrationDate` | `registration_date` | date |
| `constitution` | `constitution` | e.g. "Private Limited Company" |
| `taxpayerType` | `taxpayer_type` | e.g. "Regular", "Composition" |
| `principalAddress` | `principal_address` jsonb | structured; not flattened to a string |
| `state` | `state` | |
| `pincode` | `pin_code` | |
| `businessActivities` | `business_activities` jsonb | array |
| `verifiedAt` | `verified_at` | timestamp of the *provider* response, not the row write |
| `provider` | `provider` | provider name, so evidence is attributable |
| `providerReference` | `provider_reference` | provider's request/txn id |
| `rawResponse` | `raw_response` jsonb | unmodified body — the actual evidence |
| *(derived)* | `verification_status` | `UNVERIFIED \| NOT_LIVE_VERIFIED \| VERIFIED \| FAILED` |

Every column above already exists — the migration was written against this shape, so the
adapter is pure mapping with no schema work.

`raw_response` matters more than it looks. When a dealer disputes a name or an address a
year from now, "what did the provider actually say" is the only answer that settles it.
A normalised row alone cannot distinguish a provider change from a mapping bug.

---

## 3. The honesty rule

> With no live provider configured, records are marked `NOT_LIVE_VERIFIED`, and mock
> data is **never** presented in the UI as officially GST verified.

`verification_status` defaults to `UNVERIFIED` in the schema. The mock adapter writes
`NOT_LIVE_VERIFIED` — a distinct value, not a shortcut to `VERIFIED`, precisely so that
one enum comparison separates real evidence from placeholder data everywhere it matters.

| Status | Meaning | Dealer/admin UI shows |
|---|---|---|
| `UNVERIFIED` | never attempted | "Not verified" |
| `NOT_LIVE_VERIFIED` | mock adapter produced this; **no official source** | "Not verified — no GST connection configured" |
| `VERIFIED` | a live provider returned it | "Verified · {provider} · {verified_at}" |
| `FAILED` | live provider was called and rejected/errored | "Verification failed — {reason}" |

`NOT_LIVE_VERIFIED` must never render a tick, a green badge, the word "verified", or a
provider name. It renders as *unverified with a reason*. A colour alone is not the signal
— status is always word plus icon, never colour on its own.

Two absolute prohibitions:

1. **Never scrape the GST portal.** Not with a headless browser, not by parsing its HTML,
   not "just for the mock". It is against the portal's terms, it breaks without notice,
   and it produces data that looks official and is not attributable. Verification goes
   through a licensed GSP/ASP or it does not happen.
2. **Never fabricate official data.** The mock returns obviously-synthetic fixtures for
   known test GSTINs and `UNKNOWN`/no-result for everything else. It does not invent a
   plausible legal name for a real GSTIN. A fabricated legal name that happens to be
   wrong ends up on an invoice.

Related, from the same principle: v4's D5 decision (plain, unvalidated GSTIN input) stays
in force for any dealer whose GSTIN has not been verified. v5 does not retroactively
gate the 115 existing registrations behind a provider that does not exist yet.

---

## 4. `legal_name` vs `display_name`

Two names, two owners, two rules:

| | `gst_registrations.legal_name` | `dealers.display_name` |
|---|---|---|
| Source | the GST provider, verbatim | a KITCO admin |
| May be edited | no | yes |
| Reformatted on write | **never** | n/a |
| Used for | invoices, statutory documents, exports | every screen, email subject, picker |

`legal_name` is stored **exactly** as returned — `SHREE GANESH FOOTWEAR`, all caps,
whatever spacing the registry holds. It is a statutory string; normalising it makes it a
different string.

Title-casing is a **display concern only**, and it is not as easy as it looks. The naive
implementation — uppercase the first character of each word, lowercase the rest — is
already in this codebase at `worker/routes/product-export.ts:9` (used for gender, where
it is harmless). Applied to legal names it mangles:

| Input | Naive title-case | Correct |
|---|---|---|
| `SHREE GANESH FOOTWEAR` | Shree Ganesh Footwear ✔ | Shree Ganesh Footwear |
| `OPENAI` / `OpenAI` | Openai ✘ | OpenAI |
| `V L & CO` | V L & Co ✔ | V L & Co |
| `S2G FASHION` | S2g Fashion ✘ | S2G Fashion |
| `HP LIFESTYLE PRIVATE LIMITED` | Hp Lifestyle Private Limited ✘ | HP Lifestyle Private Limited |

Because no formatter gets all five right without a curated exception list, the rule is:

- The title-caser is a **suggestion** offered to the admin when a dealer is created,
  pre-filling `display_name`.
- The admin can correct it before saving, and can edit it any time afterwards.
- It never runs automatically on `legal_name`, and never re-runs over a saved
  `display_name`.

A human confirming a name once is cheaper and more correct than a heuristic that
silently ships `Hp Lifestyle` onto every screen.

---

## 5. Admin flow

```
Control → Dealers → Add Dealer
   │
   ├─ Enter GSTIN                       plain input, shape-checked only
   │
   ├─ [ Verify ]                        busy state on the button: "Verifying…"
   │     │
   │     ├─ already in gst_registrations → reuse the row, show when/how it was verified
   │     └─ otherwise → provider.verify(gstin)
   │
   ├─ REVIEW (this step is not skippable)
   │     Legal Name      SHREE GANESH FOOTWEAR
   │     Trade Name      Shree Ganesh
   │     GST Status      ACTIVE
   │     Address         <principal place, structured>
   │     Verification    Not verified — no GST connection configured   ← when mock
   │     Display Name    [ Shree Ganesh Footwear ]   ← editable, pre-filled per §4
   │
   └─ [ Confirm and create dealer ]     only now is the dealer committed
```

Verify-then-review-then-confirm, never verify-and-autocommit. The admin is the one who
decides that this returned entity is the dealer they meant. A GSTIN typo that resolves to
a real, active, *different* company is otherwise indistinguishable from success.

If the dealer's GSTIN matches an existing registration, the UI says so explicitly —
"3 other dealers already use this GSTIN" — because sharing is legitimate (`§5` of the
dealer group model) but silently sharing is not.

A failed or unavailable verification does **not** block dealer creation. The registration
is written `FAILED` or `UNVERIFIED` with the reason, and the dealer is created. Blocking
would strand a dealer on a provider outage, which is the same class of bug as the v4
`DRAFT` stranding.

---

## 6. Open decisions

Deliberately not invented here. Each has a safe default that holds until KITCO decides.

| Question | Safe default in force today |
|---|---|
| **Which GSP/ASP provider** (open item 2, `V5_EXECUTION_PLAN.md` §6) | `MockGstProvider`. Everything it writes is `NOT_LIVE_VERIFIED`. No credentials in any config file. |
| Re-verification cadence — do registrations go stale? | None. A registration is verified once; `verified_at` is displayed so staleness is visible rather than hidden. A periodic re-check is a later feature and needs a per-call cost decision first. |
| What happens when a GSTIN turns `CANCELLED` after a dealer is trading | Flagged in the admin console, not auto-suspended. Suspending a dealer's ability to order is a commercial decision KITCO has not delegated. |
| GSTIN checksum validation before calling the provider | Full structural check (2-digit state code, 10-char PAN, entity code, the fixed literal "Z"), enforced by the shared `src/domain/gstin.ts` module -- a real upgrade from the old bare 15-character-and-alphanumeric check, not a downgrade of this decision. The mod-36 checksum digit itself is still deliberately NOT validated: it is well-defined and could be added, but rejecting on it locally would block a valid edge case the provider would have accepted. |
| State cross-validation (GSTIN's embedded state code vs. the dealer's address) | Same module resolves the GSTIN's state code against the official GST state-code table and compares it to the state returned by a PIN-code lookup (`worker/routes/pincode.ts`, proxying India Post's public PIN API) -- never against the PIN's first digit alone, since a postal zone can span several states. A genuine mismatch is surfaced as an inline warning the dealer must acknowledge before submitting (Registration and Profile forms), not a hard block -- consistent with "no gate" below and with never rejecting on something that cannot be confirmed wrong. |
| Whether a verified GSTIN gates ordering | No gate. v4's D5/D6 position (required to complete onboarding, unvalidated) is unchanged until KITCO says otherwise. |

The single rule underneath all five: **an absent provider produces an honest empty state,
never a convincing fake one.**
