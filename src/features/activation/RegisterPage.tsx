import { useEffect, useState } from "react";
import { Button, Checkbox, FormField, Input, OTPInput } from "../../components/ui";
import { gstinMatchesState, isValidGstin, sameStateName } from "../../domain/gstin";
import { lookupPincode } from "../dealer/api";
import { errorMessage, postJson } from "../auth/api";

interface FormState {
	businessName: string; gstin: string; addressLine1: string; addressLine2: string;
	city: string; state: string; pinCode: string; contactPerson: string;
	primaryEmail: string; secondaryEmail: string; mobile: string;
}

const empty: FormState = { businessName: "", gstin: "", addressLine1: "", addressLine2: "", city: "", state: "", pinCode: "", contactPerson: "", primaryEmail: "", secondaryEmail: "", mobile: "" };

const MOBILE_REGEX = /^[6-9][0-9]{9}$/u;
const PIN_CODE_REGEX = /^[0-9]{6}$/u;

/** Required-field and format checks the dealer sees inline, before ever hitting
 *  the server -- a disabled button with no explanation just gets reported as
 *  "the form doesn't work". Empty string means "no error". */
function fieldError(key: keyof FormState, value: string): string {
	switch (key) {
		case "businessName": return value.trim() ? "" : "Enter your business name.";
		case "gstin":
			if (!value.trim()) return "Enter your GSTIN.";
			return isValidGstin(value.trim()) ? "" : "Enter a valid 15-character GSTIN.";
		case "addressLine1": return value.trim() ? "" : "Enter your address.";
		case "city": return value.trim() ? "" : "Enter your city.";
		case "state": return value.trim() ? "" : "Enter your state.";
		case "pinCode":
			if (!value.trim()) return "Enter your PIN code.";
			return PIN_CODE_REGEX.test(value) ? "" : "Enter a 6-digit PIN code.";
		case "contactPerson": return value.trim() ? "" : "Enter a contact person.";
		case "primaryEmail": return value.trim() ? "" : "Enter your email.";
		case "mobile":
			if (!value.trim()) return "Enter your mobile number.";
			return MOBILE_REGEX.test(value) ? "" : "Enter a 10-digit mobile number starting with 6-9.";
		default: return "";
	}
}

const REQUIRED_KEYS: Array<keyof FormState> = ["businessName", "gstin", "addressLine1", "city", "state", "pinCode", "contactPerson", "primaryEmail", "mobile"];

function isFormValid(form: FormState): boolean {
	return REQUIRED_KEYS.every((key) => !fieldError(key, form[key]));
}

type Stage = "form" | "verify" | "submitted";

/** Brand-new dealer with no existing record -- pilot self-activates on OTP
 *  verification (no admin approval gate) and lands directly in /products. */
