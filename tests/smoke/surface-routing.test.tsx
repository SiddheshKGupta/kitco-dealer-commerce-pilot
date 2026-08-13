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

  it("mounts KITCO Control at /control with explicit preview data and its own navigation", () => {
    window.history.replaceState({}, "", "/control");
    render(<App />);
    expect(screen.getByRole("navigation", { name: "KITCO Control navigation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Exception-led order control." })).toBeInTheDocument();
    expect(screen.getByText("Preview data · Sign in as an administrator to load live orders.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Dealer navigation" })).not.toBeInTheDocument();
  });

  it("mounts a Current Order loader state at /orders", () => {
    window.history.replaceState({}, "", "/orders");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Current Order" })).toBeInTheDocument();
    expect(screen.getByText("Choose a product to start or resume your server-saved order.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse products" })).toHaveAttribute("href", "/products");
  });

  it("keeps activation and login routes outside dealer and control workspaces", () => {
    window.history.replaceState({}, "", "/login");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Welcome back." })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Dealer navigation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "KITCO Control navigation" })).not.toBeInTheDocument();
  });
});
