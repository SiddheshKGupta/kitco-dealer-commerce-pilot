import { useEffect, useState } from "react";
import { KitcoHeader } from "../components/KitcoHeader";
import { SUPPORT_EMAIL } from "../config/support";
import { RouteTransition } from "../components/RouteTransition";
import { AuthLandingPage } from "../features/auth/AuthLandingPage";
import { DealerCommercePage } from "../features/catalogue/DealerCommercePage";
import { CartPage } from "../features/orders/CartPage";
import { ReviewPage } from "../features/orders/ReviewPage";
import { fetchDraft, requestOrderOtp } from "../features/orders/api";
import { ControlSurface, OrdersSurface } from "./PilotSurfaces";
import { dealerNavigation, routeHref } from "./router";

export function App() {
	const [pathname, setPathname] = useState(() => window.location.pathname);
	const [cartCount, setCartCount] = useState(0);
	useEffect(() => { const update = () => setPathname(window.location.pathname); window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update); }, []);
	const authPage = pathname === "/" || pathname === "/login" || pathname === "/activate" || pathname === "/register" ? <AuthLandingPage pathname={pathname} /> : null;
	const isControl = pathname.startsWith("/control");
	useEffect(() => {
		if (authPage || isControl) return;
		let active = true;
		fetchDraft().then((body) => { if (active) setCartCount(body.lines.length); }).catch(() => undefined);
		return () => { active = false; };
	}, [pathname, authPage, isControl]);
	const dealerPage = pathname.startsWith("/products") ? <DealerCommercePage />
		: pathname.startsWith("/cart") ? <CartPage />
		: pathname.startsWith("/checkout/review") ? <ReviewPage requestOrderOtp={requestOrderOtp} />
		: pathname.startsWith("/orders") ? <OrdersSurface />
		: <OrdersSurface reports />;
	const navLink = (label: string, route: string) => <>
		{label}
		{route === "cart" && cartCount > 0 && <span className="ui-bottom-nav-badge">{cartCount}</span>}
	</>;
	return <div className="app-shell"><KitcoHeader showSignOut={!authPage} />
		{authPage ? <main className="auth-shell"><RouteTransition>{authPage}</RouteTransition></main> : isControl ? <RouteTransition><ControlSurface /></RouteTransition> : <><nav className="dealer-nav" aria-label="Dealer navigation">{dealerNavigation.map(({ label, route }) => <a key={route} href={routeHref(route)} className={pathname.startsWith(routeHref(route)) ? "is-current" : undefined}>{navLink(label, route)}</a>)}</nav><RouteTransition>{dealerPage}</RouteTransition></>}
		<footer><p>Developed by V L &amp; CO</p><p>Contact: {SUPPORT_EMAIL}</p><p>© KITCO. Pilot Environment.</p></footer>
		{!authPage && !isControl && <nav className="ui-bottom-nav" aria-label="Dealer navigation (mobile)">
			<ul className="ui-bottom-nav-list">{dealerNavigation.map(({ label, route }) => <li key={route} className="ui-bottom-nav-item">
				<a href={routeHref(route)} className={`ui-bottom-nav-link${pathname.startsWith(routeHref(route)) ? " is-current" : ""}`} aria-current={pathname.startsWith(routeHref(route)) ? "page" : undefined}>{navLink(label, route)}</a>
			</li>)}</ul>
		</nav>}
	</div>;
}
