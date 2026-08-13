import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

describe("pilot surface routing", () => {
  it("mounts the dealer catalogue at /products without disturbing dealer navigation", async () => {
    window.history.replaceState({}, "", "/products");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Built to move." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Products" })).toHaveClass("is-current");
    expect(screen.queryByRole("navigation", { name: "KITCO Control navigation" })).not.toBeInTheDocument();
  });

  it("mounts KITCO Control at /control with live data and its own navigation", async () => {
    window.history.replaceState({}, "", "/control");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ orders: [{ id: "order-1", status: "SUBMITTED", allocations: [{ orderLineId: "line-1", size: "7", approvedPairs: 4, dispatchedPairs: 0, heldPairs: 0 }], audit: [] }] }), { status: 200 })));
    render(<App />);
    expect(await screen.findByRole("navigation", { name: "KITCO Control navigation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Exception-led order control." })).toBeInTheDocument();
    expect(screen.queryByText(/Preview data/)).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Dealer navigation" })).not.toBeInTheDocument();
  });

  it("mounts live dealer orders at /orders", async () => {
    window.history.replaceState({}, "", "/orders");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ orders: [] }), { status: 200 })));
    render(<App />);
    expect(screen.getByRole("heading", { name: "Current Order" })).toBeInTheDocument();
    expect(await screen.findByText("No submitted orders yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start an order" })).toHaveAttribute("href", "/products");
  });

  it("mounts fulfilment reports from the dealer's live order ledger", async () => {
    window.history.replaceState({}, "", "/reports");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ orders: [{ id: "order-1", status: "APPROVED", version: 1, retailValueMinor: 40000, allocations: [{ orderLineId: "line-1", size: "7", approvedPairs: 4, dispatchedPairs: 2, heldPairs: 0 }] }] }), { status: 200 })));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Fulfilment reports" })).toBeInTheDocument();
    expect(screen.getByText("Dispatched 2 pairs")).toBeInTheDocument();
  });

  it("keeps activation and login routes outside dealer and control workspaces", () => {
    window.history.replaceState({}, "", "/login");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Welcome back." })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Dealer navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "KITCO Control navigation" })).not.toBeInTheDocument();
  });
});
