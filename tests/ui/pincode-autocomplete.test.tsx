import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfilePage } from "../../src/features/dealer/ProfilePage";
import { RegisterPage } from "../../src/features/activation/RegisterPage";

afterEach(() => vi.unstubAllGlobals());

function url(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input.toString();
}

/** A fetch double covering the pincode proxy plus whichever page-specific
 *  endpoints a test needs -- branches on URL/method the way the real worker
 *  routes do. */
function stubFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = url(input);
    calls.push({ url: path, method: init?.method ?? "GET" });
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (path.startsWith(pattern)) return handler(init);
    }
    return new Response(JSON.stringify({ error: "UNEXPECTED_URL" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const PINCODE_FOUND = () => new Response(JSON.stringify({ found: true, city: "Patna", state: "Bihar" }), { status: 200 });

describe("RegisterPage PIN autocomplete and GSTIN/state cross-check", () => {
  it("auto-fills city and state from a 6-digit PIN, still editable", async () => {
    stubFetch({ "/api/pincode/": PINCODE_FOUND });
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "800001" } });

    await waitFor(() => expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Patna"));
    expect((screen.getByLabelText("State") as HTMLInputElement).value).toBe("Bihar");

    // Still editable -- the dealer can override the autofill.
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Danapur" } });
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Danapur");
  });

  it("does not clobber a state the dealer already typed -- surfaces the conflict instead", async () => {
    stubFetch({ "/api/pincode/": PINCODE_FOUND });
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText("State"), { target: { value: "Uttar Pradesh" } });
    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "800001" } });

    await screen.findByRole("alert");
    expect((screen.getByLabelText("State") as HTMLInputElement).value).toBe("Uttar Pradesh");
    expect(screen.getByRole("alert")).toHaveTextContent(/State field says "Uttar Pradesh"/);
    expect(screen.getByRole("alert")).toHaveTextContent(/PIN 800001 is in Bihar/);
  });

  it("blocks submission on an unacknowledged mismatch, and allows it once acknowledged", async () => {
    const calls = stubFetch({
      "/api/pincode/": PINCODE_FOUND,
      "/api/register/": () => new Response(JSON.stringify({ challengeId: "chal-1" }), { status: 202 }),
      "/api/register": () => new Response(JSON.stringify({ applicationId: "app-1" }), { status: 201 }),
    });
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Test Shop" } });
    fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: "10ABCDE1234F1Z5" } }); // Bihar
    fireEvent.change(screen.getByLabelText("Address line 1"), { target: { value: "12 MG Road" } });
    fireEvent.change(screen.getByLabelText("Contact person"), { target: { value: "Asha Rao" } });
    fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "owner@shop.test" } });
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "9876543210" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Lucknow" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "Uttar Pradesh" } }); // conflicts with the PIN
    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "800001" } }); // Bihar

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Still just the pincode lookup -- the mismatch was never acknowledged.
    await waitFor(() => expect(calls.some((c) => c.url === "/api/register")).toBe(false));

    fireEvent.click(screen.getByRole("checkbox", { name: /I've checked these details/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(calls.some((c) => c.url === "/api/register")).toBe(true));
  });
});

describe("ProfilePage PIN autocomplete and GSTIN/state cross-check", () => {
  const baseProfile = {
    dealerId: "dealer-a", dealerCode: "VLCO", displayName: "VLCO", legalName: null,
    gstin: "10ABCDE1234F1Z5", gstVerificationStatus: null, // 10 = Bihar
    addressLine1: "12 MG Road", addressLine2: null, city: "", state: "Uttar Pradesh", pinCode: "",
    mobile: "9876543210", contactPerson: "Asha Rao", secondaryEmail: null, storefrontPhotoKey: null,
  };

  function profileResponse(overrides: Partial<typeof baseProfile> = {}) {
    return { profile: { ...baseProfile, ...overrides }, profileComplete: false, missingFields: ["pinCode", "city"] };
  }

  it("auto-fills a blank city from the PIN, and flags the state already on file as a conflict", async () => {
    stubFetch({
      "/api/pincode/": PINCODE_FOUND,
      "/api/dealer/profile": () => new Response(JSON.stringify(profileResponse()), { status: 200 }),
    });
    render(<ProfilePage />);

    fireEvent.change(await screen.findByLabelText("PIN code"), { target: { value: "800001" } });

    await waitFor(() => expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Patna"));
    // State was already "Uttar Pradesh" on file -- autofill must not overwrite it.
    expect((screen.getByLabelText("State") as HTMLInputElement).value).toBe("Uttar Pradesh");
    expect(await screen.findByText(/State field says "Uttar Pradesh"/)).toBeInTheDocument();
  });

  it("blocks saving on an unacknowledged mismatch, and allows it once acknowledged", async () => {
    const calls = stubFetch({
      "/api/pincode/": PINCODE_FOUND,
      "/api/dealer/profile": (init) => (init?.method === "PUT"
        ? new Response(JSON.stringify(profileResponse({ pinCode: "800001", city: "Patna" })), { status: 200 })
        : new Response(JSON.stringify(profileResponse()), { status: 200 })),
    });
    render(<ProfilePage />);

    fireEvent.change(await screen.findByLabelText("PIN code"), { target: { value: "800001" } });
    await screen.findByText(/Double check this before saving/);

    fireEvent.click(screen.getByRole("button", { name: "Save my details" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/dealer/profile" && c.method === "PUT")).toBe(false));

    fireEvent.click(screen.getByRole("checkbox", { name: /I've checked these details/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save my details" }));

    await waitFor(() => expect(calls.some((c) => c.url === "/api/dealer/profile" && c.method === "PUT")).toBe(true));
  });
});
