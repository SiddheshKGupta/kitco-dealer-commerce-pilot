import { useState } from "react";
import { Button, FormField, Input, OTPInput } from "../../components/ui";
import { errorMessage, postJson } from "../auth/api";

interface FormState {
	businessName: string; gstin: string; addressLine1: string; addressLine2: string;
	city: string; state: string; pinCode: string; contactPerson: string;
	primaryEmail: string; secondaryEmail: string; mobile: string;
}

const empty: FormState = { businessName: "", gstin: "", addressLine1: "", addressLine2: "", city: "", state: "", pinCode: "", contactPerson: "", primaryEmail: "", secondaryEmail: "", mobile: "" };

type Stage = "form" | "verify";

/** Brand-new dealer with no existing record -- pilot self-activates on OTP
 *  verification (no admin approval gate) and lands directly in /products. */
export function RegisterPage() {
	const [form, setForm] = useState<FormState>(empty);
	const [applicationId, setApplicationId] = useState("");
	const [challengeId, setChallengeId] = useState("");
	const [code, setCode] = useState("");
	const [stage, setStage] = useState<Stage>("form");
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [resendIn, setResendIn] = useState(30);

	function set<K extends keyof FormState>(key: K) {
		return (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
	}

	const canSubmit = form.businessName && form.gstin.length === 15 && form.addressLine1 && form.city && form.state && form.pinCode && form.contactPerson && form.primaryEmail && form.mobile;

	async function submitApplication() {
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
			setChallengeId(otp.challengeId); setResendIn(30); setStage("verify");
		} catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
		finally { setPending(false); }
	}

	async function verify() {
		setError(""); setPending(true);
		try {
			await postJson("/api/otp/verify", { challengeId, code, purpose: "REGISTRATION" });
			window.history.replaceState({}, "", "/products");
			window.dispatchEvent(new PopStateEvent("popstate"));
		} catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
		finally { setPending(false); }
	}

	async function resend() {
		setError("");
		try {
			const otp = await postJson<{ challengeId: string }>(`/api/register/${applicationId}/otp`, {});
			setChallengeId(otp.challengeId); setResendIn(30);
		} catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
	}

	if (stage === "verify") return <section className="auth-page">
		<div className="auth-kicker">New dealer registration <span>02 / 02</span></div>
		<h1>Verify your email</h1>
		<p className="auth-intro">We sent a verification code to {form.primaryEmail}.</p>
		<OTPInput value={code} onChange={setCode} />
		<Button full disabled={code.length !== 6 || pending} onClick={() => void verify()}>{pending ? "Verifying…" : "Activate and continue"}</Button>
		<button className="text-action" type="button" disabled={resendIn > 0} onClick={() => void resend()}>{resendIn > 0 ? `Resend available in ${resendIn}s` : "Resend code"}</button>
		{error && <p className="form-error" role="alert">{error}</p>}
	</section>;

	return <section className="auth-page auth-page-wide">
		<div className="auth-kicker">New dealer registration <span>01 / 02</span></div>
		<h1>Tell us about your dealership.</h1>
		<p className="auth-intro">KITCO doesn't have this dealership on file yet. Submit your details to get started.</p>
		<div className="auth-form-grid">
			<FormField label="Business name" htmlFor="reg-business"><Input id="reg-business" value={form.businessName} onChange={set("businessName")} /></FormField>
			<FormField label="GSTIN" htmlFor="reg-gstin" hint="15 characters"><Input id="reg-gstin" value={form.gstin} onChange={(event) => setForm((current) => ({ ...current, gstin: event.target.value.toUpperCase() }))} maxLength={15} /></FormField>
			<FormField label="Address line 1" htmlFor="reg-address1"><Input id="reg-address1" value={form.addressLine1} onChange={set("addressLine1")} /></FormField>
			<FormField label="Address line 2 (optional)" htmlFor="reg-address2"><Input id="reg-address2" value={form.addressLine2} onChange={set("addressLine2")} /></FormField>
			<FormField label="City" htmlFor="reg-city"><Input id="reg-city" value={form.city} onChange={set("city")} /></FormField>
			<FormField label="State" htmlFor="reg-state"><Input id="reg-state" value={form.state} onChange={set("state")} /></FormField>
			<FormField label="PIN code" htmlFor="reg-pin"><Input id="reg-pin" value={form.pinCode} onChange={set("pinCode")} maxLength={10} /></FormField>
			<FormField label="Contact person" htmlFor="reg-contact"><Input id="reg-contact" value={form.contactPerson} onChange={set("contactPerson")} /></FormField>
			<FormField label="Primary email" htmlFor="reg-email"><Input id="reg-email" type="email" value={form.primaryEmail} onChange={set("primaryEmail")} /></FormField>
			<FormField label="Secondary email (optional)" htmlFor="reg-email2" hint="In case the primary email isn't checked regularly"><Input id="reg-email2" type="email" value={form.secondaryEmail} onChange={set("secondaryEmail")} /></FormField>
			<FormField label="Mobile" htmlFor="reg-mobile"><Input id="reg-mobile" value={form.mobile} onChange={set("mobile")} /></FormField>
		</div>
		<Button full disabled={!canSubmit || pending} onClick={() => void submitApplication()}>{pending ? "Submitting…" : "Continue"}</Button>
		{error && <p className="form-error" role="alert">{error}</p>}
	</section>;
}
