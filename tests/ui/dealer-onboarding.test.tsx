import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DealerImportSection, DealerOnboardingSection } from "../../src/features/admin/DealerOnboarding";

afterEach(() => vi.unstubAllGlobals());

const dealers = {
	dealers: [
		{
			id: "dealer-a", dealerCode: "BIHAR-0001", legalName: "ALPHA FOOTWEAR PVT LTD", displayName: "Alpha Footwear",
			groupCode: "GANESH", gstin: "10AXYPJ2171Q1ZX", city: "Patna", state: "Bihar", isMainDealer: false,
			accountState: null, credentialsIssuedAt: null, firstLoginAt: null, lastLoginAt: null, loginEmail: "alpha@dealer.example",
		},
		{
			id: "dealer-b", dealerCode: "BIHAR-0002", legalName: "BETA SHOES", displayName: "Beta Shoes",
			groupCode: null, gstin: null, city: null, state: null, isMainDealer: false,
			accountState: "IMPORTED", credentialsIssuedAt: null, firstLoginAt: null, lastLoginAt: null, loginEmail: null,
		},
	],
};

/** A File whose .text() resolves — jsdom does not implement Blob.text(). */
function csvFile(contents: string, name = "dealers.csv"): File {
	const file = new File([contents], name, { type: "text/csv" });
	Object.defineProperty(file, "text", { value: async () => contents });
	return file;
}

function chooseFile(contents: string) {
	const input = document.querySelector('input[type="file"]') as HTMLInputElement;
	Object.defineProperty(input, "files", { value: [csvFile(contents)], configurable: true });
	fireEvent.change(input);
}

describe("Dealer Onboarding", () => {
	it("says plainly when a dealer has no address to send a one-time code to", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(dealers), { status: 200 })));
		render(<DealerOnboardingSection />);
		await screen.findByText("Alpha Footwear");

		// A plausible blank would read as "fine"; this dealer cannot be issued credentials.
		expect(screen.getByText("No email on file")).toBeInTheDocument();
		// account_state has never been written for BIHAR-0001, and the console says so
		// rather than showing IMPORTED, which is only how the state machine treats null.
		expect(screen.getByText("Not set")).toBeInTheDocument();
	});

	it("filters the dealer list by name, code, group, GSTIN or email, and clears back to the full list", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(dealers), { status: 200 })));
		render(<DealerOnboardingSection />);
		await screen.findByText("Alpha Footwear");
		expect(screen.getByText("Beta Shoes")).toBeInTheDocument();

		const search = screen.getByLabelText("Search dealers");
		fireEvent.change(search, { target: { value: "GANESH" } });
		expect(screen.getByText("Alpha Footwear")).toBeInTheDocument();
		expect(screen.queryByText("Beta Shoes")).not.toBeInTheDocument();

		fireEvent.change(search, { target: { value: "BIHAR-0002" } });
		expect(screen.getByText("Beta Shoes")).toBeInTheDocument();
		expect(screen.queryByText("Alpha Footwear")).not.toBeInTheDocument();

		fireEvent.change(search, { target: { value: "no such dealer" } });
		expect(screen.getByText(/No dealers match/)).toBeInTheDocument();

		fireEvent.change(search, { target: { value: "" } });
		expect(screen.getByText("Alpha Footwear")).toBeInTheDocument();
		expect(screen.getByText("Beta Shoes")).toBeInTheDocument();
	});

	it("shows an issued password once, with the warning that it is never stored", async () => {
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (init?.method === "POST") {
				return new Response(JSON.stringify({
					dealerId: "dealer-a", dealerCode: "BIHAR-0001", loginEmail: "alpha@dealer.example",
					password: "KRDT4M9XPQBW2HJN", accountState: "CREDENTIALS_ISSUED",
					credentialsIssuedAt: "2026-08-25T10:00:00Z", reissued: false,
				}), { status: 201 });
			}
			return new Response(JSON.stringify(dealers), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<DealerOnboardingSection />);
		await screen.findByText("Alpha Footwear");

		fireEvent.click(screen.getAllByRole("button", { name: "Issue credentials" })[0]);
		await screen.findByText("KRDT4M9XPQBW2HJN");
		expect(screen.getByText(/Emailed to the dealer just now/)).toBeInTheDocument();
		// Once in the credentials panel, once in the dealer row it came from.
		expect(screen.getAllByText("alpha@dealer.example")).toHaveLength(2);
	});

	it("surfaces the missing-email refusal instead of failing silently", async () => {
		const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
			if (init?.method === "POST") return new Response(JSON.stringify({ error: { message: "This dealer has no email on file, so a one-time code could never reach them." } }), { status: 409 });
			return new Response(JSON.stringify(dealers), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);
		render(<DealerOnboardingSection />);
		await screen.findByText("Beta Shoes");

		fireEvent.click(screen.getAllByRole("button", { name: "Issue credentials" })[1]);
		await screen.findByRole("alert");
		expect(screen.getByRole("alert")).toHaveTextContent("no email on file");
	});
});

describe("Dealer Import", () => {
	const plan = {
		rows: [
			{ line: 2, dealerCode: "BIHAR-0137", action: "CREATE", changes: ["code", "legal_name"], errors: [] },
			{ line: 3, dealerCode: "BIHAR-0001", action: "UPDATE", changes: ["mobile"], errors: [] },
			{ line: 4, dealerCode: "BIHAR-0002", action: "SKIP", changes: [], errors: [] },
		],
		totals: { create: 1, update: 1, skip: 1, error: 0 },
		committed: false,
	};

	it("previews the diff without committing, then commits on a separate deliberate action", async () => {
		const calls: string[] = [];
		vi.stubGlobal("fetch", vi.fn(async (input: string) => {
			calls.push(input);
			return new Response(JSON.stringify(input.endsWith("/commit") ? { ...plan, committed: true } : plan), { status: 200 });
		}));
		render(<DealerImportSection />);
		chooseFile("dealer_code,legal_name\nBIHAR-0137,GAMMA PVT LTD");

		await screen.findByText("BIHAR-0137");
		expect(calls).toEqual(["/api/admin/dealers/import/preview"]);
		expect(screen.getByRole("heading", { name: /What this file would do/ })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Import 2 dealers" }));
		await screen.findByRole("heading", { name: /Imported/ });
		expect(calls).toEqual(["/api/admin/dealers/import/preview", "/api/admin/dealers/import/commit"]);
	});

	it("will not let the admin commit a file with an error in it", async () => {
		const broken = {
			rows: [
				{ line: 2, dealerCode: "BIHAR-0137", action: "CREATE", changes: ["code"], errors: [] },
				{ line: 3, dealerCode: "BIHAR-0138", action: "ERROR", changes: [], errors: ["No dealer group has the code NOSUCH."] },
			],
			totals: { create: 1, update: 0, skip: 0, error: 1 },
			committed: false,
		};
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(broken), { status: 200 })));
		render(<DealerImportSection />);
		chooseFile("dealer_code,legal_name,group_code\nBIHAR-0138,DELTA PVT LTD,NOSUCH");

		await screen.findByText("BIHAR-0138");
		expect(screen.getByRole("button", { name: /^Import 1 dealer$/ })).toBeDisabled();
		expect(screen.getByText("No dealer group has the code NOSUCH.")).toBeInTheDocument();
		expect(screen.getByText(/Nothing will be imported while any row has an error/)).toBeInTheDocument();
	});

	it("reports a file it cannot even check, rather than leaving a dead button", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "This file has no dealer_code column." } }), { status: 400 })));
		render(<DealerImportSection />);
		chooseFile("nonsense");

		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("dealer_code"));
	});
});
