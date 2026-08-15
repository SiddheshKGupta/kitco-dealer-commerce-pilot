import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SizeSetsSection } from "../../src/features/admin/ControlSections";

const payload = {
	sizeSets: [{
		id: "set-1", code: "REEBOK_7_12", name: "Reebok 7 12",
		values: [
			{ id: "value-12", label: "12", sortOrder: 5, inUseCount: 3 },
			{ id: "value-11", label: "11", sortOrder: 4, inUseCount: 0 },
		],
	}],
	families: [{ id: "family-1", brandId: "brand-1", brandName: "Reebok", gender: "MENS", name: "Reebok Classic" }],
	assignments: [{ brandName: "Reebok", gender: "MENS", sizeSetCode: "REEBOK_7_12", sizeSetName: "Reebok 7 12", colourwayCount: 77 }],
};

afterEach(() => vi.unstubAllGlobals());

describe("Admin Size Sets", () => {
	it("lists sizes with in-use counts and shows what's turned on today", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));
		render(<SizeSetsSection />);
		await screen.findByRole("heading", { name: "Reebok 7 12" });
		expect(screen.getByText("3 products")).toBeInTheDocument();
		expect(screen.getByText("Not used")).toBeInTheDocument();
		expect(screen.getByText("77")).toBeInTheDocument();
	});

	it("blocks removing a size in use by products, but requires typing the label to confirm removing an unused one", async () => {
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (!init || init.method === undefined) return new Response(JSON.stringify(payload), { status: 200 });
			if (init.method === "DELETE" && input.endsWith("/value-12")) {
				return new Response(JSON.stringify({ error: { message: "Size 12 is in use by products or orders and can't be removed." } }), { status: 409 });
			}
			if (init.method === "DELETE" && input.endsWith("/value-11")) {
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
			return new Response(JSON.stringify(payload), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<SizeSetsSection />);
		await screen.findByRole("heading", { name: "Reebok 7 12" });

		const rows = screen.getAllByRole("row");
		const row12 = rows.find((row) => row.textContent?.includes("12"))!;
		fireEvent.click(within(row12).getByRole("button", { name: "Remove" }));
		fireEvent.change(within(row12).getByLabelText("Type 12 to confirm removing this size"), { target: { value: "12" } });
		fireEvent.click(within(row12).getByRole("button", { name: "Confirm" }));
		await screen.findByText("Size 12 is in use by products or orders and can't be removed.");

		const row11 = rows.find((row) => row.textContent?.includes("11"))!;
		fireEvent.click(within(row11).getByRole("button", { name: "Remove" }));
		expect(within(row11).getByRole("button", { name: "Confirm" })).toBeDisabled();
		fireEvent.change(within(row11).getByLabelText("Type 11 to confirm removing this size"), { target: { value: "11" } });
		expect(within(row11).getByRole("button", { name: "Confirm" })).toBeEnabled();
		fireEvent.click(within(row11).getByRole("button", { name: "Confirm" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/size-sets/values/value-11", expect.objectContaining({ method: "DELETE" })));
	});

	it("creates a new size set", async () => {
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (init?.method === "POST" && input === "/api/admin/size-sets") return new Response(JSON.stringify({ id: "set-2" }), { status: 201 });
			return new Response(JSON.stringify(payload), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<SizeSetsSection />);
		await screen.findByRole("heading", { name: "Reebok 7 12" });

		fireEvent.change(screen.getByLabelText("Code"), { target: { value: "nike_men" } });
		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Nike Men 7 13" } });
		fireEvent.click(screen.getByRole("button", { name: "Create size set" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/size-sets", expect.objectContaining({
			method: "POST", body: JSON.stringify({ code: "nike_men", name: "Nike Men 7 13" }),
		})));
	});

	it("assigns a size set to a whole brand+gender and reports how many products it turned on", async () => {
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (init?.method === "POST" && input === "/api/admin/size-sets/assign") return new Response(JSON.stringify({ colourwaysAffected: 5 }), { status: 200 });
			return new Response(JSON.stringify(payload), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<SizeSetsSection />);
		await screen.findByRole("heading", { name: "Reebok 7 12" });

		fireEvent.change(screen.getByLabelText("Size set"), { target: { value: "set-1" } });
		fireEvent.change(screen.getByLabelText("Apply to"), { target: { value: "brandGender" } });
		fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "brand-1" } });
		fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "MENS" } });
		fireEvent.click(screen.getByRole("button", { name: "Turn on for these products" }));
		await screen.findByText("Done. Turned this size set on for 5 products.");
		expect(fetchMock).toHaveBeenCalledWith("/api/admin/size-sets/assign", expect.objectContaining({
			method: "POST", body: JSON.stringify({ sizeSetId: "set-1", brandId: "brand-1", gender: "MENS" }),
		}));
	});
});
