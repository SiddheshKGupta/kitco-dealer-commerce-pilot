import { useEffect, useState } from "react";
import { OtpInput } from "../../components/OtpInput";
import { errorMessage, postJson } from "../auth/api";

interface Dealer { id: string; name: string; city: string | null; }
type Stage = "lookup" | "email" | "verify" | "complete";

export function ActivationPage() {
	const [query, setQuery] = useState(""); const [dealers, setDealers] = useState<Dealer[]>([]); const [dealer, setDealer] = useState<Dealer | null>(null);
	const [email, setEmail] = useState(""); const [code, setCode] = useState(""); const [password, setPassword] = useState(""); const [challengeId, setChallengeId] = useState("");
	const [stage, setStage] = useState<Stage>("lookup"); const [error, setError] = useState(""); const [resendIn, setResendIn] = useState(30);
	useEffect(() => {
		if (query.trim().length < 3) { setDealers([]); return; }
		let current = true;
		fetch(`/api/activation/dealers?q=${encodeURIComponent(query.trim())}`, { credentials: "include" }).then(async (response) => {
			const payload = await response.json() as { dealers?: Dealer[] }; if (current && response.ok) setDealers(payload.dealers ?? []);
		}).catch(() => current && setError("We could not search dealerships. Try again."));
		return () => { current = false; };
	}, [query]);
	useEffect(() => { if (stage !== "verify" || resendIn <= 0) return; const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000); return () => window.clearTimeout(timer); }, [stage, resendIn]);
	async function requestCode() {
		if (!dealer) return; setError("");
		try { const response = await postJson<{ challengeId: string }>("/api/activation/request-otp", { dealerId: dealer.id, email }); setChallengeId(response.challengeId); setResendIn(30); setStage("verify"); } catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
	}
	async function verify() {
		if (password.length < 12) { setError(errorMessage("PASSWORD_TOO_SHORT")); return; }
		setError(""); try { await postJson("/api/otp/verify", { challengeId, code, purpose: "ACTIVATION", password }); setStage("complete"); } catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
	}
	async function resend() {
		setError(""); try { const response = await postJson<{ challengeId: string }>("/api/otp/resend", { challengeId }); setChallengeId(response.challengeId); setResendIn(30); } catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
	}
	return <section className="auth-page"><div className="auth-kicker">Dealer activation <span>01 / 03</span></div><h1>Start with your dealership.</h1><p className="auth-intro">Confirm your dealer record, then create a secure account for the pilot.</p>
		{stage === "lookup" && <><label htmlFor="dealer-lookup">Find your dealership</label><input id="dealer-lookup" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type at least 3 characters" autoComplete="off" />{query.length > 0 && query.length < 3 && <p className="field-note">Enter at least 3 characters to search.</p>}<div className="dealer-results">{dealers.map((item) => <button className="dealer-result" type="button" key={item.id} onClick={() => { setDealer(item); setStage("email"); setError(""); }}>{item.name} · {item.city ?? "City unavailable"}</button>)}</div></>}
		{stage === "email" && <><p className="selection-label">{dealer?.name} · {dealer?.city}</p><h2>Choose an email</h2><p className="field-note">Registered email stays private. Enter the email you want to use for this controlled pilot.</p><label htmlFor="activation-email">Email for this activation</label><input id="activation-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /><button className="primary-action" type="button" disabled={!email} onClick={requestCode}>Send code</button></>}
		{stage === "verify" && <><h2>Enter the 6-digit code</h2><p className="field-note">We sent a verification code to your selected email.</p><OtpInput value={code} onChange={setCode} /><label htmlFor="activation-password">Create password</label><input id="activation-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><button className="primary-action" type="button" disabled={code.length !== 6} onClick={verify}>Verify and activate</button><button className="text-action" type="button" disabled={resendIn > 0} onClick={resend}>{resendIn > 0 ? `Resend available in ${resendIn}s` : "Resend code"}</button></>}
		{stage === "complete" && <div className="success-state"><p className="auth-kicker">Ready</p><h2>Activation complete</h2><p>Your dealer account is ready. Continue to the catalogue.</p><a className="primary-action" href="/products">View products</a></div>}
		{error && <p className="form-error" role="alert">{error}</p>}</section>;
}
