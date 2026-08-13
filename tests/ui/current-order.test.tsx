import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DealerOrderJourney } from "../../src/features/orders/DealerOrderJourney";
import { requestOrderOtp } from "../../src/features/orders/api";

const product = { colourwayId: "cw-1", articleNo: "NK-101", brand: "Northstar", colour: "Black / Sail", mrpMinor: 10000, currencyCode: "INR", mediaUrl: "/api/media/nk.webp", availability: "AVAILABLE_TO_ORDER" as const, offering: { id: "offer-1", enabledSizes: ["7", "8"], moqPairs: 4, orderMultiplePairs: 2, type: "STOCK_IN_HAND" as const } };

afterEach(() => vi.unstubAllGlobals());

describe("Current Order journey", () => {
  it("explains when the authenticated order OTP endpoint is not available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    await expect(requestOrderOtp("ORDER_SUBMISSION")).rejects.toThrow("Order verification is not available yet. Try again shortly.");
  });

  it("enforces MOQ/multiple feedback, persists the authoritative draft, and shows Retail Value only", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/dealer/locations") return new Response(JSON.stringify({ locations: [{ id: "location-main", name: "Main showroom", locationType: "BOTH" }] }), { status: 200 });
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: body.quantities, retailValueMinor: 40000 }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DealerOrderJourney product={product} requestOrderOtp={async () => "otp-1"} />);

    fireEvent.change(screen.getByLabelText("Pairs for size 7"), { target: { value: "2" } });
    expect(screen.getByText("Add 2 more pairs to meet the 4-pair minimum.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pairs for size 7"), { target: { value: "5" } });
    expect(screen.getByText("Order in multiples of 2 pairs.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pairs for size 7"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Current Order" }));
    await screen.findByText("Saved to Current Order");
    expect(fetchMock).toHaveBeenCalledWith("/api/drafts/current", expect.objectContaining({ method: "PUT", credentials: "include", body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4 } }) }));
    expect(screen.getAllByText("₹400.00").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/dealer price|margin|gst|payable|stock/i);
  });

  it("allocates delivery, reviews pairs, requests a fresh OTP, and renders immutable V1 submission", async () => {
    let submitted = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/dealer/locations") return new Response(JSON.stringify({ locations: [{ id: "location-main", name: "Main showroom", locationType: "BOTH" }] }), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000 }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      submitted = true;
      expect(input).toBe("/api/orders/submit");
      expect(init).toMatchObject({ method: "POST", credentials: "include" });
      expect((init?.headers as Record<string, string>)["idempotency-key"]).toBeTruthy();
      return new Response(JSON.stringify({ order: { id: "order-1", version: 1, retailValueMinor: 40000 } }), { status: 201 });
    }));
    const requestOrderOtp = vi.fn(async () => "otp-order-1");
    render(<DealerOrderJourney product={product} requestOrderOtp={requestOrderOtp} />);
    fireEvent.change(screen.getByLabelText("Pairs for size 7"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Current Order" }));
    await screen.findByText("Saved to Current Order");
    await screen.findByRole("option", { name: "Main showroom" });
    fireEvent.change(screen.getByLabelText("Ship-to location"), { target: { value: "location-main" } });
    fireEvent.click(screen.getByRole("button", { name: "Review order" }));
    expect(screen.getAllByText("4 pairs").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Send fresh order code" }));
    await waitFor(() => expect(requestOrderOtp).toHaveBeenCalledWith("ORDER_SUBMISSION"));
    fireEvent.change(screen.getByLabelText("Order verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit immutable order" }));
    await screen.findByText("Order submitted · Version 1");
    expect(submitted).toBe(true);
  });

  it("reuses one idempotency key across a safe submission retry", async () => {
    const submissionKeys: string[] = [];
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/dealer/locations") return new Response(JSON.stringify({ locations: [{ id: "location-main", name: "Main showroom", locationType: "BOTH" }] }), { status: 200 });
      if (input === "/api/drafts/current") return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000 }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
      submissionKeys.push((init?.headers as Record<string, string>)["idempotency-key"]);
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ error: { message: "Temporary failure" } }), { status: 503 })
        : new Response(JSON.stringify({ order: { id: "order-1", version: 1, retailValueMinor: 40000 } }), { status: 201 });
    }));
    render(<DealerOrderJourney product={product} requestOrderOtp={async () => "otp-order-1"} />);
    fireEvent.change(screen.getByLabelText("Pairs for size 7"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Current Order" }));
    await screen.findByText("Saved to Current Order");
    await screen.findByRole("option", { name: "Main showroom" });
    fireEvent.change(screen.getByLabelText("Ship-to location"), { target: { value: "location-main" } });
    fireEvent.click(screen.getByRole("button", { name: "Review order" }));
    fireEvent.click(screen.getByRole("button", { name: "Send fresh order code" }));
    await screen.findByRole("heading", { name: "Verify this order" });
    fireEvent.change(screen.getByLabelText("Order verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit immutable order" }));
    await screen.findByText("Temporary failure");
    fireEvent.click(screen.getByRole("button", { name: "Submit immutable order" }));
    await screen.findByText(/Order submitted/);
    expect(submissionKeys).toHaveLength(2);
    expect(submissionKeys[0]).toBe(submissionKeys[1]);
  });
});
