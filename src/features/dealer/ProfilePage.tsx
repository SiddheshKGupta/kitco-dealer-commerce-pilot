import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, FormField, Input } from "../../components/ui";
import { SUPPORT_EMAIL } from "../../config/support";
import {
  PROFILE_FIELD_LABELS,
  type DealerProfile,
  type RequiredProfileField,
} from "../../domain/dealer-profile";
import { gstinMatchesState, isValidGstin, sameStateName } from "../../domain/gstin";
import {
  fetchProfile,
  lookupPincode,
  photoUrl,
  saveProfile,
  uploadStorefrontPhoto,
  type ProfileResponse,
} from "./api";
import "./profile.css";

type Draft = Record<string, string>;

const MOBILE_REGEX = /^[6-9][0-9]{9}$/u;
const PIN_CODE_REGEX = /^[0-9]{6}$/u;

/** Format errors on a filled-in value -- required-but-blank is handled
 *  separately by the existing completeness banner, since a dealer is allowed
 *  to save the profile one field at a time (see REQUIRED_PROFILE_FIELDS). */
function formatError(key: keyof DealerProfile, value: string): string {
  if (!value.trim()) return "";
  if (key === "gstin") return isValidGstin(value.trim().toUpperCase()) ? "" : "Enter a valid 15-character GSTIN.";
  if (key === "pinCode") return PIN_CODE_REGEX.test(value) ? "" : "Enter a 6-digit PIN code.";
  if (key === "mobile") return MOBILE_REGEX.test(value) ? "" : "Enter a 10-digit mobile number starting with 6-9.";
  return "";
}

const FIELDS: Array<{
  key: keyof DealerProfile;
  label: string;
  hint?: string;
  required: boolean;
  type?: string;
  inputMode?: "text" | "numeric" | "tel" | "email";
  autoComplete?: string;
  maxLength?: number;
}> = [
  { key: "gstin", label: "GST number", hint: "15 letters and numbers, from your GST certificate", required: true, maxLength: 15, autoComplete: "off" },
  { key: "addressLine1", label: "Shop address", hint: "Building and street", required: true, autoComplete: "address-line1" },
  { key: "addressLine2", label: "Address line 2 (optional)", required: false, autoComplete: "address-line2" },
  { key: "city", label: "City", required: true, autoComplete: "address-level2" },
  { key: "state", label: "State", required: true, autoComplete: "address-level1" },
  { key: "pinCode", label: "PIN code", hint: "City and state fill in automatically", required: true, inputMode: "numeric", maxLength: 6, autoComplete: "postal-code" },
  { key: "contactPerson", label: "Contact person", hint: "Who should we speak to about orders?", required: true, autoComplete: "name" },
  { key: "mobile", label: "Mobile number", required: true, type: "tel", inputMode: "tel", maxLength: 10, autoComplete: "tel" },
  { key: "secondaryEmail", label: "Second email (optional)", hint: "We'll copy order updates here too", required: false, type: "email", inputMode: "email", autoComplete: "email" },
];

function toDraft(profile: DealerProfile): Draft {
  return Object.fromEntries(FIELDS.map(({ key }) => [key, (profile[key] as string | null) ?? ""]));
}

