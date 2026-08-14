import { useState } from "react";

export function KitcoHeader({ showSignOut = false }: { showSignOut?: boolean }) {
	const [signingOut, setSigningOut] = useState(false);
	async function signOut() {
		setSigningOut(true);
		try {
			await fetch("/api/logout", { method: "POST", credentials: "include" });
		} finally {
			window.location.href = "/login";
		}
	}
	return (
		<header className="site-header">
			<a className="brand" href="/" aria-label="KITCO Dealer Commerce home">
				<img src="/brand/kitco-sports.png" alt="KITCO Sports" width="114" height="45" />
				<span className="brand-copy"><strong>Dealer Commerce Platform</strong><span>Pilot Run</span></span>
			</a>
			<p className="desktop-attribution">PILOT · Developed by V L &amp; CO</p>
			<span className="mobile-pilot" aria-label="Pilot environment">PILOT</span>
			{showSignOut && <button type="button" className="sign-out-action" onClick={signOut} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>}
		</header>
	);
}
