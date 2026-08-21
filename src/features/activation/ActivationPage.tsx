import { useEffect, useState } from "react";
import { Button, FormField, Input, OTPInput } from "../../components/ui";
import { errorMessage, postJson } from "../auth/api";

interface Dealer { id: string; name: string; city: string | null; }
interface Business { gstin: string; addressLine1: string; addressLine2: string; city: string; state: string; pinCode: string; contactPerson: string; mobile: string; }
type Stage = "lookup" | "business" | "email" | "verify" | "complete";

const emptyBusiness: Business = { gstin: "", addressLine1: "", addressLine2: "", city: "", state: "", pinCode: "", contactPerson: "", mobile: "" };

export function ActivationPage() {
	const [query, setQuery] = useState(""); const [dealers, setDealers] = useState<Dealer[]>([]); const [dealer, setDealer] = useState<Dealer | null>(null);
	const [maskedMasterEmail, setMaskedMasterEmail] = useState<string | null>(null); const [useAlternate, setUseAlternate] = useState(false);
	const [email, setEmail] = useState(""); const [code, setCode] = useState(""); const [challengeId, setChallengeId] = useState("");
	const [business, setBusiness] = useState<Business>(emptyBusiness);
	const [stage, setStage] = useState<Stage>("lookup"); const [error, setError] = useState(""); const [resendIn, setResendIn] = useState(60);
	useEffect(() => {
		if (query.trim().length < 3) { setDealers([]); return; }
		let current = true;
		fetch(`/api/activation/dealers?q=${encodeURIComponent(query.trim())}`, { credentials: "include" }).then(async (response) => {
			const payload = await response.json() as { dealers?: Dealer[] }; if (current && response.ok) setDealers(payload.dealers ?? []);
		}).catch(() => current && setError("We could not search dealerships. Try again."));
		return () => { current = false; };
	}, [query]);
	useEffect(() => { if (stage !== "verify" || resendIn <= 0) return; const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000); return () => window.clearTimeout(timer); }, [stage, resendIn]);
	function selectDealer(item: Dealer) {
		setDealer(item); setStage("business"); setError(""); setUseAlternate(false); setMaskedMasterEmail(null); setEmail(""); setBusiness(emptyBusiness);
		fetch(`/api/activation/dealers/${item.id}`, { credentials: "include" }).then(async (response) => {
			const payload = await response.json() as {
				maskedMasterEmail?: string | null; gstin?: string | null; addressLine1?: string | null; addressLine2?: string | null;
				city?: string | null; state?: string | null; pinCode?: string | null; contactPerson?: string | null; mobile?: string | null;
			};
			if (response.ok) {
				setMaskedMasterEmail(payload.maskedMasterEmail ?? null);
				setBusiness({
					gstin: payload.gstin ?? "", addressLine1: payload.addressLine1 ?? "", addressLine2: payload.addressLine2 ?? "",
					city: payload.city ?? item.city ?? "", state: payload.state ?? "", pinCode: payload.pinCode ?? "",
					contactPerson: payload.contactPerson ?? "", mobile: payload.mobile ?? "",
				});
			} else setUseAlternate(true);
		}).catch(() => setUseAlternate(true));
	}
	function setBusinessField<K extends keyof Business>(key: K) {
		return (event: React.ChangeEvent<HTMLInputElement>) => setBusiness((current) => ({ ...current, [key]: event.target.value }));
	}
	const businessComplete = Boolean(business.gstin.length === 15 && business.addressLine1 && business.city && business.state && business.pinCode && business.contactPerson && business.mobile);
	async function requestCode(useMaster: boolean) {
		if (!dealer) return; setError("");
		try {
			const response = await postJson<{ challengeId: string }>("/api/activation/request-otp", useMaster ? { dealerId: dealer.id, emailChoice: "MASTER", business } : { dealerId: dealer.id, email, business });
			setChallengeId(response.challengeId); setResendIn(60); setStage("verify");
		} catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
	}
	async function verify() {
		setError(""); try { await postJson("/api/otp/verify", { challengeId, code, purpose: "ACTIVATION" }); setStage("complete"); } catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
	}
	async function resend() {
		setError(""); try { const response = await postJson<{ challengeId: string }>("/api/otp/resend", { challengeId }); setChallengeId(response.challengeId); setResendIn(60); } catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
	}
	return <section className={stage === "business" ? "auth-page auth-page-wide" : "auth-page"}><div className="auth-kicker">Dealer activation <span>01 / 03</span></div><h1>Let's find your shop.</h1><p className="auth-intro">Search for your shop below, confirm a few details, then check your email. That's it.</p>
		{stage === "lookup" && <><label htmlFor="dealer-lookup">Search for your shop</label><Input id="dealer-lookup" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type your shop's name" autoComplete="off" />{query.length > 0 && query.length < 3 && <p className="field-note">Type at least 3 letters to search.</p>}<div className="dealer-results">{dealers.map((item) => <button className="dealer-result" type="button" key={item.id} onClick={() => selectDealer(item)}>{item.name} · {item.city ?? "City unavailable"}</button>)}</div>{query.trim().length >= 3 && <p className="field-note">Don't see your shop? <a href="/register">Register as a new dealer</a></p>}</>}
		{stage === "business" && <><p className="selection-label">{dealer?.name} · {dealer?.city}</p><h2>A few business details</h2><p className="field-note">We need your GSTIN and address to activate your account.</p>
			<div className="auth-form-grid">
				<FormField label="GSTIN" htmlFor="act-gstin" hint="15 characters"><Input id="act-gstin" value={business.gstin} onChange={(event) => setBusiness((current) => ({ ...current, gstin: event.target.value.toUpperCase() }))} maxLength={15} /></FormField>
				<FormField label="Address line 1" htmlFor="act-address1"><Input id="act-address1" value={business.addressLine1} onChange={setBusinessField("addressLine1")} /></FormField>
				<FormField label="Address line 2 (optional)" htmlFor="act-address2"><Input id="act-address2" value={business.addressLine2} onChange={setBusinessField("addressLine2")} /></FormField>
				<FormField label="City" htmlFor="act-city"><Input id="act-city" value={business.city} onChange={setBusinessField("city")} /></FormField>
				<FormField label="State" htmlFor="act-state"><Input id="act-state" value={business.state} onChange={setBusinessField("state")} /></FormField>
				<FormField label="PIN code" htmlFor="act-pin"><Input id="act-pin" value={business.pinCode} onChange={setBusinessField("pinCode")} maxLength={10} /></FormField>
				<FormField label="Contact person" htmlFor="act-contact"><Input id="act-contact" value={business.contactPerson} onChange={setBusinessField("contactPerson")} /></FormField>
				<FormField label="Mobile" htmlFor="act-mobile"><Input id="act-mobile" value={business.mobile} onChange={setBusinessField("mobile")} /></FormField>
			</div>
			<Button full disabled={!businessComplete} onClick={() => setStage("email")}>Continue</Button>
		</>}
		{stage === "email" && <><p className="selection-label">{dealer?.name} · {dealer?.city}</p><h2>Where should we send your code?</h2>
			{maskedMasterEmail && !useAlternate ? <>
				<p className="field-note">We have this email on file: <strong>{maskedMasterEmail}</strong></p>
				<Button full onClick={() => void requestCode(true)}>Send my code</Button>
				<button className="text-action" type="button" onClick={() => setUseAlternate(true)}>Can't get to that inbox? Use a different email</button>
			</> : <>
				<p className="field-note">We'll keep your email on file private. Enter the one you'd like to use instead.</p>
				<label htmlFor="activation-email">Your email</label><Input id="activation-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
				<Button full disabled={!email} onClick={() => void requestCode(false)}>Send my code</Button>
				{maskedMasterEmail && <button className="text-action" type="button" onClick={() => setUseAlternate(false)}>Use the email on file instead</button>}
			</>}</>}
		{stage === "verify" && <><h2>Enter your code.</h2><p className="field-note">We just emailed you a 6-digit code.</p><OTPInput value={code} onChange={setCode} /><Button full disabled={code.length !== 6} onClick={verify}>Confirm and activate</Button><button className="text-action" type="button" disabled={resendIn > 0} onClick={resend}>{resendIn > 0 ? `You can ask for a new code in ${resendIn}s` : "Send me a new code"}</button></>}
		{stage === "complete" && <div className="success-state"><p className="auth-kicker">You're all set</p><h2>Your account is ready.</h2><p>You can start browsing and ordering right away.</p><a className="ui-btn ui-btn-primary ui-btn-md" href="/products">Browse products</a></div>}
		{error && <p className="form-error" role="alert">{error}</p>}</section>;
}
