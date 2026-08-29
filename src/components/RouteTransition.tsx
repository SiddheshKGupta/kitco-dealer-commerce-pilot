import { useEffect, useState, type ReactNode } from "react";

/** The .route-transition animation runs on mount. Without a key that changes with the
 *  route, this wrapper is the one node React keeps across a navigation, so the page
 *  entrance only ever played on first load -- a transition the CSS promised and the
 *  dealer never saw. The children remount on a route change either way (each route
 *  renders a different component), so keying the wrapper costs nothing extra. */
export function RouteTransition({ children }: { children: ReactNode }) {
	const [pathname, setPathname] = useState(() => window.location.pathname);
	useEffect(() => {
		const update = () => setPathname(window.location.pathname);
		window.addEventListener("popstate", update);
		return () => window.removeEventListener("popstate", update);
	}, []);
	return <div key={pathname} className="route-transition">{children}</div>;
}
