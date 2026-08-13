import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CataloguePage } from "../../src/features/catalogue/CataloguePage";

const catalogue = {
  items: [
    { colourwayId: "cw-1", articleNo: "NK-101", brand: "Northstar", colour: "Black / Sail", mrpMinor: 10000, currencyCode: "INR", mediaUrl: "/api/media/nk-101.webp", availability: "AVAILABLE_TO_ORDER", offering: { id: "offer-1", enabledSizes: ["7", "8"], moqPairs: 4, orderMultiplePairs: 2, type: "STOCK_IN_HAND" } },
    { colourwayId: "cw-2", articleNo: "RB-202", brand: "Reebok", colour: "Chalk", mrpMinor: 8500, currencyCode: "INR", mediaUrl: null, availability: "AVAILABLE_TO_ORDER", offering: { id: "offer-2", enabledSizes: ["8", "9"], moqPairs: 2, orderMultiplePairs: 1, type: "UPCOMING" } },
    { colourwayId: "cw-3", articleNo: "DW-303", brand: "DOUBLEU", colour: "Bone", mrpMinor: 12000, currencyCode: "INR", mediaUrl: null, availability: "AVAILABLE_TO_ORDER", offering: { id: "offer-3", enabledSizes: ["40"], moqPairs: 2, orderMultiplePairs: 2, type: "PREBOOK" } },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("dealer catalogue", () => {
  it("browses Products, Upcoming and Prebook with search, brand filters, and MRP-only product cards", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(catalogue), { status: 200 })));
    render(<CataloguePage onOpenProduct={() => undefined} />);

    await screen.findByText("NK-101");
    expect(screen.getByRole("tab", { name: "Products" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Upcoming" }));
    expect(screen.getByRole("button", { name: "View RB-202" })).toBeInTheDocument();
    expect(screen.queryByText("NK-101")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Products" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search products" }), { target: { value: "bone" } });
    expect(screen.getByRole("button", { name: "View DW-303" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search products" }), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "price-high" } });
    expect(screen.getAllByRole("button", { name: /^View / }).map((button) => button.getAttribute("aria-label"))).toEqual(["View DW-303", "View NK-101", "View RB-202"]);
    const rail = screen.getByRole("complementary", { name: "Product filters" });
    fireEvent.click(within(rail).getByRole("checkbox", { name: "Reebok" }));
    expect(screen.getByRole("button", { name: "View RB-202" })).toBeInTheDocument();
    expect(screen.queryByText("NK-101")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/dealer price|margin|gst|payable|73 pairs/i);
  });

  it("keeps exact colourway media and gives missing media an article-specific placeholder", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(catalogue), { status: 200 })));
    render(<CataloguePage onOpenProduct={() => undefined} />);
    const image = await screen.findByRole("img", { name: "NK-101 · Black / Sail" });
    expect(image).toHaveAttribute("src", "/api/media/nk-101.webp");
    expect(screen.getByLabelText("Image unavailable for RB-202")).toHaveTextContent("RB-202");
  });

  it("opens a mobile filter drawer without removing the desktop filter semantics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(catalogue), { status: 200 })));
    render(<CataloguePage onOpenProduct={() => undefined} />);
    await screen.findByText("NK-101");
    const trigger = screen.getByRole("button", { name: "Filters" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Product filters" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Product filters" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("offers Stock in Hand and supports arrow-key tab navigation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(catalogue), { status: 200 })));
    render(<CataloguePage onOpenProduct={() => undefined} />);
    await screen.findByText("NK-101");
    const products = screen.getByRole("tab", { name: "Products" });
    products.focus();
    fireEvent.keyDown(products, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Stock in Hand" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "View NK-101" })).toBeInTheDocument();
  });
});
