export function KitcoHeader() {
	return (
		<header className="site-header">
			<a className="brand" href="/" aria-label="KITCO Dealer Commerce home">
				<img src="/brand/kitco-sports.png" alt="KITCO Sports" width="114" height="45" />
				<span className="brand-copy"><strong>Dealer Commerce Platform</strong><span>Pilot Run · Developed by V L &amp; CO</span></span>
			</a>
			<p className="desktop-attribution">PILOT · Developed by V L &amp; CO</p>
			<span className="mobile-pilot" aria-label="Pilot environment">PILOT</span>
		</header>
	);
}
