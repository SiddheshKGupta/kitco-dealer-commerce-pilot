import { useCallback, useEffect, useState } from "react";

export type SectionStatus = "loading" | "ready" | "error" | "forbidden";

/** Fetches one KITCO Control section. Never substitutes placeholder data:
 *  an empty result stays empty, a failure stays a failure. */
export function useAdminSection<T>(path: string) {
	const [data, setData] = useState<T | null>(null);
	const [status, setStatus] = useState<SectionStatus>("loading");
	const load = useCallback(() => {
		let cancelled = false;
		setStatus("loading");
		void fetch(path, { credentials: "include" })
			.then(async (response) => {
				if (response.status === 401 || response.status === 403) { if (!cancelled) setStatus("forbidden"); return; }
				if (!response.ok) throw new Error("SECTION_LOAD_FAILED");
				const body = (await response.json()) as T;
				if (cancelled) return;
				setData(body);
				setStatus("ready");
			})
			.catch(() => { if (!cancelled) setStatus("error"); });
		return () => { cancelled = true; };
	}, [path]);
	useEffect(() => load(), [load]);
	return { data, status, reload: load };
}
