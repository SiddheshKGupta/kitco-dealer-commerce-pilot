import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

describe("KITCO dealer application shell", () => {
  it("renders KITCO branding and pilot attribution at the login route", () => {
    render(<App />);

    expect(screen.getByRole("img", { name: "KITCO Sports" })).toBeInTheDocument();
    expect(screen.getByText("Dealer Commerce Platform")).toBeInTheDocument();
    expect(screen.getAllByText(/Developed by V L & CO/)).not.toHaveLength(0);
  });

  it("renders dealer navigation once inside the authenticated workspace", async () => {
    window.history.replaceState({}, "", "/products");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    render(<App />);

    expect(screen.getByRole("link", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument();
  });
});
