import { useCallback, useEffect, useState } from "react";

export type SectionStatus = "loading" | "ready" | "error" | "forbidden";

/** The API's one error envelope (worker/middleware/errors.ts). Reading `.error` itself
 *  rather than `.error.message` renders the literal string "[object Object]". */
interface ApiErrorBody { error?: { message?: string } }
const messageOf = (body: unknown, fallback: string) => (body as ApiErrorBody).error?.message ?? fallback;

/** Every admin write goes through here: one correlation id per call, one error shape,
 *  and a body parse that tolerates an empty 200/204 instead of throwing on it. */
export async function adminFetch<T>(path: string, init?: RequestInit, fallback = "That didn't work. Try again."): Promise<T> {
	const response = await fetch(path, {
		credentials: "include",
		headers: { "content-type": "application/json", "x-correlation-id": crypto.randomUUID() },
		...init,
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(messageOf(body, fallback));
	return body as T;
}

export const post = <T>(path: string, body?: unknown, fallback?: string): Promise<T> =>
	adminFetch<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }, fallback);

/** Fetches one KITCO Control section. Never substitutes placeholder data:
 *  an empty result stays empty, a failure stays a failure. */
export function useAdminSection<T>(path: string) {
	const [data, setData] = useState<T | null>(null);
	const [status, setStatus] = useState<SectionStatus>("loading");
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(() => {
		let cancelled = false;
		setStatus("loading"); setError(null);
		void fetch(path, { credentials: "include" })
			.then(async (response) => {
				if (response.status === 401 || response.status === 403) { if (!cancelled) setStatus("forbidden"); return; }
				const body = await response.json().catch(() => ({}));
				if (cancelled) return;
				// Keep the server's own {code,message}: a 502 naming its cause and a generic
				// failure are different problems for whoever is on shift.
				if (!response.ok) { setError(messageOf(body, "") || null); setStatus("error"); return; }
				setData(body as T);
				setStatus("ready");
			})
			// Only a rejected fetch lands here -- the body parse above is already tolerant --
			// so this is the network, not the API, and says so rather than blaming the server.
			.catch(() => { if (!cancelled) { setError("Couldn't reach the server. Check your connection, then try again."); setStatus("error"); } });
		return () => { cancelled = true; };
	}, [path]);
	useEffect(() => load(), [load]);
	return { data, status, error, reload: load };
}
