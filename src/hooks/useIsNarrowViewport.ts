import { useEffect, useState } from "react";

/** True below breakpointPx. Used to swap a dense desktop layout for a mobile-friendly
 *  one (same content, different shape) -- see SizeChartSheet and OrdersTable. */
export function useIsNarrowViewport(breakpointPx: number): boolean {
	const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
	const query = () => window.matchMedia(`(max-width: ${breakpointPx}px)`);
	const [narrow, setNarrow] = useState(() => (supported ? query().matches : false));
	useEffect(() => {
		if (!supported) return;
		const media = query();
		const onChange = () => setNarrow(media.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [breakpointPx, supported]);
	return narrow;
}