export function ProfilePage() {
  const [state, setState] = useState<ProfileResponse | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [touched, setTouched] = useState<Partial<Record<string, boolean>>>({});
  const [saveAttempted, setSaveAttempted] = useState(false);
  // The PIN lookup's own state, for the pinCode it was fetched for -- the
  // source of truth for the state cross-check below (never the PIN's first
  // digit; see docs/spec/V5_GST_INTEGRATION.md). Stale once pinCode changes.
  const [pinLookup, setPinLookup] = useState<{ pinCode: string; state: string } | null>(null);
  const [mismatchAcknowledgedFor, setMismatchAcknowledgedFor] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function apply(next: ProfileResponse) {
    setState(next);
    setDraft(toDraft(next.profile));
  }

  useEffect(() => {
    let active = true;
    fetchProfile().then(
      (next) => { if (active) { apply(next); setStatus("ready"); } },
      () => { if (active) setStatus("error"); },
    );
    return () => { active = false; };
  }, []);

  // Auto-fills city/state from the PIN once it's 6 digits -- but only into a
  // blank field. A field the dealer already has a value in is left alone
  // (still editable) so a genuine conflict surfaces as the mismatch warning
  // below instead of being silently overwritten. Fails open: an unknown PIN
  // or an unreachable provider just leaves the fields as they are.
  const pinCode = draft.pinCode ?? "";
  useEffect(() => {
    const code = pinCode.trim();
    if (!PIN_CODE_REGEX.test(code)) { setPinLookup(null); return; }
    let active = true;
    lookupPincode(code).then((result) => {
      if (!active || !result.found || !result.state) return;
      setPinLookup({ pinCode: code, state: result.state });
      setDraft((current) => ((current.pinCode ?? "") === code
        ? {
          ...current,
          city: (current.city ?? "").trim() ? current.city : (result.city ?? current.city ?? ""),
          state: (current.state ?? "").trim() ? current.state : result.state!,
        }
        : current));
    });
    return () => { active = false; };
  }, [pinCode]);

  function blur(key: string) {
    return () => setTouched((current) => ({ ...current, [key]: true }));
  }

  // Once KITCO has a value on file for a field, changing it needs KITCO -- this only
  // ever locks a field that already has an answer, so a dealer mid-onboarding can still
  // fill in whatever is still blank themselves. Mirrors the server-side check in
  // worker/routes/dealer-profile.ts's assertOnlyFillingBlanks exactly, so a field
  // that would be rejected there is never offered as editable here.
  function isLocked(key: keyof DealerProfile): boolean {
    return Boolean((state?.profile[key] as string | null)?.trim());
  }

  function showFieldError(key: keyof DealerProfile, required: boolean): string | undefined {
    if (isLocked(key)) return undefined;
    if (!touched[key] && !saveAttempted) return undefined;
    const value = draft[key] ?? "";
    if (!value.trim()) return required ? "This is required." : undefined;
    return formatError(key, value) || undefined;
  }

  // Only meaningful once a PIN lookup has actually returned a state for the
  // PIN code currently on screen -- that result is the source of truth this
  // compares both the typed State field and the GSTIN's state code against.
  // Never inferred from the PIN's first digit (postal zones span states).
  const pinState = pinLookup && pinLookup.pinCode === pinCode.trim() ? pinLookup.state : null;
  const draftGstin = draft.gstin ?? "";
  const draftState = draft.state ?? "";
  const mismatches: string[] = [];
  // Still worth flagging even once a field is locked: the dealer cannot fix it by
  // editing, but the checkbox below doesn't require that -- it just makes sure a real
  // discrepancy in already-saved data isn't saved over silently while filling in
  // whatever else is still blank. They contact KITCO separately to correct it.
  if (pinState && !sameStateName(pinState, draftState)) {
    mismatches.push(`the State field says "${draftState}", but PIN ${pinCode} is in ${pinState}`);
  }
  if (pinState && isValidGstin(draftGstin.trim().toUpperCase()) && !gstinMatchesState(draftGstin.trim().toUpperCase(), pinState)) {
    mismatches.push(`the GST number's state doesn't match ${pinState} (from the PIN code)`);
  }
  const mismatchWarning = mismatches.length > 0 ? `Double check this before saving: ${mismatches.join("; ")}.` : null;
  const mismatchAcknowledged = mismatchWarning !== null && mismatchAcknowledgedFor === mismatchWarning;
  const needsAcknowledgement = mismatchWarning !== null && !mismatchAcknowledged;
  // A locked field can't be fixed here even if legacy data would fail this check --
  // excluding it stops one untouchable field from silently blocking Save forever.
  const hasFormatError = FIELDS.some(({ key }) => !isLocked(key) && formatError(key, draft[key] ?? ""));

  async function save() {
    setSaveAttempted(true);
    if (hasFormatError || needsAcknowledgement) return;
    setSaving(true); setError(""); setMessage("");
    try {
      // Only send what changed, and send "" as null for the optional fields so a
      // cleared box actually clears rather than saving an empty string.
      const update: Record<string, string | null> = {};
      for (const { key, required } of FIELDS) {
        const value = (draft[key] ?? "").trim();
        const previous = ((state?.profile[key] as string | null) ?? "").trim();
        if (value === previous) continue;
        update[key] = value === "" ? (required ? "" : null) : value;
      }
      if (Object.keys(update).length === 0) { setMessage("Nothing to save yet."); return; }
      apply(await saveProfile(update));
      setMessage("Saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    setUploading(true); setError(""); setMessage("");
    try {
      apply(await uploadStorefrontPhoto(file));
      setMessage("Photo updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That photo could not be uploaded.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  if (status === "loading") return <main className="shell-content"><p role="status">Loading your details…</p></main>;
  if (status === "error" || !state) {
    return <main className="shell-content">
      <h1>Your details</h1>
      <p className="profile-error" role="alert">We could not load your details. Refresh the page to try again.</p>
    </main>;
  }

  const missing = new Set<RequiredProfileField>(state.missingFields);
  const photo = photoUrl(state.profile.storefrontPhotoKey);
  const anyLocked = FIELDS.some((field) => isLocked(field.key));

  return <main className="shell-content profile-page">
    <p className="eyebrow">Your account</p>
    <h1>Your details</h1>
    <p className="intro">
      KITCO needs these to invoice and deliver your orders.
    </p>

    {state.profileComplete
      ? <p className="profile-banner is-complete" role="status">
          <strong>All done.</strong> You can place orders.
        </p>
      : <div className="profile-banner is-blocked" role="alert">
          <strong>Fill these in before you can order</strong>
          <ul>{state.missingFields.map((field) => <li key={field}>{PROFILE_FIELD_LABELS[field]}</li>)}</ul>
        </div>}

    <section className="profile-photo" aria-label="Shop photo">
      <h2>Shop photo</h2>
      <p className="profile-hint">A picture of the front of your shop. Optional.</p>
      <div className="profile-photo-row">
        {photo
          ? <img src={photo} alt="The front of your shop" width={160} height={160} />
          : <div className="profile-photo-empty" role="img" aria-label="No shop photo yet">No photo yet</div>}
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }}
          />
          <Button variant="secondary" size="md" loading={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? "Uploading…" : photo ? "Change photo" : "Add photo"}
          </Button>
          <p className="profile-hint">JPG, PNG or WEBP, up to 5 MB.</p>
        </div>
      </div>
    </section>

    <section aria-label="Business details">
      <h2>Business details</h2>
      {anyLocked && <p className="profile-hint">
        Details you've already given us are locked. To change one, contact KITCO at {SUPPORT_EMAIL}.
      </p>}
      <div className="profile-grid">
        {FIELDS.map((field) => {
          const locked = isLocked(field.key);
          return <FormField
            key={field.key}
            label={field.label}
            htmlFor={`profile-${field.key}`}
            hint={locked ? "Locked — contact KITCO to change this" : field.hint}
            error={showFieldError(field.key, field.required)}
          >
            <Input
              id={`profile-${field.key}`}
              value={draft[field.key] ?? ""}
              type={field.type}
              inputMode={field.inputMode}
              maxLength={field.maxLength}
              autoComplete={field.autoComplete}
              spellCheck={false}
              readOnly={locked}
              aria-invalid={missing.has(field.key as RequiredProfileField) || undefined}
              onChange={locked ? undefined : (event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
              onBlur={locked ? undefined : blur(field.key)}
            />
          </FormField>;
        })}
      </div>
    </section>

    {mismatchWarning && <div className="profile-banner is-warning" role="alert">
      <strong>Warning</strong> {mismatchWarning}
      <Checkbox
        label="Yes, I've checked these details and they're correct"
        checked={mismatchAcknowledged}
        onChange={(event) => setMismatchAcknowledgedFor(event.target.checked ? mismatchWarning : null)}
      />
    </div>}

    {error && <p className="profile-error" role="alert">{error}</p>}
    {message && <p className="profile-message" role="status">{message}</p>}

    {/* Not disabled by hasFormatError/needsAcknowledgement up front: a dealer whose
        already-saved profile predates this validation must still see why Save did
        nothing, rather than find a dead button with no visible error (save() below
        surfaces the same checks as inline errors on click). */}
    <Button full size="md" loading={saving} onClick={() => void save()}>
      {saving ? "Saving…" : "Save my details"}
    </Button>
  </main>;
}
