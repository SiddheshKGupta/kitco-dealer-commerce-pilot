import { useEffect, useRef, useState } from "react";
import { Button, FormField, Input } from "../../components/ui";
import {
  PROFILE_FIELD_LABELS,
  type DealerProfile,
  type RequiredProfileField,
} from "../../domain/dealer-profile";
import {
  fetchProfile,
  photoUrl,
  saveProfile,
  uploadStorefrontPhoto,
  type ProfileResponse,
} from "./api";
import "./profile.css";

type Draft = Record<string, string>;

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
  { key: "pinCode", label: "PIN code", required: true, inputMode: "numeric", maxLength: 10, autoComplete: "postal-code" },
  { key: "contactPerson", label: "Contact person", hint: "Who should we speak to about orders?", required: true, autoComplete: "name" },
  { key: "mobile", label: "Mobile number", required: true, type: "tel", inputMode: "tel", maxLength: 20, autoComplete: "tel" },
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

  async function save() {
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
          <Button variant="secondary" size="md" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? "Uploading…" : photo ? "Change photo" : "Add photo"}
          </Button>
          <p className="profile-hint">JPG, PNG or WEBP, up to 5 MB.</p>
        </div>
      </div>
    </section>

    <section aria-label="Business details">
      <h2>Business details</h2>
      <div className="profile-grid">
        {FIELDS.map((field) => (
          <FormField
            key={field.key}
            label={field.label}
            htmlFor={`profile-${field.key}`}
            hint={field.hint}
          >
            <Input
              id={`profile-${field.key}`}
              value={draft[field.key] ?? ""}
              type={field.type}
              inputMode={field.inputMode}
              maxLength={field.maxLength}
              autoComplete={field.autoComplete}
              spellCheck={false}
              aria-invalid={missing.has(field.key as RequiredProfileField) || undefined}
              onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          </FormField>
        ))}
      </div>
    </section>

    {error && <p className="profile-error" role="alert">{error}</p>}
    {message && <p className="profile-message" role="status">{message}</p>}

    <Button full size="md" disabled={saving} onClick={() => void save()}>
      {saving ? "Saving…" : "Save my details"}
    </Button>
  </main>;
}
