import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfilePage } from "../../src/features/dealer/ProfilePage";

afterEach(() => vi.unstubAllGlobals());

const PROFILE = {
  dealerId: "dealer-a", dealerCode: "VLCO", displayName: "VLCO", legalName: null,
  gstin: "10ABCDE1234F1Z5", gstVerificationStatus: null,
  addressLine1: "12 MG Road", addressLine2: null, city: "Patna", state: "Bihar", pinCode: "800001",
  mobile: "9876543210", contactPerson: "Asha Rao", secondaryEmail: null, storefrontPhotoKey: null,
};

function stubFetch(onPut?: (body: unknown) => void) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/dealer/profile" && init?.method === "PUT") {
      onPut?.(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ profile: PROFILE, profileComplete: true, missingFields: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ profile: PROFILE, profileComplete: true, missingFields: [] }), { status: 200 });
  }));
}

describe("ProfilePage -- fields already on file are locked", () => {
  it("renders a field that already has a value as read-only, with a locked hint", async () => {
    stubFetch();
    render(<ProfilePage />);

    const mobile = await screen.findByLabelText("Mobile number") as HTMLInputElement;
    expect(mobile.readOnly).toBe(true);
    expect(screen.getAllByText("Locked -- contact KITCO to change this").length).toBeGreaterThan(0);

    // A locked field cannot be changed through the UI: no onChange is wired, so the
    // controlled value holds even if something dispatches a native change event.
    fireEvent.change(mobile, { target: { value: "1111111111" } });
    expect(mobile.value).toBe("9876543210");
  });

  it("leaves a still-blank optional field editable even when every required field is locked", async () => {
    stubFetch();
    render(<ProfilePage />);

    const secondEmail = await screen.findByLabelText("Second email (optional)") as HTMLInputElement;
    expect(secondEmail.readOnly).toBe(false);
    fireEvent.change(secondEmail, { target: { value: "second@dealer.test" } });
    expect(secondEmail.value).toBe("second@dealer.test");
  });

  it("saves only the newly-filled blank field, never re-sending a locked one", async () => {
    const puts: unknown[] = [];
    stubFetch((body) => puts.push(body));
    render(<ProfilePage />);

    const secondEmail = await screen.findByLabelText("Second email (optional)") as HTMLInputElement;
    fireEvent.change(secondEmail, { target: { value: "second@dealer.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my details" }));

    await screen.findByText("Saved.");
    expect(puts).toEqual([{ secondaryEmail: "second@dealer.test" }]);
  });
});
