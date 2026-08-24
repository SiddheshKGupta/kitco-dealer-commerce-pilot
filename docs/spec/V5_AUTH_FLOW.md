# KITCO Dealer Commerce v5 — Authentication Flow

**Status:** `account_state` column applied (Phase 0). Flow itself is Phase 3.
**Depends on:** `V5_DATA_MODEL.md` §3, `V5_DEALER_GROUP_MODEL.md` §7
**Frozen decisions:** `V5_EXECUTION_PLAN.md` A2, B5, C17

---

## 1. What changes

| | v4 (live) | v5 |
|---|---|---|
| Identifier | email address | **Dealer Code** (`dealers.code`, unique per organisation) |
| Factors | OTP only | **password + OTP** |
| Password | none — `supabase-auth.ts` generates `unusedInternalPassword()` at user creation and no login path ever checks it | Supabase Auth verifies it on every login |
| Self-service onboarding | dealer searches for their own name, claims an email, activates | KITCO issues credentials; the dealer never self-claims an account |
| `PILOT_STATIC_OTP=123456` | live on a public URL | **removed from production** |

v4 is genuinely single-factor. `worker/routes/login.ts` says so in its own header
comment: *"OTP is the only login factor — there is no password to check."* Anyone who
could receive mail at a dealer's address held that dealership. v5 adds a factor the
attacker must also possess, and moves account creation from self-service to KITCO.

---

## 2. First login

The dealer receives a Dealer Code and an initial password from KITCO, out of band.

```
1. Dealer Code + initial password
        │  wrong either → generic "Sign-in details are incorrect" (§5)
        ▼
2. OTP sent to the registered email        state → OTP_PENDING
        │
        ▼
3. OTP entered and verified                state → PASSWORD_CHANGE_REQUIRED
        │
        ▼
4. Set a new password (mandatory, cannot be skipped or deferred)
        │  new password must differ from the issued one
        ▼
5. ACTIVE  →  /products                    first_login_at stamped
```

Step 4 is not a prompt. Until the password is changed, the session is scoped to the
change-password endpoint only; every other API route rejects it. A "remind me later" here
would leave an admin-known password valid indefinitely — which is the same single-shared-
secret problem v5 exists to remove.

---

## 3. Subsequent login

```
Dealer Code + password  →  OTP to registered email  →  authenticated
```

Two factors, one screen each. The OTP purpose is `LOGIN`; purpose binding, expiry,
attempt limits, replay protection and correlation IDs all carry over unchanged from
`worker/auth/otp-service.ts` — that service is sound and is not being rewritten.

Admin sign-in follows the same shape with an email identifier instead of a Dealer Code,
since admins have no dealer record. `app_users.must_change_password` (already added in
`20260814120000_role_model_widen.sql`) plays the `PASSWORD_CHANGE_REQUIRED` role for
admin accounts.

---

## 4. Password recovery

```
Dealer Code  or  registered email
        │
        ▼
"If that account exists, we've sent a code to the registered email."   ← always this
        │
        ▼
OTP (purpose PASSWORD_RESET)  →  new password  →  ACTIVE
```

The response text and the HTTP status are **identical** whether the account exists or
not, and the timing must not diverge meaningfully either. A recovery form that says
"no account with that email" is a free membership oracle: an attacker learns which
addresses are KITCO dealers and can target them.

The same rule already applies at login: `INVALID_CREDENTIALS` covers unknown Dealer Code,
wrong password, and suspended account alike. The user-visible copy never distinguishes
them. Admin tooling distinguishes them; the public surface does not.

A reset consumes exactly one OTP challenge and returns the account to `ACTIVE` — never to
`PASSWORD_CHANGE_REQUIRED`, because the dealer has just chosen the password themselves.

---

## 5. Account state machine

```
IMPORTED
   │  admin queues credentials
   ▼
CREDENTIALS_PENDING
   │  password generated, email sent
   ▼
CREDENTIALS_ISSUED ──────────────────────► credentials_issued_at
   │  dealer opens the sign-in screen
   ▼
FIRST_LOGIN_PENDING
   │  Dealer Code + issued password accepted
   ▼
OTP_PENDING
   │  OTP verified
   ▼
PASSWORD_CHANGE_REQUIRED
   │  new password set
   ▼
ACTIVE ◄──────────────────────────────────► first_login_at, last_login_at
   │
   ├──► SUSPENDED   (admin, reversible)
   └──► DISABLED    (admin, reversible by admin only)
```

Allowed transitions, with the rule that **every state has a next action and an admin
escape hatch**:

| State | Dealer's next action | Admin recovery | Audit event |
|---|---|---|---|
| `IMPORTED` | none (not contactable yet) | issue credentials; edit or delete the import | `DEALER_IMPORTED` |
| `CREDENTIALS_PENDING` | none | re-run issuance; cancel back to `IMPORTED` | `CREDENTIALS_QUEUED` |
| `CREDENTIALS_ISSUED` | sign in | re-issue (new password, old one invalidated) | `CREDENTIALS_ISSUED` |
| `FIRST_LOGIN_PENDING` | complete first login | re-issue; suspend | `FIRST_LOGIN_STARTED` |
| `OTP_PENDING` | enter or resend OTP | re-issue; suspend. **Never stuck**: an expired challenge returns to `FIRST_LOGIN_PENDING`, it does not park here | `OTP_ISSUED` / `OTP_VERIFIED` |
| `PASSWORD_CHANGE_REQUIRED` | set a new password | re-issue credentials, which restarts at `CREDENTIALS_ISSUED` | `PASSWORD_CHANGE_REQUIRED` |
| `ACTIVE` | trade | suspend / disable / force password change | `DEALER_ACTIVATED`, `LOGIN_SUCCEEDED` |
| `SUSPENDED` | none — told to contact KITCO | restore to `ACTIVE` | `DEALER_SUSPENDED` / `DEALER_RESTORED` |
| `DISABLED` | none | restore to `ACTIVE` | `DEALER_DISABLED` / `DEALER_RESTORED` |

