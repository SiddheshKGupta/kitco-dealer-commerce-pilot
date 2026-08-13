export interface DraftResponse { lines: Array<{ offeringId: string; quantities: Record<string, number>; retailValueMinor: number }>; retailValueMinor: number; currencyCode: string }
export interface DealerLocation { id: string; name: string; locationType: "BILL_TO" | "SHIP_TO" | "BOTH" }

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include", headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}

export function saveDraft(offeringId: string, quantities: Record<string, number>) {
  return jsonRequest<DraftResponse>("/api/drafts/current", { method: "PUT", body: JSON.stringify({ offeringId, quantities }) });
}

export function fetchDealerLocations() {
  return jsonRequest<{ locations: DealerLocation[] }>("/api/dealer/locations", { method: "GET" }).then((body) => body.locations);
}

export function submitOrder(input: { otpChallengeId: string; otpCode: string; idempotencyKey: string }) {
  return jsonRequest<{ order: { id: string; version: number; retailValueMinor: number } }>("/api/orders/submit", { method: "POST", headers: { "idempotency-key": input.idempotencyKey }, body: JSON.stringify({ otpChallengeId: input.otpChallengeId, otpCode: input.otpCode }) });
}

export async function requestOrderOtp(purpose: "ORDER_SUBMISSION"): Promise<string> {
  const response = await fetch("/api/orders/otp", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose }) });
  if (response.status === 404) throw new Error("Order verification is not available yet. Try again shortly.");
  if (!response.ok) throw new Error("The order code could not be sent. Try again.");
  const result = await response.json() as { challengeId: string };
  return result.challengeId;
}
