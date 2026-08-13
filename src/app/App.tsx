import { useEffect, useState } from "react";
import { KitcoHeader } from "../components/KitcoHeader";
import { RouteTransition } from "../components/RouteTransition";
import { ActivationPage } from "../features/activation/ActivationPage";
import { LoginPage } from "../features/auth/LoginPage";
import { DealerCommercePage } from "../features/catalogue/DealerCommercePage";
import { requestOrderOtp } from "../features/orders/api";
import { ControlSurface, OrdersSurface } from "./PilotSurfaces";
import { dealerNavigation, routeHref } from "./router";

function WorkspaceHome() {
	return <main className="shell-content"><p className="eyebrow">Dealer workspace</p><h1>Browse your next collection.</h1><p className="intro">KITCO&apos;s dealer catalogue, ordering, and reporting experience is being prepared for the pilot.</p><a className="primary-action" href="/products">View products</a></main>;
}

export function App() {
	const [pathname, setPathname] = useState(() => window.location.pathname);
	useEffect(() => { const update = () => setPathname(window.location.pathname); window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update); }, []);
	const authPage = pathname === "/activate" ? <ActivationPage /> : pathname === "/login" ? <LoginPage /> : null;
	const isControl = pathname.startsWith("/control");
	const dealerPage = pathname.startsWith("/products") ? <DealerCommercePage requestOrderOtp={requestOrderOtp} /> : pathname.startsWith("/orders") ? <OrdersSurface /> : <WorkspaceHome />;
	return <div className="app-shell"><KitcoHeader />
		{authPage ? <main className="auth-shell"><RouteTransition>{authPage}</RouteTransition></main> : isControl ? <RouteTransition><ControlSurface /></RouteTransition> : <><nav className="dealer-nav" aria-label="Dealer navigation">{dealerNavigation.map(({ label, route }) => <a key={route} href={routeHref(route)} className={pathname.startsWith(routeHref(route)) ? "is-current" : undefined}>{label}</a>)}</nav><RouteTransition>{dealerPage}</RouteTransition></>}
		<footer>Pilot Environment · Developed by V L &amp; CO</footer>
	</div>;
}
