import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewPage } from "../../src/features/orders/ReviewPage";

afterEach(() => vi.unstubAllGlobals());

const GROUP_SINGLE_DEALER = { group: null, dealers: [{ dealerId: "dealer-a", dealerCode: "A", displayName: "Dealer A", isSelf: true, locations: [{ id: "location-main", name: "Main showroom", locationType: "BOTH" }] }] };

const GROUP_NO_LOCATIONS = { group: null, dealers: [{ dealerId: "dealer-a", dealerCode: "A", displayName: "Dealer A", isSelf: true, locations: [] }] };

describe("Review order (single consolidated OTP)", () => {
  it("submits with no ship-to location at all, rather than a literal null the server rejects", async () => {
    // Real bug: this used to send shipToLocationId: null, which fails the server's
    // z.string().optional() schema (accepts a string or nothing, never null) with
    // "Request validation failed" -- blocking every dealer with no location on file,
    // which is most of the 136 real pilot dealers.
    let submittedBody: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/dealer/group") return new Response(JSON.stringify(GROUP_NO_LOCATIONS), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000, articleNo: "NK-101", brand: "Northstar", colour: "Black", currencyCode: "INR" }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      if (input === "/api/orders/submit") { submittedBody = init?.body as string; return new Response(JSON.stringify({ order: { id: "order-1", version: 1, retailValueMinor: 40000 } }), { status: 201 }); }
      throw new Error(`unexpected fetch ${input}`);
    }));
    render(<ReviewPage requestOrderOtp={async () => "otp-order-1"} />);

    await screen.findByText(/Ships to the registered address/);
    fireEvent.click(screen.getByLabelText("I confirm the above order details."));
    fireEvent.click(screen.getByRole("button", { name: "Place Final Order" }));
    await screen.findByLabelText("Verification code");
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Order" }));
    await screen.findByText("Order submitted");

    expect(submittedBody).toBeDefined();
    const parsed = JSON.parse(submittedBody!);
    expect(parsed).not.toHaveProperty("shipToLocationId");
    expect(JSON.stringify(parsed)).not.toContain("null");
  });

  it("auto-selects the one available ship-to location instead of leaving the dealer stuck on an unexplained disabled button", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input === "/api/dealer/group") return new Response(JSON.stringify(GROUP_SINGLE_DEALER), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000, articleNo: "NK-101", brand: "Northstar", colour: "Black", currencyCode: "INR" }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      throw new Error(`unexpected fetch ${input}`);
    }));
    render(<ReviewPage requestOrderOtp={async () => "otp-order-1"} />);

    await screen.findByRole("option", { name: "Main showroom" });
    await waitFor(() => expect(screen.getByLabelText("Ship-to location")).toHaveValue("location-main"));
    fireEvent.click(screen.getByLabelText("I confirm the above order details."));
    expect(screen.getByRole("button", { name: "Place Final Order" })).not.toBeDisabled();
  });
});

