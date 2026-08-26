import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthVariables, SessionIdentity } from "../../worker/middleware/auth";
import { handleApiError } from "../../worker/middleware/errors";
import type { OrderExportFilters, OrderExportRow } from "../../worker/routes/admin-export";
import { groupProductRows, registerAdminProductExportRoutes, registerDealerProductExportRoutes, toProductCsv } from "../../worker/routes/product-export";

const adminSession: SessionIdentity = { userId: "u-1", organisationId: "org-1", dealerId: null, role: "ADMIN" };
const dealerSession: SessionIdentity = { userId: "u-2", organisationId: "org-1", dealerId: "dealer-1", role: "DEALER" };

function baseRow(overrides: Partial<OrderExportRow> = {}): OrderExportRow {
	return {
		orderNo: "KIT-1024", orderDate: "2026-08-01", dealerCode: "VLCO", dealerName: "VLCO Sports", city: "Patna", state: "Bihar", gstin: "",
		dealerGroupCode: "", dealerGroupName: "", billToCode: "VLCO", billToName: "VLCO Sports", shipToCode: "VLCO", shipToName: "VLCO Sports", shipToLocation: "",
		dealerPoNumber: "", deliveryPreference: "ASAP", requestedDeliveryDate: "", estimatedDeliveryDate: "",
		brand: "Nike", productFamily: "Air Max", articleNo: "NK-101", colour: "Black", gender: "MEN", category: "Running", offering: "STOCK_IN_HAND", season: "",
		size: "8", orderedQty: 12, approvedQty: 12, heldQty: 0, dispatchedQty: 0, pendingQty: 12,
		dispatchDate: "", dispatchNumber: "",
		mrpMinor: 899900, orderedValueMinor: 10798800, retailValueMinor: 10798800, holdStatus: "", holdReason: "", orderStatus: "SUBMITTED", fulfilmentStatus: "PENDING",
		...overrides,
	};
}

describe("groupProductRows", () => {
	it("groups sizes for the same dealer+article+colour into one row with a sizes map, grand total, and total value", () => {
		const rows = [baseRow({ size: "8", approvedQty: 4 }), baseRow({ size: "7", approvedQty: 6 }), baseRow({ size: "9", approvedQty: 2 })];
		const result = groupProductRows(rows);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			dealerCode: "VLCO", dealerName: "VLCO Sports", articleNo: "NK-101", articleName: "Air Max", mrpMinor: 899900, gender: "Men",
			sizes: new Map([["8", 4], ["7", 6], ["9", 2]]),
			grandTotalPairs: 12,
			totalValueMinor: 899900 * 12,
		});
	});

	it("keeps distinct colourways sharing the same article no. as separate rows", () => {
		const result = groupProductRows([baseRow({ colour: "Black" }), baseRow({ colour: "White", mrpMinor: 799900 })]);
		expect(result).toHaveLength(2);
	});

	it("keeps two different dealers' orders of the same article as separate rows instead of merging their quantities", () => {
		const result = groupProductRows([
			baseRow({ dealerCode: "VLCO", dealerName: "VLCO Sports", approvedQty: 4 }),
			baseRow({ dealerCode: "SHOE1", dealerName: "Shoe Palace", approvedQty: 9 }),
		]);
		expect(result).toHaveLength(2);
		expect(result.map((row) => [row.dealerCode, row.grandTotalPairs])).toEqual([["SHOE1", 9], ["VLCO", 4]]);
	});

	it("drops a line entirely once every size is held/rejected down to zero approved pairs", () => {
		const result = groupProductRows([baseRow({ approvedQty: 0 })]);
		expect(result).toEqual([]);
	});
});

