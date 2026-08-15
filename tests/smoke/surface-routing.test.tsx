import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

describe("pilot surface routing", () => {
  it("mounts the dealer catalogue at /products without disturbing dealer navigation", async () => {
    window.history.replaceState({}, "", "/products");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Products" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Dealer navigation" })).getByRole("link", { name: "Products" })).toHaveClass("is-current");
    expect(screen.queryByRole("navigation", { name: "KITCO Control navigation" })).not.toBeInTheDocument();
  });

  it("mounts KITCO Control at /control on the live dashboard with its own navigation", async () => {
    window.history.replaceState({}, "", "/control");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      orders: { total: 2, pendingReview: 1, approved: 1 },
      pairsOrdered: 12, retailValueMinor: 480000,
      dealers: { total: 136, active: 1 },
      catalogue: { colourways: 641, published: 641, withMedia: 90 },
    }), { status: 200 })));
    render(<App />);
    expect(await screen.findByRole("navigation", { name: "KITCO Control navigation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("₹4,800.00")).toBeInTheDocument();
    expect(screen.getByText("Pairs Ordered")).toBeInTheDocument();
    expect(screen.queryByText(/Preview data/)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Dealer navigation" })).not.toBeInTheDocument();
  });

  it("routes KITCO Control sections from the sidebar", async () => {
    window.history.replaceState({}, "", "/control/dealers");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      dealers: [{ id: "d-1", code: "VLCO", name: "VLCO", state: "Bihar", city: "Patna", activationStatus: "ACTIVE", locations: 1, gstRegistrations: 1, orders: 2 }],
    }), { status: 200 })));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Dealers" })).toBeInTheDocument();
    expect(await screen.findByText("Patna, Bihar")).toBeInTheDocument();
  });

  it("mounts live dealer orders at /orders", async () => {
    window.history.replaceState({}, "", "/orders");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ orders: [] }), { status: 200 })));
    render(<App />);
    expect(screen.getByRole("heading", { name: "Your Orders" })).toBeInTheDocument();
    expect(await screen.findByText("No orders yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start an order" })).toHaveAttribute("href", "/products");
  });

  it("mounts fulfilment reports from the dealer's live order ledger", async () => {
    window.history.replaceState({}, "", "/reports");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ orders: [{ id: "order-1", status: "APPROVED", version: 1, retailValueMinor: 40000, allocations: [{ orderLineId: "line-1", size: "7", approvedPairs: 4, dispatchedPairs: 2, heldPairs: 0 }] }] }), { status: 200 })));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Where's my order?" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Order fulfilment")).getByText("Dispatched 2 pairs")).toBeInTheDocument();
  });

  it("keeps activation and login routes outside dealer and control workspaces", () => {
    window.history.replaceState({}, "", "/login");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Welcome back." })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Dealer navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "KITCO Control navigation" })).not.toBeInTheDocument();
  });
});
