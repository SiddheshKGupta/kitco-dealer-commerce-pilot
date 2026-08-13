import { dealerNavigation, routeHref } from "./router";

export function App() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/products" aria-label="KITCO Dealer Commerce home">
          <img src="/brand/kitco-sports.png" alt="KITCO Sports" width="114" height="45" />
          <span className="brand-copy">
            <strong>Dealer Commerce Platform</strong>
            <span>Pilot Run · Developed by V L &amp; CO</span>
          </span>
        </a>
        <p className="desktop-attribution">PILOT · Developed by V L &amp; CO</p>
        <span className="mobile-pilot" aria-label="Pilot environment">PILOT</span>
      </header>

      <nav className="dealer-nav" aria-label="Dealer navigation">
        {dealerNavigation.map(({ label, route }) => (
          <a key={route} href={routeHref(route)} className={route === "products" ? "is-current" : undefined}>
            {label}
          </a>
        ))}
      </nav>

      <main className="shell-content">
        <p className="eyebrow">Dealer workspace</p>
        <h1>Browse your next collection.</h1>
        <p className="intro">
          KITCO&apos;s dealer catalogue, ordering, and reporting experience is being prepared for the pilot.
        </p>
        <a className="primary-action" href="/products">View products</a>
      </main>

      <footer> Pilot Environment · Developed by V L &amp; CO </footer>
    </div>
  );
}
