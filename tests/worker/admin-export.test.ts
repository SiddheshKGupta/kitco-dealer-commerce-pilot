import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthVariables } from "../../worker/middleware/auth";
import { handleApiError } from "../../worker/middleware/errors";
import { registerAdminExportRoutes, type OrderExportFilters, type OrderExportRow } from "../../worker/routes/admin-export";
import { SupabaseOrdersExporter } from "../../worker/supabase-orders-export";

const session = { userId: "u-1", organisationId: "org-1", dealerId: null, role: "ADMIN" as const };

function appWithExporter(exportRows: (session: unknown, filters: OrderExportFilters) => Promise<OrderExportRow[]>) {
	const app = new Hono<{ Variables: AuthVariables }>();
	app.onError(handleApiError);
	app.use("*", async (context, next) => { context.set("session", session); await next(); });
	registerAdminExportRoutes(app, { exportRows });
	return app;
}

const baseRow: OrderExportRow = {
	orderNo: "KIT-1024", orderDate: "2026-08-01", dealerCode: "VLCO", dealerName: "VLCO Sports", city: "Patna", state: "Bihar", gstin: "10ABCDE1234F1Z5",
	dealerGroupCode: "OPENAI001", dealerGroupName: "OpenAI Group",
	billToCode: "VLCO", billToName: "VLCO Sports", shipToCode: "VLCO2", shipToName: "VLCO Sports Annex", shipToLocation: "Warehouse 2",
	dealerPoNumber: "PO-555", deliveryPreference: "REQUESTED_DATE", requestedDeliveryDate: "2026-08-10", estimatedDeliveryDate: "2026-08-12",
	brand: "Nike", productFamily: "Air Max", articleNo: "NK-101", colour: "Black", gender: "MEN", category: "Running", offering: "STOCK_IN_HAND", season: "",
	size: "8", orderedQty: 12, approvedQty: 12, heldQty: 4, dispatchedQty: 6, pendingQty: 2,
	dispatchDate: "2026-08-05", dispatchNumber: "DSP-1",
	mrpMinor: 899900, orderedValueMinor: 10798800, retailValueMinor: 10798800, holdStatus: "ACTIVE", holdReason: "STOCK_REVIEW", orderStatus: "PARTIALLY_APPROVED", fulfilmentStatus: "PARTIALLY_DISPATCHED",
};

