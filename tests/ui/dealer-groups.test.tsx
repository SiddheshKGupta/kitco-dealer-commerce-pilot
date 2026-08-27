import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DealerGroupsSection, GroupRequestsSection, GstRegistrationsSection } from "../../src/features/admin/DealerGroups";

afterEach(() => vi.unstubAllGlobals());

const groups = {
	groups: [
		{ id: "grp-1", groupCode: "GANESH", groupName: "Shree Ganesh Retail", status: "ACTIVE", primaryDealerId: "dealer-a", dealerCount: 2 },
		{ id: "grp-2", groupCode: "FROZEN", groupName: "Frozen Group", status: "SUSPENDED", primaryDealerId: null, dealerCount: 0 },
	],
};

const dealer = (over: Record<string, unknown>) => ({
	id: "dealer-a", dealerCode: "BIHAR-0001", legalName: "ALPHA FOOTWEAR PVT LTD", displayName: "Alpha Footwear",
	groupCode: "GANESH", gstin: "10AXYPJ2171Q1ZX", city: "Patna", state: "Bihar", isMainDealer: true,
	accountState: "ACTIVE", credentialsIssuedAt: null, firstLoginAt: null, lastLoginAt: null, loginEmail: null,
	...over,
});

const dealers = {
	dealers: [
		dealer({}),
		dealer({ id: "dealer-b", dealerCode: "BIHAR-0002", displayName: "Beta Shoes", isMainDealer: false, accountState: null }),
		dealer({ id: "dealer-c", dealerCode: "BIHAR-0003", displayName: "Outsider", groupCode: null, isMainDealer: false }),
	],
};

/** Routes each GET to its canned payload, and records every POST so a test can assert
 *  what the console actually asked the server to do. */
