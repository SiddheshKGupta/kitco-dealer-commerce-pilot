# Task 8 report — dealer activation and login UI

Implemented pathname-routed `/activate` and `/login` screens with the supplied KITCO mark, mobile PILOT badge, deliberate 180ms route/control motion, visible keyboard focus, and reduced-motion support.

- Dealer lookup remains private until three characters and displays only dealer name plus city.
- Activation requests an API OTP with included credentials, validates the 12-character password minimum, supports resend countdown, and surfaces precise provider/server errors.
- Login uses password then fresh purpose-specific OTP before returning to the dealer workspace.
- No master email is exposed by the stable lookup contract; the activation UI identifies it as private and collects only the selected pilot email for the authorised request endpoint.

Verification: focused UI suite: 4/4 passed; full suite: 26 files / 86 tests passed; `npm.cmd run typecheck` passed; `npm.cmd run build` passed. Wrangler emitted its known sandbox-only debug-log directory warning after build.
