import type { ReactNode } from "react";

export function RouteTransition({ children }: { children: ReactNode }) {
	return <div className="route-transition">{children}</div>;
}
