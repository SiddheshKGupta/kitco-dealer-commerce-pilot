import { render, screen } from "@testing-library/react";
import { App } from "../../src/app/App";

describe("KITCO dealer application shell", () => {
  it("renders KITCO branding, dealer navigation, and pilot attribution", () => {
    render(<App />);

    expect(screen.getByRole("img", { name: "KITCO Sports" })).toBeInTheDocument();
    expect(screen.getByText("Dealer Commerce Platform")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(screen.getAllByText(/Developed by V L & CO/)).not.toHaveLength(0);
  });
});