describe("Review order (single consolidated OTP) -- legacy", () => {
  it("summarises the draft, requests one OTP, and confirms submission in plain language (no technical version identifier)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/dealer/group") return new Response(JSON.stringify(GROUP_SINGLE_DEALER), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000, articleNo: "NK-101", brand: "Northstar", colour: "Black", currencyCode: "INR" }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      expect(input).toBe("/api/orders/submit");
      expect(init).toMatchObject({ method: "POST", credentials: "include" });
      expect((init?.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
      return new Response(JSON.stringify({ order: { id: "order-1", version: 1, retailValueMinor: 40000 } }), { status: 201 });
    }));
    const requestOrderOtp = vi.fn(async () => "otp-order-1");
    render(<ReviewPage requestOrderOtp={requestOrderOtp} />);

    await screen.findByRole("option", { name: "Main showroom" });
    fireEvent.change(screen.getByLabelText("Ship-to location"), { target: { value: "location-main" } });
    expect(screen.getAllByText("4 pairs").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("I confirm the above order details."));
    fireEvent.click(screen.getByRole("button", { name: "Place Final Order" }));
    await waitFor(() => expect(requestOrderOtp).toHaveBeenCalledWith("ORDER_SUBMISSION"));
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Order" }));
    await screen.findByText("Order submitted");
    expect(screen.queryByText(/version/i)).not.toBeInTheDocument();
  });

  it("reuses one idempotency key across a safe submission retry", async () => {
    const submissionKeys: string[] = [];
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/dealer/group") return new Response(JSON.stringify(GROUP_SINGLE_DEALER), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000, articleNo: "NK-101", brand: "Northstar", colour: "Black", currencyCode: "INR" }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      submissionKeys.push((init?.headers as Record<string, string>)["idempotency-key"]);
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ error: { message: "Temporary failure" } }), { status: 503 })
        : new Response(JSON.stringify({ order: { id: "order-1", version: 1, retailValueMinor: 40000 } }), { status: 201 });
    }));
    render(<ReviewPage requestOrderOtp={async () => "otp-order-1"} />);

    await screen.findByRole("option", { name: "Main showroom" });
    fireEvent.change(screen.getByLabelText("Ship-to location"), { target: { value: "location-main" } });
    fireEvent.click(screen.getByLabelText("I confirm the above order details."));
    fireEvent.click(screen.getByRole("button", { name: "Place Final Order" }));
    await screen.findByLabelText("Verification code");
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Order" }));
    await screen.findByText("Temporary failure");
    fireEvent.click(screen.getByRole("button", { name: "Confirm Order" }));
    await screen.findByText(/Order submitted/);
    expect(submissionKeys).toHaveLength(2);
    expect(submissionKeys[0]).toBe(submissionKeys[1]);
  });

  it("offers a resend control on the order OTP step, disabled until the cooldown elapses", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input === "/api/dealer/group") return new Response(JSON.stringify(GROUP_SINGLE_DEALER), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000, articleNo: "NK-101", brand: "Northstar", colour: "Black", currencyCode: "INR" }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      throw new Error(`unexpected fetch ${input}`);
    }));
    const requestOrderOtp = vi.fn(async () => "otp-order-1");
    render(<ReviewPage requestOrderOtp={requestOrderOtp} />);

    await screen.findByRole("option", { name: "Main showroom" });
    fireEvent.change(screen.getByLabelText("Ship-to location"), { target: { value: "location-main" } });
    fireEvent.click(screen.getByLabelText("I confirm the above order details."));
    fireEvent.click(screen.getByRole("button", { name: "Place Final Order" }));
    await waitFor(() => expect(requestOrderOtp).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("button", { name: /Send me a new code in \d+s/ })).toBeDisabled();
  });

  it("will not issue an order code while the profile is incomplete, so a blocked dealer never spends one", async () => {
    // Without this the dealer completes every step, receives a real emailed code,
    // and only then meets the server's 422 -- the code burnt for nothing.
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input === "/api/dealer/group") return new Response(JSON.stringify(GROUP_SINGLE_DEALER), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000, articleNo: "NK-101", brand: "Northstar", colour: "Black", currencyCode: "INR" }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      throw new Error(`unexpected fetch ${input}`);
    }));
    const requestOrderOtp = vi.fn(async () => "otp-order-1");
    render(<ReviewPage requestOrderOtp={requestOrderOtp} profileBlock="GST number and mobile number" />);

    await screen.findByRole("option", { name: "Main showroom" });
    fireEvent.change(screen.getByLabelText("Ship-to location"), { target: { value: "location-main" } });
    fireEvent.click(screen.getByLabelText("I confirm the above order details."));

    const place = screen.getByRole("button", { name: "Place Final Order" });
    expect(place).toBeDisabled();
    fireEvent.click(place);
    expect(requestOrderOtp).not.toHaveBeenCalled();
    // Named in the same words as the server's refusal, so the two cannot disagree.
    expect(screen.getByRole("alert")).toHaveTextContent("Add GST number and mobile number to your profile before placing an order.");
  });

  it("leaves ordering alone when the profile is complete", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input === "/api/dealer/group") return new Response(JSON.stringify(GROUP_SINGLE_DEALER), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000, articleNo: "NK-101", brand: "Northstar", colour: "Black", currencyCode: "INR" }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      throw new Error(`unexpected fetch ${input}`);
    }));
    const requestOrderOtp = vi.fn(async () => "otp-order-1");
    render(<ReviewPage requestOrderOtp={requestOrderOtp} profileBlock={null} />);

    await screen.findByRole("option", { name: "Main showroom" });
    fireEvent.change(screen.getByLabelText("Ship-to location"), { target: { value: "location-main" } });
    fireEvent.click(screen.getByLabelText("I confirm the above order details."));
    fireEvent.click(screen.getByRole("button", { name: "Place Final Order" }));

    await waitFor(() => expect(requestOrderOtp).toHaveBeenCalledTimes(1));
  });

  it("hides the Bill-To/Ship-To pickers for the common ungrouped dealer -- checkout behaves exactly like v4", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input === "/api/dealer/group") return new Response(JSON.stringify(GROUP_SINGLE_DEALER), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000, articleNo: "NK-101", brand: "Northstar", colour: "Black", currencyCode: "INR" }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      throw new Error(`unexpected fetch ${input}`);
    }));
    render(<ReviewPage requestOrderOtp={async () => "otp-order-1"} />);

    await screen.findByRole("option", { name: "Main showroom" });
    expect(screen.queryByLabelText("Bill-to dealer")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ship-to dealer")).not.toBeInTheDocument();
  });

  it("offers Bill-To/Ship-To pickers for a grouped dealer and submits the chosen partners, PO number and requested date", async () => {
    const GROUP_TWO_DEALERS = { group: { id: "grp-1", groupCode: "OPENAI", groupName: "OpenAI Group", status: "ACTIVE" }, dealers: [
      { dealerId: "dealer-a", dealerCode: "A", displayName: "Dealer A", isSelf: true, locations: [{ id: "location-main", name: "Main showroom", locationType: "BOTH" }] },
      { dealerId: "dealer-b", dealerCode: "B", displayName: "Dealer B", isSelf: false, locations: [{ id: "location-b", name: "Dealer B Warehouse", locationType: "SHIP_TO" }] },
    ] };
    let submittedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/dealer/group") return new Response(JSON.stringify(GROUP_TWO_DEALERS), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000, articleNo: "NK-101", brand: "Northstar", colour: "Black", currencyCode: "INR" }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      if (input === "/api/orders/submit") { submittedBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ order: { id: "order-1", version: 1, retailValueMinor: 40000 } }), { status: 201 }); }
      throw new Error(`unexpected fetch ${input}`);
    }));
    render(<ReviewPage requestOrderOtp={async () => "otp-order-1"} />);

    await screen.findByLabelText("Ship-to dealer");
    fireEvent.change(screen.getByLabelText("Ship-to dealer"), { target: { value: "dealer-b" } });
    await screen.findByRole("option", { name: "Dealer B Warehouse" });
    fireEvent.change(screen.getByLabelText("Ship-to location"), { target: { value: "location-b" } });
    fireEvent.change(screen.getByLabelText("Dealer PO number"), { target: { value: "PO-42" } });
    fireEvent.click(screen.getByLabelText("On a date"));
    fireEvent.change(screen.getByLabelText("Requested delivery date"), { target: { value: "2026-09-20" } });
    fireEvent.click(screen.getByLabelText("I confirm the above order details."));
    fireEvent.click(screen.getByRole("button", { name: "Place Final Order" }));
    await screen.findByLabelText("Verification code");
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Order" }));
    await screen.findByText("Order submitted");

    expect(submittedBody).toMatchObject({
      shipToDealerId: "dealer-b", shipToLocationId: "location-b",
      dealerPoNumber: "PO-42", deliveryPreference: "REQUESTED_DATE", requestedDeliveryDate: "2026-09-20",
    });
  });
});
