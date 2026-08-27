import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatchSection, HoldsSection, ImportsSection } from "../../src/features/admin/ControlSections";

afterEach(() => vi.unstubAllGlobals());

describe("Dispatch", () => {
	const dispatches = {
		dispatches: [
			{ id: "disp-1", dispatch_number: "DSP-0001", order_id: "order-alpha", status: "DISPATCHED", dispatched_at: "2026-08-20T00:00:00Z" },
			{ id: "disp-2", dispatch_number: "DSP-0002", order_id: "order-beta", status: "DISPATCHED", dispatched_at: "2026-08-21T00:00:00Z" },
		],
	};

	it("filters dispatches by dispatch or order number, and clears back to the full list", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(dispatches), { status: 200 })));
		render(<DispatchSection />);
		await screen.findByText("DSP-0001");
		expect(screen.getByText("DSP-0002")).toBeInTheDocument();

		const search = screen.getByLabelText("Search dispatches");
		fireEvent.change(search, { target: { value: "0002" } });
		expect(screen.getByText("DSP-0002")).toBeInTheDocument();
		expect(screen.queryByText("DSP-0001")).not.toBeInTheDocument();

		fireEvent.change(search, { target: { value: "no such dispatch" } });
		expect(screen.getByText("No matching dispatches")).toBeInTheDocument();

		fireEvent.change(search, { target: { value: "" } });
		expect(screen.getByText("DSP-0001")).toBeInTheDocument();
		expect(screen.getByText("DSP-0002")).toBeInTheDocument();
	});
});

describe("Credit Holds", () => {
	const holds = {
		holds: [
			{ id: "hold-1", order_id: "order-alpha", hold_type: "CREDIT_LIMIT", status: "ACTIVE", reason: "Exposure limit reached", created_at: "2026-08-20T00:00:00Z", released_at: "" },
			{ id: "hold-2", order_id: "order-beta", hold_type: "MANUAL", status: "RELEASED", reason: "Payment received", created_at: "2026-08-21T00:00:00Z", released_at: "2026-08-22T00:00:00Z" },
		],
	};

	it("filters credit holds by order, type or reason, and clears back to the full list", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(holds), { status: 200 })));
		render(<HoldsSection />);
		await screen.findByText("Exposure limit reached");
		expect(screen.getByText("Payment received")).toBeInTheDocument();

		const search = screen.getByLabelText("Search credit holds");
		fireEvent.change(search, { target: { value: "Payment" } });
		expect(screen.getByText("Payment received")).toBeInTheDocument();
		expect(screen.queryByText("Exposure limit reached")).not.toBeInTheDocument();

		fireEvent.change(search, { target: { value: "no such reason" } });
		expect(screen.getByText("No matching holds")).toBeInTheDocument();

		fireEvent.change(search, { target: { value: "" } });
		expect(screen.getByText("Exposure limit reached")).toBeInTheDocument();
		expect(screen.getByText("Payment received")).toBeInTheDocument();
	});
});

describe("Catalogue Imports", () => {
	const imports = {
		imports: [
			{ id: "job-1", status: "COMMITTED", sourceName: "nike-spring.csv", profileCode: "NIKE_STD", createdAt: "2026-08-20T00:00:00Z", committedAt: "2026-08-20T00:00:00Z", rows: 120 },
			{ id: "job-2", status: "UPLOADED", sourceName: "reebok-autumn.csv", profileCode: "REEBOK_STD", createdAt: "2026-08-21T00:00:00Z", committedAt: null, rows: 40 },
		],
	};

	it("filters import jobs by source file, profile or status, and clears back to the full list", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(imports), { status: 200 })));
		render(<ImportsSection />);
		await screen.findByText("nike-spring.csv");
		expect(screen.getByText("reebok-autumn.csv")).toBeInTheDocument();

		const search = screen.getByLabelText("Search catalogue imports");
		fireEvent.change(search, { target: { value: "reebok" } });
		expect(screen.getByText("reebok-autumn.csv")).toBeInTheDocument();
		expect(screen.queryByText("nike-spring.csv")).not.toBeInTheDocument();

		fireEvent.change(search, { target: { value: "no such file" } });
		expect(screen.getByText("No matching imports")).toBeInTheDocument();

		fireEvent.change(search, { target: { value: "" } });
		expect(screen.getByText("nike-spring.csv")).toBeInTheDocument();
		expect(screen.getByText("reebok-autumn.csv")).toBeInTheDocument();
	});
});
