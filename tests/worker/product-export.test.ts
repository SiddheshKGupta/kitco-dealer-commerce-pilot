import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthVariables, SessionIdentity } from "../../worker/middleware/auth";
import { handleApiError } from "../../worker/middleware/errors";
import type { OrderExportFilters, OrderExportRow } from "../../worker/routes/admin-export";
import { groupProductRows, registerAdminProductExportRoutes, registerDealerProductExportRoutes } from "../../worker/routes/product-export";

const adminSession: SessionIdentity = { userId: "u-1", organisationId: "org-1", dealerId: null, role: "ADMIN" };
const dealerSession: SessionIdentity = { userId: "u-2", organisationId: "org-1", dealerId: "dealer-1", role: "DEALER" };

function baseRow(overrides: Partial<OrderExportRow> = {}): OrderExportRow {
	return {
		orderNo: "KIT-1024", orderDate: "2026-08-01", dealerCode: "VLCO", dealerName: "VLCO Sports", city: "Patna", state: "Bihar", gstin: "",
		brand: "Nike", productFamily: "Air Max", articleNo: "NK-101", colour: "Black", gender: "MEN", category: "Running", offering: "STOCK_IN_HAND", season: "",
		size: "8", orderedQty: 12, approvedQty: 12, heldQty: 0, dispatchedQty: 0, pendingQty: 12,
		dispatchDate: "", dispatchNumber: "",
		mrpMinor: 899900, orderedValueMinor: 10798800, retailValueMinor: 10798800, holdStatus: "", holdReason: "", orderStatus: "SUBMITTED", fulfilmentStatus: "PENDING",
		...overrides,
	};
}

describe("groupProductRows", () => {
	it("groups sizes for the same article+colour into one row with a combined size:qty string and total value", () => {
		const rows = [baseRow({ size: "8", approvedQty: 4 }), baseRow({ size: "7", approvedQty: 6 }), baseRow({ size: "9", approvedQty: 2 })];
		const result = groupProductRows(rows);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			articleNo: "NK-101", articleName: "Air Max", mrpMinor: 899900, gender: "Men",
			sizeQuantities: "7x6, 8x4, 9x2",
			totalValueMinor: 899900 * 12,
		});
	});

	it("keeps distinct colourways sharing the same article no. as separate rows", () => {
		const result = groupProductRows([baseRow({ colour: "Black" }), baseRow({ colour: "White", mrpMinor: 799900 })]);
		expect(result).toHaveLength(2);
	});

	it("drops a line entirely once every size is held/rejected down to zero approved pairs", () => {
		const result = groupProductRows([baseRow({ approvedQty: 0 })]);
		expect(result).toEqual([]);
	});

	it("sorts numeric size labels in ascending order", () => {
		const rows = [baseRow({ size: "10", approvedQty: 1 }), baseRow({ size: "2", approvedQty: 1 })];
		expect(groupProductRows(rows)[0]!.sizeQuantities).toBe("2x1, 10x1");
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
		expect(body.split("\r\n")[0]).toBe("Article No,Article Name,MRP,Gender,All Sizes by Quantity,Total Value");
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
