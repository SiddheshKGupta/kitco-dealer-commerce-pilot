import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DealerCommercePage } from "../../src/features/catalogue/DealerCommercePage";
import { App } from "../../src/app/App";

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

it("connects catalogue selection to a server-persisted Current Order", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input === "/api/catalogue") {
      return new Response(JSON.stringify({ items: [{ colourwayId: "cw-1", articleNo: "NK-101", brand: "Northstar", colour: "Black", mrpMinor: 10000, currencyCode: "INR", mediaUrl: null, availability: "AVAILABLE_TO_ORDER", offering: { id: "offer-1", enabledSizes: ["7"], moqPairs: 2, orderMultiplePairs: 2, type: "STOCK_IN_HAND" } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 2 }, retailValueMinor: 20000 }], retailValueMinor: 20000, currencyCode: "INR" }), { status: 200 });
  }));
  render(<DealerCommercePage requestOrderOtp={async () => "otp"} />);
  fireEvent.click(await screen.findByRole("button", { name: "View NK-101" }));
  fireEvent.change(screen.getByLabelText("Pairs for size 7"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Add to Current Order" }));
  expect(await screen.findByText("Saved to Current Order")).toBeInTheDocument();
});

it("mounts the connected catalogue at the dealer Products route", async () => {
  window.history.replaceState({}, "", "/products");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Products" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Products" })).toHaveClass("is-current");
});