describe("registerAdminExportRoutes", () => {
	it("streams a CSV with 41 headers and a filename", async () => {
		const app = appWithExporter(async () => [baseRow]);
		const response = await app.request("/api/admin/orders/export.csv");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/csv");
		expect(response.headers.get("content-disposition")).toContain("attachment");
		const body = await response.text();
		const lines = body.split("\r\n");
		expect(lines[0]).toBe("Order No,Order Date,Dealer Code,Dealer Name,City,State,GSTIN,Dealer Group Code,Dealer Group Name,Bill To Code,Bill To Name,Ship To Code,Ship To Name,Ship To Location,Dealer PO Number,Delivery Preference,Requested Delivery Date,Estimated Delivery Date,Brand,Product Family,Article No,Colour,Gender,Category,Offering,Season,Size,Ordered Qty,Approved Qty,Held Qty,Dispatched Qty,Pending Qty,Dispatch Date,Dispatch Number,MRP,Ordered Value,Retail Value,Hold Status,Hold Reason,Order Status,Fulfilment Status");
		expect(lines[0].split(",")).toHaveLength(41);
		expect(lines[1]).toBe("KIT-1024,2026-08-01,VLCO,VLCO Sports,Patna,Bihar,10ABCDE1234F1Z5,OPENAI001,OpenAI Group,VLCO,VLCO Sports,VLCO2,VLCO Sports Annex,Warehouse 2,PO-555,REQUESTED_DATE,2026-08-10,2026-08-12,Nike,Air Max,NK-101,Black,MEN,Running,STOCK_IN_HAND,,8,12,12,4,6,2,2026-08-05,DSP-1,8999.00,107988.00,107988.00,ACTIVE,STOCK_REVIEW,PARTIALLY_APPROVED,PARTIALLY_DISPATCHED");
	});

	it("renders a blank dealer group, never a literal null, for the common case of a dealer with no group", async () => {
		const row: OrderExportRow = { ...baseRow, dealerGroupCode: "", dealerGroupName: "" };
		const app = appWithExporter(async () => [row]);
		const response = await app.request("/api/admin/orders/export.csv");
		const body = await response.text();
		const cells = body.split("\r\n")[1]!.split(",");
		// Dealer Group Code/Name are columns 8 and 9 (1-indexed) -- blank, not "null" or "undefined".
		expect(cells[7]).toBe("");
		expect(cells[8]).toBe("");
	});

	it("quotes fields containing commas", async () => {
		const row: OrderExportRow = {
			...baseRow, orderNo: "KIT-1", dealerCode: "D1", dealerName: "Sharma & Sons, Footwear", city: "Delhi", state: "Delhi", gstin: "",
			brand: "Reebok", productFamily: "Classic", articleNo: "RB-1", colour: "White", gender: "WOMEN", category: "Casual", offering: "UPCOMING",
			size: "7", orderedQty: 2, approvedQty: 2, heldQty: 0, dispatchedQty: 0, pendingQty: 2, dispatchDate: "", dispatchNumber: "",
			mrpMinor: 500000, orderedValueMinor: 1000000, retailValueMinor: 1000000, holdStatus: "", holdReason: "", orderStatus: "SUBMITTED", fulfilmentStatus: "PENDING",
		};
		const app = appWithExporter(async () => [row]);
		const response = await app.request("/api/admin/orders/export.csv");
		const body = await response.text();
		expect(body).toContain('"Sharma & Sons, Footwear"');
	});

	it("does not register the route when no exporter is supplied", async () => {
		const app = new Hono<{ Variables: AuthVariables }>();
		registerAdminExportRoutes(app, undefined);
		const response = await app.request("/api/admin/orders/export.csv");
		expect(response.status).toBe(404);
	});

	it("parses filter query params and threads them into the exporter", async () => {
		let received: OrderExportFilters | undefined;
		const app = appWithExporter(async (_session, filters) => { received = filters; return []; });
		await app.request("/api/admin/orders/export.csv?dealerId=dealer-9&dateFrom=2026-08-01&dateTo=2026-08-31&brand=Nike&orderStatus=APPROVED&holdStatus=ACTIVE&state=Bihar");
		expect(received).toEqual({
			dealerId: "dealer-9", dateFrom: "2026-08-01", dateTo: "2026-08-31",
			brand: "Nike", orderStatus: "APPROVED", holdStatus: "ACTIVE", state: "Bihar",
		});
	});

	it("treats missing/blank query params as absent filters", async () => {
		let received: OrderExportFilters | undefined;
		const app = appWithExporter(async (_session, filters) => { received = filters; return []; });
		await app.request("/api/admin/orders/export.csv?dealerId=+");
		expect(received).toEqual({
			dealerId: undefined, dateFrom: undefined, dateTo: undefined,
			brand: undefined, orderStatus: undefined, holdStatus: undefined, state: undefined,
		});
	});
});

function chain(result: unknown) {
	const query: Record<string, unknown> = {};
	for (const method of ["select", "eq", "order", "gte", "lte"]) query[method] = vi.fn(() => query);
	query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
	return query;
}