function stubApi(posts: { path: string; body: unknown }[], overrides: Record<string, unknown> = {}, postStatus = 200) {
	const payloads: Record<string, unknown> = {
		"/api/admin/dealer-groups": groups,
		"/api/admin/dealers": dealers,
		"/api/admin/dealer-groups/requests": { requests: [] },
		"/api/admin/gst-registrations": { registrations: [] },
		...overrides,
	};
	const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
		if (init?.method === "POST") {
			posts.push({ path, body: JSON.parse(String(init.body)) });
			return new Response(JSON.stringify(postStatus >= 400 ? { error: { message: "No dealer with this code exists" } } : { ok: true }), { status: postStatus });
		}
		return new Response(JSON.stringify(payloads[path] ?? {}), { status: 200 });
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("Dealer Groups", () => {
	it("lists groups with their main dealer and honest status", async () => {
		stubApi([]);
		render(<DealerGroupsSection />);

		await screen.findByText("Shree Ganesh Retail");
		expect(screen.getByText("Alpha Footwear")).toBeInTheDocument();
		// A group nobody has been made main of says so rather than showing a blank cell.
		expect(screen.getByText("None set")).toBeInTheDocument();
		expect(screen.getByText("SUSPENDED")).toBeInTheDocument();
	});

	it("creates a group and shows a busy label while the write is in flight", async () => {
		const posts: { path: string; body: unknown }[] = [];
		let release = () => {};
		const held = new Promise<void>((resolve) => { release = resolve; });
		vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
			if (init?.method === "POST") {
				posts.push({ path, body: JSON.parse(String(init.body)) });
				await held;
				return new Response(JSON.stringify({ id: "grp-3" }), { status: 201 });
			}
			return new Response(JSON.stringify(path === "/api/admin/dealers" ? dealers : groups), { status: 200 });
		}));
		render(<DealerGroupsSection />);
		await screen.findByText("Shree Ganesh Retail");

		fireEvent.change(screen.getByLabelText("Group code *"), { target: { value: "vlco" } });
		fireEvent.change(screen.getByLabelText("Group name *"), { target: { value: "V L & Co" } });
		fireEvent.click(screen.getByRole("button", { name: "Create group" }));

		// The button must not go quiet while the POST is open.
		const busy = await screen.findByRole("button", { name: "Creating…" });
		expect(busy).toBeDisabled();
		release();
		await screen.findByText(/Group VLCO created/);
		expect(posts).toEqual([{ path: "/api/admin/dealer-groups", body: { groupCode: "vlco", groupName: "V L & Co" } }]);
	});

	it("filters the group list by name or code, and clears back to the full list", async () => {
		stubApi([]);
		render(<DealerGroupsSection />);
		await screen.findByText("Shree Ganesh Retail");
		expect(screen.getByText("Frozen Group")).toBeInTheDocument();

		const search = screen.getByLabelText("Search dealer groups");
		fireEvent.change(search, { target: { value: "FROZEN" } });
		expect(screen.getByText("Frozen Group")).toBeInTheDocument();
		expect(screen.queryByText("Shree Ganesh Retail")).not.toBeInTheDocument();

		fireEvent.change(search, { target: { value: "no such group" } });
		expect(screen.getByText("No matching groups")).toBeInTheDocument();

		fireEvent.change(search, { target: { value: "" } });
		expect(screen.getByText("Shree Ganesh Retail")).toBeInTheDocument();
		expect(screen.getByText("Frozen Group")).toBeInTheDocument();
	});

	it("says plainly that a group code is needed before any import can use it", async () => {
		stubApi([], { "/api/admin/dealer-groups": { groups: [] } });
		render(<DealerGroupsSection />);
		expect(await screen.findByText("No dealer groups yet")).toBeInTheDocument();
	});

	it("shows a group's members, marks the main dealer and excludes dealers outside it", async () => {
		stubApi([]);
		render(<DealerGroupsSection />);
		fireEvent.click((await screen.findAllByRole("button", { name: "View" }))[0]);

		expect(await screen.findByText("2 members")).toBeInTheDocument();
		expect(screen.getByText("Main dealer")).toBeInTheDocument();
		expect(screen.getByText("BIHAR-0002")).toBeInTheDocument();
		expect(screen.queryByText("BIHAR-0003")).not.toBeInTheDocument();
	});

	it("renames a group by name only and never offers the code for editing", async () => {
		const posts: { path: string; body: unknown }[] = [];
		stubApi(posts);
		render(<DealerGroupsSection />);
		fireEvent.click((await screen.findAllByRole("button", { name: "View" }))[0]);

		const code = await screen.findByLabelText("Group code");
		expect(code).toHaveAttribute("readonly");
		// Nothing changed yet, so there is nothing to save.
		expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();

		fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Ganesh Retail Group" } });
		fireEvent.click(screen.getByRole("button", { name: "Save name" }));
		await screen.findByText("Renamed to Ganesh Retail Group.");
		expect(posts).toEqual([{ path: "/api/admin/dealer-groups/grp-1/name", body: { groupName: "Ganesh Retail Group" } }]);
	});

	it("surfaces the server's refusal when an unknown dealer code is assigned", async () => {
		stubApi([], {}, 404);
		render(<DealerGroupsSection />);
		fireEvent.click((await screen.findAllByRole("button", { name: "View" }))[0]);

		fireEvent.change(await screen.findByLabelText("Dealer code"), { target: { value: "NOPE" } });
		fireEvent.click(screen.getByRole("button", { name: "Add dealer" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("No dealer with this code exists");
	});
});

describe("Group Requests", () => {
	const requests = {
		requests: [{
			id: "req-1", dealerId: "dealer-c", dealerCode: "BIHAR-0003", dealerName: "Outsider",
			requestedGroupCode: "GANESH", status: "PENDING", requestedAt: "2026-08-20T00:00:00Z",
			decidedAt: null, decisionNotes: null,
		}],
	};

	it("shows an empty queue rather than implying dealers joined on their own", async () => {
		stubApi([]);
		render(<GroupRequestsSection />);
		expect(await screen.findByText("No dealer is waiting to join a group.")).toBeInTheDocument();
	});

	it("approves a request, and only lets a decline through with a reason", async () => {
		const posts: { path: string; body: unknown }[] = [];
		stubApi(posts, { "/api/admin/dealer-groups/requests": requests });
		render(<GroupRequestsSection />);
		fireEvent.click(await screen.findByRole("button", { name: "Review" }));

		await screen.findByText("Outsider wants to join GANESH");
		expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();

		fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Group owner did not confirm this dealer" } });
		expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();

		fireEvent.click(screen.getByRole("button", { name: "Approve and add to group" }));
		await waitFor(() => expect(posts).toHaveLength(1));
		expect(posts[0]).toEqual({ path: "/api/admin/dealer-groups/requests/req-1/approve", body: {} });
	});
});

describe("GST Registrations", () => {
	const registrations = {
		registrations: [
			{
				id: "gst-1", gstin: "10AXYPJ2171Q1ZX", legalName: null, tradeName: null, state: "Bihar", gstStatus: null,
				verificationStatus: "UNVERIFIED", verifiedAt: null, provider: null,
				dealers: [
					{ dealerId: "dealer-a", dealerCode: "BIHAR-0001", displayName: "Alpha Footwear", city: "Patna", state: "Bihar", isMainDealer: true },
					{ dealerId: "dealer-b", dealerCode: "BIHAR-0002", displayName: "Beta Shoes", city: "Patna", state: "Bihar", isMainDealer: false },
				],
			},
			{
				id: "gst-2", gstin: "19BBBCC5678B1ZQ", legalName: "MOCK TRADERS", tradeName: null, state: "West Bengal", gstStatus: "ACTIVE",
				verificationStatus: "NOT_LIVE_VERIFIED", verifiedAt: "2026-08-01T00:00:00Z", provider: "mock",
				dealers: [],
			},
		],
	};

	it("presents a shared GSTIN as normal, never as a duplicate or an error", async () => {
		stubApi([], { "/api/admin/gst-registrations": registrations });
		render(<GstRegistrationsSection />);

		await screen.findByText("10AXYPJ2171Q1ZX");
		expect(screen.getByText("Alpha Footwear")).toBeInTheDocument();
		expect(screen.getByText("Beta Shoes")).toBeInTheDocument();
		// One registration is shared by two dealers; nothing in the copy calls that wrong.
		expect(screen.getByText("Shared").closest(".stat")).toHaveTextContent("1");
		expect(screen.queryByText(/duplicate/i)).not.toBeInTheDocument();
	});

	it("never presents mock or self-declared evidence as GST verified", async () => {
		stubApi([], { "/api/admin/gst-registrations": registrations });
		render(<GstRegistrationsSection />);

		await screen.findByText("10AXYPJ2171Q1ZX");
		expect(screen.getAllByText("Not verified")).toHaveLength(2);
		// NOT_LIVE_VERIFIED renders as unverified with its reason -- never the provider
		// name, never the word "verified" on its own.
		expect(screen.getByText(/No GST connection configured/)).toBeInTheDocument();
		expect(screen.queryByText("mock")).not.toBeInTheDocument();
		expect(screen.getByText("Verified").closest(".stat")).toHaveTextContent("0");
	});

	it("says a GSTIN has no name on record instead of borrowing the dealer's", async () => {
		stubApi([], { "/api/admin/gst-registrations": registrations });
		render(<GstRegistrationsSection />);
		expect(await screen.findByText("Not on record")).toBeInTheDocument();
	});
});
