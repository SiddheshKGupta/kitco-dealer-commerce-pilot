import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminUsersSection, DealerApplicationsSection, OrdersSection } from "../../src/features/admin/ControlConsole";

afterEach(() => vi.unstubAllGlobals());

describe("Admin Users", () => {
	const users = { users: [{ id: "user-1", email: "admin@kitco.example", status: "ACTIVE", createdAt: "2026-08-20T00:00:00Z" }] };

	it("shows a busy label on the row while a status change is in flight, rather than going quiet", async () => {
		let release = () => {};
		const held = new Promise<void>((resolve) => { release = resolve; });
		vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
			if (init?.method === "POST") { await held; return new Response(JSON.stringify({}), { status: 200 }); }
			return new Response(JSON.stringify(users), { status: 200 });
		}));
		render(<AdminUsersSection />);
		await screen.findByText("admin@kitco.example");

		fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
		const busy = await screen.findByRole("button", { name: "Deactivate" });
		expect(busy).toBeDisabled();
		release();
	});
});

describe("Dealer Applications", () => {
	const applications = {
		applications: [
			{
				id: "app-1", businessName: "Alpha Footwear", gstin: "10AXYPJ2171Q1ZX", city: "Patna", state: "Bihar",
				contactPerson: "Ravi Kumar", primaryEmail: "ravi@alpha.example", secondaryEmail: null, mobile: "9006875566",
				status: "SUBMITTED", reviewNotes: null, createdAt: "2026-08-20T00:00:00Z",
			},
			{
				id: "app-2", businessName: "Beta Shoes", gstin: "19BBBCC5678B1ZQ", city: "Kolkata", state: "West Bengal",
				contactPerson: "Sita Devi", primaryEmail: "sita@beta.example", secondaryEmail: null, mobile: "9123456780",
				status: "SUBMITTED", reviewNotes: null, createdAt: "2026-08-21T00:00:00Z",
			},
		],
	};

	it("filters the application list by business, city, contact or GSTIN, and clears back to the full list", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(applications), { status: 200 })));
		render(<DealerApplicationsSection />);
		await screen.findByText("Alpha Footwear");
		expect(screen.getByText("Beta Shoes")).toBeInTheDocument();

		const search = screen.getByLabelText("Search dealer applications");
		fireEvent.change(search, { target: { value: "Kolkata" } });
		expect(screen.getByText("Beta Shoes")).toBeInTheDocument();
		expect(screen.queryByText("Alpha Footwear")).not.toBeInTheDocument();

		fireEvent.change(search, { target: { value: "no such business" } });
		expect(screen.getByText("No matching applications")).toBeInTheDocument();

		fireEvent.change(search, { target: { value: "" } });
		expect(screen.getByText("Alpha Footwear")).toBeInTheDocument();
		expect(screen.getByText("Beta Shoes")).toBeInTheDocument();
	});
});

describe("Orders queue", () => {
	const orders = {
		orders: [
			{ id: "order-1", orderNumber: "KIT-2608-00001", status: "SUBMITTED", allocations: [], audit: [], dealerName: "Alpha Footwear", dealerState: "Bihar", submittedAt: "2026-08-20T00:00:00Z" },
			{ id: "order-2", orderNumber: "KIT-2608-00002", status: "APPROVED", allocations: [], audit: [], dealerName: "Beta Shoes", dealerState: "West Bengal", submittedAt: "2026-08-21T00:00:00Z" },
		],
	};

	it("filters orders by order number or dealer name, and clears back to the full list", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(orders), { status: 200 })));
		render(<OrdersSection />);
		await screen.findByText("Alpha Footwear");
		expect(screen.getByText("Beta Shoes")).toBeInTheDocument();

		const search = screen.getByLabelText("Search order number or dealer");
		fireEvent.change(search, { target: { value: "00002" } });
		expect(screen.getByText("Beta Shoes")).toBeInTheDocument();
		expect(screen.queryByText("Alpha Footwear")).not.toBeInTheDocument();

		fireEvent.change(search, { target: { value: "" } });
		expect(screen.getByText("Alpha Footwear")).toBeInTheDocument();
		expect(screen.getByText("Beta Shoes")).toBeInTheDocument();
	});
});
