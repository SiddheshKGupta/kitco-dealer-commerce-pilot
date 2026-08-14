import { useState } from "react";
import { Button } from "./ui";

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
				<span className="brand-copy"><strong>Dealer Commerce Platform</strong><span>Pilot Run · Developed by V L &amp; CO</span></span>
			</a>
			<p className="desktop-attribution">PILOT</p>
			<span className="mobile-pilot" aria-label="Pilot environment">PILOT</span>
			{showSignOut && <Button variant="secondary" size="md" onClick={signOut} loading={signingOut}>Sign out</Button>}
		</header>
	);
}
