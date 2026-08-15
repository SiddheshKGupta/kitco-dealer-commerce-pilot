import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewPage } from "../../src/features/orders/ReviewPage";

afterEach(() => vi.unstubAllGlobals());

describe("Review order (single consolidated OTP)", () => {
  it("summarises the draft, requests one OTP, and confirms submission in plain language (no technical version identifier)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/dealer/locations") return new Response(JSON.stringify({ locations: [{ id: "location-main", name: "Main showroom", locationType: "BOTH" }] }), { status: 200 });
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
      if (input === "/api/dealer/locations") return new Response(JSON.stringify({ locations: [{ id: "location-main", name: "Main showroom", locationType: "BOTH" }] }), { status: 200 });
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
      if (input === "/api/dealer/locations") return new Response(JSON.stringify({ locations: [{ id: "location-main", name: "Main showroom", locationType: "BOTH" }] }), { status: 200 });
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
});