describe("toProductCsv", () => {
	it("prints the dealer once as a small header block, followed by that dealer's article table with one column per distinct size", () => {
		const rows = groupProductRows([
			baseRow({ articleNo: "NK-101", size: "7", approvedQty: 4 }),
			baseRow({ articleNo: "NK-101", size: "9", approvedQty: 2 }),
			baseRow({ articleNo: "RB-1", productFamily: "Classic", mrpMinor: 499900, size: "8", approvedQty: 3 }),
		]);
		const csv = toProductCsv(rows);
		expect(csv).toBe([
			"Dealer Code,Dealer Name",
			"VLCO,VLCO Sports",
			"Article No,Article Name,MRP,Gender,7,8,9,Grand Total,Total Value",
			"NK-101,Air Max,8999.00,Men,4,,2,6,53994.00",
			"RB-1,Classic,4999.00,Men,,3,,3,14997.00",
		].join("\r\n"));
	});

	it("starts a new dealer block, blank-line separated, instead of repeating the dealer on every row -- the consolidated-export case", () => {
		const rows = groupProductRows([
			baseRow({ dealerCode: "VLCO", dealerName: "VLCO Sports", articleNo: "NK-101", size: "7", approvedQty: 4 }),
			baseRow({ dealerCode: "SHOE1", dealerName: "Shoe Palace", articleNo: "NK-101", size: "10", approvedQty: 3 }),
		]);
		const csv = toProductCsv(rows);
		expect(csv).toBe([
			"Dealer Code,Dealer Name",
			"SHOE1,Shoe Palace",
			"Article No,Article Name,MRP,Gender,7,10,Grand Total,Total Value",
			"NK-101,Air Max,8999.00,Men,,3,3,26997.00",
			"",
			"Dealer Code,Dealer Name",
			"VLCO,VLCO Sports",
			"Article No,Article Name,MRP,Gender,7,10,Grand Total,Total Value",
			"NK-101,Air Max,8999.00,Men,4,,4,35996.00",
		].join("\r\n"));
	});
});

function appWithExporter(exportRows: (session: SessionIdentity, filters: OrderExportFilters) => Promise<OrderExportRow[]>, session: SessionIdentity) {
	const app = new Hono<{ Variables: AuthVariables }>();
	app.onError(handleApiError);
	app.use("*", async (context, next) => { context.set("session", session); await next(); });
	return { app, exporter: { exportRows } };
}

describe("registerAdminProductExportRoutes", () => {
	it("filters a single order by id and returns the product CSV shape", async () => {
		let received: OrderExportFilters | undefined;
		const { app, exporter } = appWithExporter(async (_session, filters) => { received = filters; return [baseRow()]; }, adminSession);
		registerAdminProductExportRoutes(app, exporter);
		const response = await app.request("/api/admin/orders/order-42/export-products.csv");
		expect(received).toEqual({ orderId: "order-42" });
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body.split("\r\n").slice(0, 3)).toEqual(["Dealer Code,Dealer Name", "VLCO,VLCO Sports", "Article No,Article Name,MRP,Gender,8,Grand Total,Total Value"]);
	});

	it("threads query filters into the consolidated export", async () => {
		let received: OrderExportFilters | undefined;
		const { app, exporter } = appWithExporter(async (_session, filters) => { received = filters; return []; }, adminSession);
		registerAdminProductExportRoutes(app, exporter);
		await app.request("/api/admin/orders/export-products.csv?dealerId=dealer-9&brand=Nike");
		expect(received).toEqual({ dealerId: "dealer-9", dateFrom: undefined, dateTo: undefined, brand: "Nike", orderStatus: undefined, holdStatus: undefined, state: undefined });
	});

	it("does not register either route when no exporter is supplied", async () => {
		const app = new Hono<{ Variables: AuthVariables }>();
		registerAdminProductExportRoutes(app, undefined);
		expect((await app.request("/api/admin/orders/export-products.csv")).status).toBe(404);
		expect((await app.request("/api/admin/orders/order-1/export-products.csv")).status).toBe(404);
	});
});

describe("registerDealerProductExportRoutes", () => {
	it("always scopes both the per-order and consolidated export by the caller's own dealerId", async () => {
		const received: OrderExportFilters[] = [];
		const { app, exporter } = appWithExporter(async (_session, filters) => { received.push(filters); return []; }, dealerSession);
		registerDealerProductExportRoutes(app, exporter);
		await app.request("/api/orders/order-7/export-products.csv");
		await app.request("/api/orders/export-products.csv");
		expect(received).toEqual([
			{ orderId: "order-7", dealerId: "dealer-1" },
			{ dealerId: "dealer-1" },
		]);
	});
});
