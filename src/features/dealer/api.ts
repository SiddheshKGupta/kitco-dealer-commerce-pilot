import type { DealerProfile, RequiredProfileField } from "../../domain/dealer-profile";

export interface DealerProfileRecord extends DealerProfile {
  dealerId: string;
  dealerCode: string;
  displayName: string | null;
  legalName: string | null;
  gstVerificationStatus: string | null;
}

export interface ProfileResponse {
  profile: DealerProfileRecord;
  profileComplete: boolean;
  missingFields: RequiredProfileField[];
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "That did not save. Try again.");
  return body;
}

export function fetchProfile() {
  return json<ProfileResponse>("/api/dealer/profile");
}

export function saveProfile(update: Partial<Record<keyof DealerProfile, string | null>>) {
  return json<ProfileResponse>("/api/dealer/profile", { method: "PUT", body: JSON.stringify(update) });
}

/** Sent as a raw body, not multipart: the worker reads content-type and bytes
 *  directly, so there is no form-encoding to agree on. */
export async function uploadStorefrontPhoto(file: File): Promise<ProfileResponse> {
  const response = await fetch("/api/dealer/profile/photo", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": file.type },
    body: file,
  });
  const body = await response.json().catch(() => ({})) as ProfileResponse & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "That photo could not be uploaded.");
  return body;
}

export function photoUrl(key: string | null | undefined): string | null {
  return key ? `/api/media/${encodeURIComponent(key)}` : null;
}
