import { useEffect, useState } from "react";
import { KitcoHeader } from "../components/KitcoHeader";
import { SUPPORT_EMAIL, SUPPORT_PHONE } from "../config/support";
import { RouteTransition } from "../components/RouteTransition";
import { ActivationPage } from "../features/activation/ActivationPage";
import { LoginPage } from "../features/auth/LoginPage";
import { DealerCommercePage } from "../features/catalogue/DealerCommercePage";
import { requestOrderOtp } from "../features/orders/api";
import { ControlSurface, OrdersSurface } from "./PilotSurfaces";
import { dealerNavigation, routeHref } from "./router";

export function App() {
	const [pathname, setPathname] = useState(() => window.location.pathname);
	useEffect(() => { const update = () => setPathname(window.location.pathname); window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update); }, []);
	const authPage = pathname === "/activate" ? <ActivationPage /> : pathname === "/" || pathname === "/login" ? <LoginPage /> : null;
	const isControl = pathname.startsWith("/control");
	const dealerPage = pathname.startsWith("/products") ? <DealerCommercePage requestOrderOtp={requestOrderOtp} /> : pathname.startsWith("/orders") ? <OrdersSurface /> : <OrdersSurface reports />;
	return <div className="app-shell"><KitcoHeader showSignOut={!authPage} />
		{authPage ? <main className="auth-shell"><RouteTransition>{authPage}</RouteTransition></main> : isControl ? <RouteTransition><ControlSurface /></RouteTransition> : <><nav className="dealer-nav" aria-label="Dealer navigation">{dealerNavigation.map(({ label, route }) => <a key={route} href={routeHref(route)} className={pathname.startsWith(routeHref(route)) ? "is-current" : undefined}>{label}</a>)}</nav><RouteTransition>{dealerPage}</RouteTransition></>}
		<footer><p>Need assistance? {SUPPORT_PHONE} | {SUPPORT_EMAIL}</p><p>© KITCO. Pilot Environment.</p></footer>
		{!authPage && !isControl && <nav className="ui-bottom-nav" aria-label="Dealer navigation (mobile)">
			<ul className="ui-bottom-nav-list">{dealerNavigation.map(({ label, route }) => <li key={route} className="ui-bottom-nav-item">
				<a href={routeHref(route)} className={`ui-bottom-nav-link${pathname.startsWith(routeHref(route)) ? " is-current" : ""}`} aria-current={pathname.startsWith(routeHref(route)) ? "page" : undefined}>{label}</a>
			</li>)}</ul>
		</nav>}
	</div>;
}