### Why this list is exhaustive on purpose

v4's `dealer_applications` defaults to `DRAFT`, and `worker/routes/register.ts:83` only
lets a `DRAFT` application submit. An application that stalled mid-flow sat in `DRAFT`
with no dealer action that moved it and no admin action that rescued it — it never
reached the approval queue, so no admin could even see it. That stranding broke a demo.

The v5 rule, structurally: **no state is terminal by accident.** Every row in the table
above has a filled "admin recovery" cell. Adding a tenth state without one is a review
failure, not a style preference. `SUSPENDED` and `DISABLED` are the only deliberate
dead ends, and both are reversible by an admin.

`account_state` is deliberately a **new column** alongside v4's `activation_status`,
which stays authoritative for the live pilot until cutover. Two columns for one concept
is a smell everywhere except during a migration of a running system, which is exactly
what this is. The cutover that retires `activation_status` is a Phase 8 task.

---

## 6. Password handling rules

| Rule | Reason |
|---|---|
| Passwords go through **Supabase Auth** (`auth.users`) | It already stores them correctly hashed; a second store is a second thing to get wrong |
| Never a column on `dealers` — not the hash, not the plaintext, not "temporary" | `dealers` is read by admin console queries, exports and RLS policies; nothing in that blast radius should contain credential material |
| Never logged — not at info, not at debug, not in an error body | `redactProviderError()` in `resend-provider.ts` already sets this precedent for recipient PII |
| Never returned from any API, including immediately after issuance | The one-time display of a generated password belongs in the admin's own response to the issuance action, shown once, not persisted |
| Minimum 12 characters (v4 activation's existing bar) | Consistency with the rule already stated in `V4_EXECUTION_PLAN.md` Slice 2 |
| Issued passwords are single-use in practice — §2 step 4 forces replacement | An admin-known password must never survive first login |

`unusedInternalPassword()` in `worker/auth/supabase-auth.ts` becomes dead once v5 auth
lands, since passwords are real. It is one of the removals Phase 3 owns.

---

## 7. Removing `PILOT_STATIC_OTP`

Today `OtpService` accepts a bypass code:

```ts
const isPilotBypass = Boolean(this.options.pilotBypassCode) && code === this.options.pilotBypassCode;
```

With `PILOT_STATIC_OTP=123456` set on a public URL, `123456` passes OTP for **any**
account including admin. It was an accepted pilot risk (`V4_EXECUTION_PLAN.md` R2) with
an explicit "unset before real dealers onboard" note. v5 does not carry it forward.

There is a second, quieter behaviour to remove with it: when `pilotBypassCode` is set,
`issue()` **swallows an email delivery failure** and returns a live challenge anyway
(`otp-service.ts` line ~165). In production that would mean a challenge nobody can
receive a code for — a dead end, silently.

The replacement is **provider injection, not a magic value**:

```
production   →  RandomOtpProvider    (crypto.getRandomValues, current behaviour)
tests        →  DeterministicOtpProvider  (returns a fixed/seeded code)
```

Tests already inject `options.code`; `OtpService` supports it today. So the change is
subtractive: delete `pilotBypassCode`, delete the bypass branch, delete the
swallowed-failure branch, delete `PILOT_STATIC_OTP` from `worker/env.ts` and from the
Worker secrets. Production has no code path that can accept a static OTP — not gated by
an environment variable, **absent**. An env flag that could re-enable it is the same
risk with an extra step.

**Verification for Phase 3:** an integration test that asserts `123456` fails against a
production-configured `OtpService`, plus a grep-level check that `PILOT_STATIC_OTP`
appears nowhere in `worker/`, `.dev.vars.example`, or the deploy docs.

---

## 8. Migrating the 136 existing dealers

Per decision A2, they are issued **email + password**, not re-onboarded.

```
for each of the 136 live dealers:
    email    = the primary email they already provided   (pilot_email → master_email)
    password = generated, shown once to the admin, delivered out of band
    account_state → CREDENTIALS_ISSUED
    dealer_code = dealers.code                            (already unique per org, already exists)
```

Notes:

- The dealer's `auth.users` row already exists from v4 activation; migration sets a real
  password on it rather than creating a second identity. No dealer loses their order
  history.
- Any dealer whose primary email is missing or bounces stays at `CREDENTIALS_PENDING`
  and appears in an admin exception list. They are not silently skipped, and they are not
  auto-assigned a fabricated address.
- `VLCO` remains as-is: a test account, not a real dealer, excluded from the run.
- Dealers still at v4 `UNACTIVATED` are imported at `IMPORTED`, not `CREDENTIALS_ISSUED`
  — they never completed onboarding and there is nothing to preserve.

**Open decision — not invented here:** whether existing dealers keep email-based sign-in
during a transition window or switch to Dealer Code on a fixed date. The safe default is
Dealer Code from day one with the email accepted as an alias at the identifier lookup
step only (same resolution, same password, same OTP) — this costs one extra lookup and
strands nobody who has the letter but not the code.
