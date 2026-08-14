import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DealerOrderJourney } from "../../src/features/orders/DealerOrderJourney";
import { requestOrderOtp } from "../../src/features/orders/api";

const product = { colourwayId: "cw-1", articleNo: "NK-101", brand: "Northstar", colour: "Black / Sail", mrpMinor: 10000, currencyCode: "INR", mediaUrl: "/api/media/nk.webp", availability: "AVAILABLE_TO_ORDER" as const, offering: { id: "offer-1", enabledSizes: ["7", "8"], moqPairs: 4, orderMultiplePairs: 2, type: "STOCK_IN_HAND" as const } };

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

describe("Current Order journey", () => {
  it("explains when the authenticated order OTP endpoint is not available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    await expect(requestOrderOtp("ORDER_SUBMISSION")).rejects.toThrow("Order verification is not available yet. Try again shortly.");
  });

  it("enforces MOQ/multiple feedback, persists the authoritative draft, and shows Retail Value only", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: body.quantities, retailValueMinor: 40000 }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DealerOrderJourney product={product} />);

    fireEvent.change(screen.getByLabelText("Pairs for size 7"), { target: { value: "2" } });
    expect(screen.getByText("Add 2 more pairs to meet the 4-pair minimum.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pairs for size 7"), { target: { value: "5" } });
    expect(screen.getByText("Order in multiples of 2 pairs.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pairs for size 7"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Current Order" }));
    await screen.findByText("Saved to Current Order");
    expect(fetchMock).toHaveBeenCalledWith("/api/drafts/current", expect.objectContaining({ method: "PUT", credentials: "include", body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4 } }) }));
    expect(document.body.textContent).not.toMatch(/dealer price|margin|gst|payable|stock/i);
  });

  it("offers Continue Shopping and View Cart once an article is saved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 4 }, retailValueMinor: 40000 }], retailValueMinor: 40000, currencyCode: "INR" }), { status: 200 })));
    render(<DealerOrderJourney product={product} />);
    fireEvent.change(screen.getByLabelText("Pairs for size 7"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Current Order" }));
    await screen.findByText("Saved to Current Order");
    expect(screen.getByRole("button", { name: "Continue Shopping" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Cart" }));
    expect(window.location.pathname).toBe("/cart");
  });
});
