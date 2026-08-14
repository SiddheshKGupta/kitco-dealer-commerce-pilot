import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthVariables } from "../../worker/middleware/auth";
import { handleApiError } from "../../worker/middleware/errors";
import { registerAdminExportRoutes, type OrderExportRow } from "../../worker/routes/admin-export";
import { SupabaseOrdersExporter } from "../../worker/supabase-orders-export";

const session = { userId: "u-1", organisationId: "org-1", dealerId: null, role: "ADMIN" as const };

function appWithExporter(exportRows: () => Promise<OrderExportRow[]>) {
	const app = new Hono<{ Variables: AuthVariables }>();
	app.onError(handleApiError);
	app.use("*", async (context, next) => { context.set("session", session); await next(); });
	registerAdminExportRoutes(app, { exportRows });
	return app;
}

describe("registerAdminExportRoutes", () => {
	it("streams a CSV with headers and a filename", async () => {
		const row: OrderExportRow = {
			orderNo: "KIT-1024", orderDate: "2026-08-01", dealerCode: "VLCO", dealerName: "VLCO Sports", city: "Patna", state: "Bihar", gstin: "10ABCDE1234F1Z5",
			brand: "Nike", productFamily: "Air Max", articleNo: "NK-101", colour: "Black", gender: "MEN", category: "Running", offering: "STOCK_IN_HAND", season: "",
			size: "8", orderedQty: 12, approvedQty: 12, heldQty: 4, dispatchedQty: 6, pendingQty: 2,
			mrpMinor: 899900, retailValueMinor: 10798800, holdReason: "STOCK_REVIEW", orderStatus: "PARTIALLY_APPROVED", fulfilmentStatus: "PARTIALLY_DISPATCHED",
		};
		const app = appWithExporter(async () => [row]);
		const response = await app.request("/api/admin/orders/export.csv");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/csv");
		expect(response.headers.get("content-disposition")).toContain("attachment");
		const body = await response.text();
		const lines = body.split("\r\n");
		expect(lines[0]).toBe("Order No,Order Date,Dealer Code,Dealer Name,City,State,GSTIN,Brand,Product Family,Article No,Colour,Gender,Category,Offering,Season,Size,Ordered Qty,Approved Qty,Held Qty,Dispatched Qty,Pending Qty,MRP,Retail Value,Hold Reason,Order Status,Fulfilment Status");
		expect(lines[1]).toBe("KIT-1024,2026-08-01,VLCO,VLCO Sports,Patna,Bihar,10ABCDE1234F1Z5,Nike,Air Max,NK-101,Black,MEN,Running,STOCK_IN_HAND,,8,12,12,4,6,2,8999.00,107988.00,STOCK_REVIEW,PARTIALLY_APPROVED,PARTIALLY_DISPATCHED");
	});

	it("quotes fields containing commas", async () => {
		const row: OrderExportRow = {
			orderNo: "KIT-1", orderDate: "2026-08-01", dealerCode: "D1", dealerName: "Sharma & Sons, Footwear", city: "Delhi", state: "Delhi", gstin: "",
			brand: "Reebok", productFamily: "Classic", articleNo: "RB-1", colour: "White", gender: "WOMEN", category: "Casual", offering: "UPCOMING", season: "",
			size: "7", orderedQty: 2, approvedQty: 2, heldQty: 0, dispatchedQty: 0, pendingQty: 2,
			mrpMinor: 500000, retailValueMinor: 1000000, holdReason: "", orderStatus: "SUBMITTED", fulfilmentStatus: "PENDING",
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
});

function chain(result: unknown) {
	const query: Record<string, unknown> = {};
	for (const method of ["select", "eq", "order"]) query[method] = vi.fn(() => query);
	query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
	return query;
}

describe("SupabaseOrdersExporter", () => {
	it("flattens orders -> lines -> sizes into one row per size with article identity and dealer-primary GSTIN", async () => {
		const orderRow = {
			id: "order-1", order_number: "KIT-1024", status: "PARTIALLY_APPROVED", submitted_at: "2026-08-01T10:00:00Z", dealer_id: "dealer-1",
			dealers: { code: "VLCO", name: "VLCO Sports", city: "Patna", state: "Bihar" },
			order_versions: [{
				version_no: 1,
				order_lines: [{
					id: "line-1", mrp_minor: 899900,
					commercial_offerings: { offering_type: "STOCK_IN_HAND" },
					product_colourways: { article_no: "NK-101", colour: "Black", product_families: { name: "Air Max", category: "Running", gender: "MEN", brands: { name: "Nike" } } },
					order_line_sizes: [{
						ordered_quantity_pairs: 12, approved_quantity_pairs: 12, size_values: { label: "8" },
						dispatch_lines: [{ quantity_pairs: 6, dispatches: { status: "FINALISED" } }],
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

		const rows = await exporter.exportRows(session);
		expect(rows).toEqual([{
			orderNo: "KIT-1024", orderDate: "2026-08-01", dealerCode: "VLCO", dealerName: "VLCO Sports", city: "Patna", state: "Bihar", gstin: "10ABCDE1234F1Z5",
			brand: "Nike", productFamily: "Air Max", articleNo: "NK-101", colour: "Black", gender: "MEN", category: "Running", offering: "STOCK_IN_HAND", season: "",
			size: "8", orderedQty: 12, approvedQty: 12, heldQty: 4, dispatchedQty: 6, pendingQty: 2,
			mrpMinor: 899900, retailValueMinor: 10798800, holdReason: "STOCK_REVIEW", orderStatus: "PARTIALLY_APPROVED", fulfilmentStatus: "ON_HOLD",
		}]);
	});
});
