export interface DraftLine {
	offeringId: string; quantities: Record<string, number>; retailValueMinor: number;
	articleNo?: string; brand?: string; familyName?: string; colour?: string;
	mrpMinor?: number; currencyCode?: string; mediaKey?: string | null;
	sizeSystemLabel?: string | null;
}
export interface DraftResponse { lines: DraftLine[]; retailValueMinor: number; currencyCode: string }
export interface DealerLocation { id: string; name: string; locationType: "BILL_TO" | "SHIP_TO" | "BOTH" }

// Phase 4 partner functions (V5_DEALER_GROUP_MODEL.md §3). The same payload backs both
// the Bill-To/Ship-To dealer pickers and the Ship-To location picker: each candidate
// dealer already carries its own active SHIP_TO/BOTH locations, so there is no separate
// fetch for "this dealer's locations" -- switching Ship-To dealer just re-reads this list.
export interface DealerGroupLocation { id: string; name: string; locationType: string }
export interface DealerGroupDealer { dealerId: string; dealerCode: string; displayName: string; isSelf: boolean; locations: DealerGroupLocation[] }
export interface DealerGroupPayload { group: { id: string; groupCode: string; groupName: string; status: string } | null; dealers: DealerGroupDealer[] }

export function fetchDealerGroup() {
	return jsonRequest<DealerGroupPayload>("/api/dealer/group", { method: "GET" });
}

async function jsonRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include", headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}

export function saveDraft(offeringId: string, quantities: Record<string, number>) {
  return jsonRequest<DraftResponse>("/api/drafts/current", { method: "PUT", body: JSON.stringify({ offeringId, quantities }) });
}

export function fetchDraft() {
  return jsonRequest<DraftResponse>("/api/drafts/current", { method: "GET" });
}

export function removeDraftLine(offeringId: string) {
  return jsonRequest<DraftResponse>(`/api/drafts/current/lines/${encodeURIComponent(offeringId)}`, { method: "DELETE" });
}

export function mediaUrl(mediaKey: string | null | undefined): string | null {
  return mediaKey ? `/api/media/${encodeURIComponent(mediaKey)}` : null;
}

export function fetchDealerLocations() {
  return jsonRequest<{ locations: DealerLocation[] }>("/api/dealer/locations", { method: "GET" }).then((body) => body.locations);
}

export interface SubmitOrderInput {
  otpChallengeId: string; otpCode: string; idempotencyKey: string;
  billToDealerId?: string; shipToDealerId?: string; shipToLocationId?: string | null;
  dealerPoNumber?: string; deliveryPreference: "ASAP" | "REQUESTED_DATE"; requestedDeliveryDate?: string;
}

export function submitOrder(input: SubmitOrderInput) {
  return jsonRequest<{ order: { id: string; version: number; retailValueMinor: number } }>("/api/orders/submit", {
    method: "POST", headers: { "idempotency-key": input.idempotencyKey },
    body: JSON.stringify({
      otpChallengeId: input.otpChallengeId, otpCode: input.otpCode,
      billToDealerId: input.billToDealerId, shipToDealerId: input.shipToDealerId, shipToLocationId: input.shipToLocationId,
      dealerPoNumber: input.dealerPoNumber, deliveryPreference: input.deliveryPreference, requestedDeliveryDate: input.requestedDeliveryDate,
    }),
  });
}

export async function requestOrderOtp(purpose: "ORDER_SUBMISSION"): Promise<string> {
  const response = await fetch("/api/orders/otp", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose }) });
  if (response.status === 404) throw new Error("Order verification is not available yet. Try again shortly.");
  if (!response.ok) throw new Error("The order code could not be sent. Try again.");
  const result = await response.json() as { challengeId: string };
  return result.challengeId;
}