describe("SupabaseOrdersExporter", () => {
	it("flattens orders -> lines -> sizes into one row per size with article identity, dealer group, bill-to/ship-to snapshots, PO/delivery fields, dealer-primary GSTIN, dispatch and hold facts", async () => {
		const orderRow = {
			id: "order-1", order_number: "KIT-1024", status: "PARTIALLY_APPROVED", submitted_at: "2026-08-01T10:00:00Z", dealer_id: "dealer-1",
			dealer_po_number: "PO-555", delivery_preference: "REQUESTED_DATE", requested_delivery_date: "2026-08-10", estimated_delivery_date: "2026-08-12",
			bill_to_snapshot: { dealerId: "dealer-1", code: "VLCO", name: "VLCO Sports", gstin: "10ABCDE1234F1Z5", addressLine1: "1 MG Road", city: "Patna", state: "Bihar", pinCode: "800001" },
			ship_to_snapshot: { dealerId: "dealer-2", code: "VLCO2", name: "VLCO Sports Annex", gstin: "10ABCDE1234F1Z5", addressLine1: "2 MG Road", city: "Patna", state: "Bihar", pinCode: "800001" },
			dealers: { code: "VLCO", name: "VLCO Sports", city: "Patna", state: "Bihar", dealer_groups: { group_code: "OPENAI001", group_name: "OpenAI Group" } },
			dealer_locations: { name: "Warehouse 2" },
			order_versions: [{
				version_no: 1,
				order_lines: [{
					id: "line-1", mrp_minor: 899900,
					commercial_offerings: { offering_type: "STOCK_IN_HAND" },
					product_colourways: { article_no: "NK-101", colour: "Black", product_families: { name: "Air Max", category: "Running", gender: "MEN", brands: { name: "Nike" } } },
					order_line_sizes: [{
						ordered_quantity_pairs: 12, approved_quantity_pairs: 12, size_values: { label: "8" },
						order_line_decisions: { approved_qty: 12 },
						dispatch_lines: [{ quantity_pairs: 6, dispatches: { status: "FINALISED", dispatched_at: "2026-08-05T09:00:00Z", dispatch_number: "DSP-1" } }],
						hold_allocations: [{ quantity_pairs: 4, holds: { status: "ACTIVE", reason: "STOCK_REVIEW" } }],
					}],
				}],
			}],
		};
		const from = vi.fn((table: string) => {
			if (table === "orders") return chain({ data: [orderRow], error: null });
			if (table === "dealer_gst_registrations") return chain({ data: [{ dealer_id: "dealer-1", gstin: "10ABCDE1234F1Z5", is_primary: true }], error: null });
			throw new Error(`unexpected table ${table}`);
		});
		const client = { from } as unknown as SupabaseClient;
		const exporter = new SupabaseOrdersExporter(client);

		const rows = await exporter.exportRows(session, {});
		expect(rows).toEqual([{
			orderNo: "KIT-1024", orderDate: "2026-08-01", dealerCode: "VLCO", dealerName: "VLCO Sports", city: "Patna", state: "Bihar", gstin: "10ABCDE1234F1Z5",
			dealerGroupCode: "OPENAI001", dealerGroupName: "OpenAI Group",
			billToCode: "VLCO", billToName: "VLCO Sports", shipToCode: "VLCO2", shipToName: "VLCO Sports Annex", shipToLocation: "Warehouse 2",
			dealerPoNumber: "PO-555", deliveryPreference: "REQUESTED_DATE", requestedDeliveryDate: "2026-08-10", estimatedDeliveryDate: "2026-08-12",
			brand: "Nike", productFamily: "Air Max", articleNo: "NK-101", colour: "Black", gender: "MEN", category: "Running", offering: "STOCK_IN_HAND", season: "",
			size: "8", orderedQty: 12, approvedQty: 12, heldQty: 4, dispatchedQty: 6, pendingQty: 2,
			dispatchDate: "2026-08-05", dispatchNumber: "DSP-1",
			mrpMinor: 899900, orderedValueMinor: 10798800, retailValueMinor: 10798800, holdStatus: "ACTIVE", holdReason: "STOCK_REVIEW", orderStatus: "PARTIALLY_APPROVED", fulfilmentStatus: "ON_HOLD",
		}]);
	});

	it("renders a historical/backfilled order (self bill-to/ship-to, no group, no ship-to location) with blank group/location and self-matching bill-to/ship-to -- not nulls, not a crash", async () => {
		const orderRow = {
			id: "order-2", order_number: "KIT-2000", status: "APPROVED", submitted_at: "2026-06-01T10:00:00Z", dealer_id: "dealer-1",
			dealer_po_number: null, delivery_preference: "ASAP", requested_delivery_date: null, estimated_delivery_date: null,
			bill_to_snapshot: { dealerId: "dealer-1", code: "VLCO", name: "VLCO Sports", gstin: "10ABCDE1234F1Z5", addressLine1: "1 MG Road", city: "Patna", state: "Bihar", pinCode: "800001" },
			ship_to_snapshot: { dealerId: "dealer-1", code: "VLCO", name: "VLCO Sports", gstin: "10ABCDE1234F1Z5", addressLine1: "1 MG Road", city: "Patna", state: "Bihar", pinCode: "800001" },
			dealers: { code: "VLCO", name: "VLCO Sports", city: "Patna", state: "Bihar", dealer_groups: null },
			dealer_locations: null,
			order_versions: [{
				version_no: 1,
				order_lines: [{
					id: "line-2", mrp_minor: 899900,
					commercial_offerings: { offering_type: "STOCK_IN_HAND" },
					product_colourways: { article_no: "NK-101", colour: "Black", product_families: { name: "Air Max", category: "Running", gender: "MEN", brands: { name: "Nike" } } },
					order_line_sizes: [{
						ordered_quantity_pairs: 5, approved_quantity_pairs: 5, size_values: { label: "9" },
						dispatch_lines: [], hold_allocations: [],
					}],
				}],
			}],
		};
		const from = vi.fn((table: string) => {
			if (table === "orders") return chain({ data: [orderRow], error: null });
			if (table === "dealer_gst_registrations") return chain({ data: [{ dealer_id: "dealer-1", gstin: "10ABCDE1234F1Z5", is_primary: true }], error: null });
			throw new Error(`unexpected table ${table}`);
		});
		const client = { from } as unknown as SupabaseClient;
		const exporter = new SupabaseOrdersExporter(client);

		const rows = await exporter.exportRows(session, {});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			dealerGroupCode: "", dealerGroupName: "",
			billToCode: "VLCO", billToName: "VLCO Sports", shipToCode: "VLCO", shipToName: "VLCO Sports", shipToLocation: "",
			dealerPoNumber: "", deliveryPreference: "ASAP", requestedDeliveryDate: "", estimatedDeliveryDate: "",
		});
	});

	it("always scopes by organisation and pushes every supplied filter into the query builder", async () => {
		const ordersQuery = chain({ data: [], error: null });
		const from = vi.fn((table: string) => {
			if (table === "orders") return ordersQuery;
			if (table === "dealer_gst_registrations") return chain({ data: [], error: null });
			throw new Error(`unexpected table ${table}`);
		});
		const client = { from } as unknown as SupabaseClient;
		const exporter = new SupabaseOrdersExporter(client);

		await exporter.exportRows(session, {
			dealerId: "dealer-9", orderStatus: "APPROVED", dateFrom: "2026-08-01", dateTo: "2026-08-31",
			state: "Bihar", brand: "Nike", holdStatus: "ACTIVE",
		});

		const eq = ordersQuery.eq as any;
		const gte = ordersQuery.gte as any;
		const lte = ordersQuery.lte as any;
		expect(eq).toHaveBeenCalledWith("organisation_id", "org-1");
		expect(eq).toHaveBeenCalledWith("dealer_id", "dealer-9");
		expect(eq).toHaveBeenCalledWith("status", "APPROVED");
		expect(eq).toHaveBeenCalledWith("dealers.state", "Bihar");
		expect(eq).toHaveBeenCalledWith("order_versions.order_lines.product_colourways.product_families.brands.name", "Nike");
		expect(eq).toHaveBeenCalledWith("order_versions.order_lines.order_line_sizes.hold_allocations.holds.status", "ACTIVE");
		expect(gte).toHaveBeenCalledWith("submitted_at", "2026-08-01");
		expect(lte).toHaveBeenCalledWith("submitted_at", "2026-08-31T23:59:59.999Z");
	});

	it("never queries hold_allocations as an inner join unless a hold-status filter is supplied", async () => {
		const from = vi.fn((table: string) => {
			if (table === "orders") return chain({ data: [], error: null });
			if (table === "dealer_gst_registrations") return chain({ data: [], error: null });
			throw new Error(`unexpected table ${table}`);
		});
		const client = { from } as unknown as SupabaseClient;
		const exporter = new SupabaseOrdersExporter(client);

		await exporter.exportRows(session, {});

		const ordersQuery = from.mock.results[0]!.value as { select: ReturnType<typeof vi.fn> };
		const selectArg = ordersQuery.select.mock.calls[0]![0] as string;
		expect(selectArg).toContain("hold_allocations(quantity_pairs,holds(status,reason))");
		expect(selectArg).not.toContain("hold_allocations!inner");
	});
});