export function RegisterPage() {
	const [form, setForm] = useState<FormState>(empty);
	const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
	const [submitAttempted, setSubmitAttempted] = useState(false);
	// The PIN lookup's own state, for the pinCode it was fetched for -- the source
	// of truth for the state cross-check below (never the PIN's first digit; see
	// docs/spec/V5_GST_INTEGRATION.md). Stale once pinCode changes again.
	const [pinLookup, setPinLookup] = useState<{ pinCode: string; state: string } | null>(null);
	const [mismatchAcknowledgedFor, setMismatchAcknowledgedFor] = useState<string | null>(null);
	const [applicationId, setApplicationId] = useState("");
	const [challengeId, setChallengeId] = useState("");
	const [code, setCode] = useState("");
	const [stage, setStage] = useState<Stage>("form");
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [resendIn, setResendIn] = useState(60);

	function set<K extends keyof FormState>(key: K) {
		return (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
	}

	function blur<K extends keyof FormState>(key: K) {
		return () => setTouched((current) => ({ ...current, [key]: true }));
	}

	function showError<K extends keyof FormState>(key: K): string | undefined {
		if (!touched[key] && !submitAttempted) return undefined;
		return fieldError(key, form[key]) || undefined;
	}

	// Auto-fills city/state from the PIN once it's 6 digits -- but only into a
	// blank field. A field the dealer already typed something into is left
	// alone (still editable) so a genuine conflict surfaces as the mismatch
	// warning below instead of being silently overwritten. Fails open: an
	// unknown PIN or an unreachable provider just leaves the fields as they
	// are, no error shown.
	useEffect(() => {
		const pinCode = form.pinCode.trim();
		if (!PIN_CODE_REGEX.test(pinCode)) { setPinLookup(null); return; }
		let active = true;
		lookupPincode(pinCode).then((result) => {
			if (!active || !result.found || !result.state) return;
			setPinLookup({ pinCode, state: result.state });
			setForm((current) => (current.pinCode === pinCode
				? {
					...current,
					city: current.city.trim() ? current.city : (result.city ?? current.city),
					state: current.state.trim() ? current.state : result.state!,
				}
				: current));
		});
		return () => { active = false; };
	}, [form.pinCode]);

	// Only meaningful once a PIN lookup has actually returned a state for the
	// PIN code currently on screen -- that result is the source of truth this
	// compares both the typed State field and the GSTIN's state code against.
	// Never inferred from the PIN's first digit (postal zones span states).
	const pinState = pinLookup && pinLookup.pinCode === form.pinCode.trim() ? pinLookup.state : null;
	const mismatches: string[] = [];
	if (pinState && !sameStateName(pinState, form.state)) {
		mismatches.push(`the State field says "${form.state}", but PIN ${form.pinCode} is in ${pinState}`);
	}
	if (pinState && isValidGstin(form.gstin.trim()) && !gstinMatchesState(form.gstin.trim(), pinState)) {
		mismatches.push(`the GSTIN's state doesn't match ${pinState} (from the PIN code)`);
	}
	const mismatchWarning = mismatches.length > 0 ? `Double check this before continuing: ${mismatches.join("; ")}.` : null;
	const mismatchAcknowledged = mismatchWarning !== null && mismatchAcknowledgedFor === mismatchWarning;
	const needsAcknowledgement = mismatchWarning !== null && !mismatchAcknowledged;

	const canSubmit = isFormValid(form) && !needsAcknowledgement;

	async function submitApplication() {
		setSubmitAttempted(true);
		if (!canSubmit) return;
		setError(""); setPending(true);
		try {
			const { applicationId: id } = await postJson<{ applicationId: string }>("/api/register", {
				businessName: form.businessName, gstin: form.gstin, addressLine1: form.addressLine1,
				addressLine2: form.addressLine2 || undefined, city: form.city, state: form.state, pinCode: form.pinCode,
				contactPerson: form.contactPerson, primaryEmail: form.primaryEmail, secondaryEmail: form.secondaryEmail || undefined,
				mobile: form.mobile,
			});
			setApplicationId(id);
			const otp = await postJson<{ challengeId: string }>(`/api/register/${id}/otp`, {});
			setChallengeId(otp.challengeId); setResendIn(60); setStage("verify");
		} catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
		finally { setPending(false); }
	}

	async function verify() {
		setError(""); setPending(true);
		try {
			// Confirming the code submits the application for review -- it does not
			// sign anyone in. KITCO decides who becomes a dealer.
			await postJson("/api/otp/verify", { challengeId, code, purpose: "REGISTRATION" });
			setStage("submitted");
		} catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
		finally { setPending(false); }
	}

	async function resend() {
		setError("");
		try {
			const otp = await postJson<{ challengeId: string }>(`/api/register/${applicationId}/otp`, {});
			setChallengeId(otp.challengeId); setResendIn(60);
		} catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
	}

	if (stage === "submitted") return <section className="auth-page">
		<div className="auth-kicker">New dealer registration <span>Sent</span></div>
		<h1>Thanks — that's with KITCO now.</h1>
		<p className="auth-intro">
			We've sent your shop's details to KITCO for review. They'll email {form.primaryEmail} with
			their decision, and if you're approved that email will tell you how to set up your account.
		</p>
		<p className="field-note">You don't need to do anything else, and you don't need to register again.</p>
		<a className="ui-btn ui-btn-secondary ui-btn-md" href="/login">Back to sign in</a>
	</section>;

	if (stage === "verify") return <section className="auth-page">
		<div className="auth-kicker">New dealer registration <span>02 / 02</span></div>
		<h1>Enter your code.</h1>
		<p className="auth-intro">We just emailed a 6-digit code to {form.primaryEmail}. Confirming it sends your details to KITCO for review.</p>
		<OTPInput value={code} onChange={setCode} />
		<Button full disabled={code.length !== 6 || pending} onClick={() => void verify()}>{pending ? "Sending…" : "Send my details to KITCO"}</Button>
		<button className="text-action" type="button" disabled={resendIn > 0} onClick={() => void resend()}>{resendIn > 0 ? `You can ask for a new code in ${resendIn}s` : "Send me a new code"}</button>
		{error && <p className="form-error" role="alert">{error}</p>}
	</section>;

	return <section className="auth-page auth-page-wide">
		<div className="auth-kicker">New dealer registration <span>01 / 02</span></div>
		<h1>Tell us about your shop.</h1>
		<p className="auth-intro">We don't have your shop on file yet. Fill in the details below and KITCO will review them — they'll email you either way.</p>
		<div className="auth-form-grid">
			<FormField label="Business name" htmlFor="reg-business" error={showError("businessName")}><Input id="reg-business" value={form.businessName} onChange={set("businessName")} onBlur={blur("businessName")} /></FormField>
			<FormField label="GSTIN" htmlFor="reg-gstin" hint="15 characters" error={showError("gstin")}><Input id="reg-gstin" value={form.gstin} onChange={(event) => setForm((current) => ({ ...current, gstin: event.target.value.toUpperCase() }))} onBlur={blur("gstin")} maxLength={15} /></FormField>
			<FormField label="Address line 1" htmlFor="reg-address1" error={showError("addressLine1")}><Input id="reg-address1" value={form.addressLine1} onChange={set("addressLine1")} onBlur={blur("addressLine1")} /></FormField>
			<FormField label="Address line 2 (optional)" htmlFor="reg-address2"><Input id="reg-address2" value={form.addressLine2} onChange={set("addressLine2")} /></FormField>
			<FormField label="PIN code" htmlFor="reg-pin" hint="City and state fill in automatically" error={showError("pinCode")}><Input id="reg-pin" value={form.pinCode} onChange={set("pinCode")} onBlur={blur("pinCode")} inputMode="numeric" maxLength={6} /></FormField>
			<FormField label="City" htmlFor="reg-city" error={showError("city")}><Input id="reg-city" value={form.city} onChange={set("city")} onBlur={blur("city")} /></FormField>
			<FormField label="State" htmlFor="reg-state" error={showError("state")}><Input id="reg-state" value={form.state} onChange={set("state")} onBlur={blur("state")} /></FormField>
			<FormField label="Contact person" htmlFor="reg-contact" error={showError("contactPerson")}><Input id="reg-contact" value={form.contactPerson} onChange={set("contactPerson")} onBlur={blur("contactPerson")} /></FormField>
			<FormField label="Your email" htmlFor="reg-email" error={showError("primaryEmail")}><Input id="reg-email" type="email" value={form.primaryEmail} onChange={set("primaryEmail")} onBlur={blur("primaryEmail")} /></FormField>
			<FormField label="A second email (optional)" htmlFor="reg-email2" hint="In case you don't check the first one often"><Input id="reg-email2" type="email" value={form.secondaryEmail} onChange={set("secondaryEmail")} /></FormField>
			<FormField label="Mobile number" htmlFor="reg-mobile" error={showError("mobile")}><Input id="reg-mobile" value={form.mobile} onChange={set("mobile")} onBlur={blur("mobile")} inputMode="tel" maxLength={10} /></FormField>
		</div>
		{mismatchWarning && <div className="form-error" role="alert">
			<strong>Warning: </strong>{mismatchWarning}
			<div style={{ marginTop: 8 }}>
				<Checkbox
					label="Yes, I've checked these details and they're correct"
					checked={mismatchAcknowledged}
					onChange={(event) => setMismatchAcknowledgedFor(event.target.checked ? mismatchWarning : null)}
				/>
			</div>
		</div>}
		<Button full disabled={pending} onClick={() => void submitApplication()}>{pending ? "Sending…" : "Continue"}</Button>
		{error && <p className="form-error" role="alert">{error}</p>}
	</section>;
}
