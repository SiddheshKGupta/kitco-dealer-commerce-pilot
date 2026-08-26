import { useEffect, useState } from "react";
import { Button, FormField, Input, OTPInput } from "../../components/ui";
import { errorMessage, postJson } from "./api";

/** V5_AUTH_FLOW.md §6. Mirrored from MINIMUM_PASSWORD_LENGTH in worker/routes/login.ts;
 *  the server is the one that enforces it, this only stops a wasted round trip. */
const MINIMUM_PASSWORD_LENGTH = 12;

type Stage = "identify" | "code" | "password" | "recover";

/** Every stage's control is disabled while its request is in flight and says what it is
 *  doing. Without it a double-tap on a shop counter fires two OTPs and invalidates the
 *  code the dealer is already reading. */
export function LoginPage() {
	const [stage, setStage] = useState<Stage>("identify");
	const [identifier, setIdentifier] = useState("");
	const [password, setPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [code, setCode] = useState("");
	const [challengeId, setChallengeId] = useState("");
	const [purpose, setPurpose] = useState<"LOGIN" | "PASSWORD_RESET">("LOGIN");
	const [role, setRole] = useState("DEALER");
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const [resendIn, setResendIn] = useState(60);

	useEffect(() => {
		if (stage !== "code" || resendIn <= 0) return;
		const timer = window.setTimeout(() => setResendIn((value) => value - 1), 1000);
		return () => window.clearTimeout(timer);
	}, [stage, resendIn]);

	async function run(label: string, action: () => Promise<void>) {
		if (busy) return;
		setError(""); setBusy(label);
		try { await action(); }
		catch (reason) { setError(errorMessage(reason instanceof Error ? reason.message : "REQUEST_FAILED")); }
		finally { setBusy(""); }
	}

	const signIn = () => run("Signing in…", async () => {
		const response = await postJson<{ challengeId: string }>("/api/login", { identifier: identifier.trim(), password });
		setChallengeId(response.challengeId); setPurpose("LOGIN"); setCode(""); setResendIn(60); setStage("code");
	});

	const requestReset = () => run("Sending…", async () => {
		const response = await postJson<{ challengeId: string }>("/api/login/reset", { identifier: identifier.trim() });
		setChallengeId(response.challengeId); setPurpose("PASSWORD_RESET"); setCode(""); setResendIn(60); setStage("code");
	});

	const verify = () => run("Checking…", async () => {
		const response = await postJson<{ role?: string; mustChangePassword?: boolean }>("/api/otp/verify", { challengeId, code, purpose });
		if (purpose === "PASSWORD_RESET" || response.mustChangePassword) {
			setRole(response.role ?? "DEALER"); setNewPassword(""); setStage("password");
			return;
		}
		go(response.role === "DEALER" ? "/products" : "/control");
	});

	const setNew = () => run("Saving…", async () => {
		const response = await postJson<{ role?: string }>("/api/login/password", { password: newPassword });
		go((response.role ?? role) === "DEALER" ? "/products" : "/control");
	});

	const resend = () => run("Sending…", async () => {
		const response = await postJson<{ challengeId: string }>("/api/otp/resend", { challengeId });
		setChallengeId(response.challengeId); setResendIn(60);
	});

	function go(destination: string) {
		window.history.replaceState({}, "", destination);
		window.dispatchEvent(new PopStateEvent("popstate"));
	}

	function back(to: Stage) {
		setError(""); setCode(""); setPassword(""); setStage(to);
	}

	// Icon and word, not colour alone: the state has to survive a reader who cannot
	// tell the border colour apart from the surrounding text.
	const alert = error ? <p className="form-error" role="alert"><span aria-hidden="true">✕</span> Problem: {error}</p> : null;

	if (stage === "password") return <section className="auth-page">
		<div className="auth-kicker">{purpose === "PASSWORD_RESET" ? "Reset your password" : "One last step"} <span>03 / 03</span></div>
		<h1>Choose your password.</h1>
		<p className="auth-intro">
			{purpose === "PASSWORD_RESET"
				? "Pick a new password. You'll use it every time you sign in."
				: "The password KITCO gave you was for this first sign-in only. Pick your own now — you cannot skip this step."}
		</p>
		<FormField label="New password" htmlFor="login-new-password" hint={`At least ${MINIMUM_PASSWORD_LENGTH} characters`}>
			<Input id="login-new-password" type="password" value={newPassword} autoComplete="new-password"
				onChange={(event) => setNewPassword(event.target.value)} />
		</FormField>
		<Button full disabled={newPassword.length < MINIMUM_PASSWORD_LENGTH || Boolean(busy)} onClick={setNew}>
			{busy || "Save and continue"}
		</Button>
		{alert}
	</section>;

	if (stage === "code") return <section className="auth-page">
		<div className="auth-kicker">Check your email <span>02 / 03</span></div>
		<h1>Enter your code.</h1>
		<p className="auth-intro">
			If that account exists, we've sent a 6-digit code to the email KITCO has on file for it. Type it in below.
		</p>
		<OTPInput value={code} onChange={setCode} />
		<Button full disabled={code.length !== 6 || Boolean(busy)} onClick={verify}>{busy || "Confirm"}</Button>
		<button className="text-action" type="button" disabled={resendIn > 0 || Boolean(busy)} onClick={resend}>
			{resendIn > 0 ? `You can ask for a new code in ${resendIn}s` : "Send me a new code"}
		</button>
		<button className="text-action" type="button" disabled={Boolean(busy)} onClick={() => back("identify")}>Start again</button>
		{alert}
	</section>;

	if (stage === "recover") return <section className="auth-page">
		<div className="auth-kicker">Forgotten password <span>01 / 03</span></div>
		<h1>Let's get you back in.</h1>
		<p className="auth-intro">Type any email KITCO has on file for you, or your Dealer Code, and we'll send you a code.</p>
		<FormField label="Email or Dealer Code" htmlFor="recover-identifier">
			<Input id="recover-identifier" value={identifier} autoComplete="username"
				onChange={(event) => setIdentifier(event.target.value)} />
		</FormField>
		<Button full disabled={!identifier.trim() || Boolean(busy)} onClick={requestReset}>{busy || "Send me a code"}</Button>
		<button className="text-action" type="button" disabled={Boolean(busy)} onClick={() => back("identify")}>Back to sign in</button>
		{alert}
	</section>;

	return <section className="auth-page">
		<div className="auth-kicker">Dealer sign in <span>01 / 03</span></div>
		<h1>Welcome back.</h1>
		<p className="auth-intro">Sign in with the password KITCO gave you. We'll email you a code to confirm it's you.</p>
		<FormField label="Email or Dealer Code" htmlFor="login-identifier" hint="Your primary email, secondary email, or Dealer Code -- whichever you have">
			<Input id="login-identifier" value={identifier} autoComplete="username"
				onChange={(event) => setIdentifier(event.target.value)} />
		</FormField>
		<FormField label="Password" htmlFor="login-password">
			<Input id="login-password" type="password" value={password} autoComplete="current-password"
				onChange={(event) => setPassword(event.target.value)} />
		</FormField>
		<Button full disabled={!identifier.trim() || !password || Boolean(busy)} onClick={signIn}>{busy || "Sign in"}</Button>
		<button className="text-action" type="button" disabled={Boolean(busy)} onClick={() => back("recover")}>I've forgotten my password</button>
		{alert}
	</section>;
}
