import type { Context, Hono } from "hono";
import type { AuthVariables } from "../middleware/auth";
import { csvEscape, parseFilters, type OrderExportRow, type OrdersExporter } from "./admin-export";

export interface ProductExportRow {
	articleNo: string; articleName: string; mrpMinor: number; gender: string; sizeQuantities: string; totalValueMinor: number;
}

const PRODUCT_HEADERS = ["Article No", "Article Name", "MRP", "Gender", "All Sizes by Quantity", "Total Value"];

function titleCase(value: string): string {
	return value.split(" ").filter(Boolean).map((word) => word.charAt(0) + word.slice(1).toLowerCase()).join(" ");
}

function sizeSortKey(label: string): number {
	const value = Number.parseFloat(label);
	return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

/** Groups the flat per-order/line/size export rows into one row per distinct article
 *  (article no. + colour, since the same article no. can carry more than one colourway
 *  at a different MRP -- colour itself isn't a requested column, but still separates the
 *  grain). Quantities use approvedQty, matching the "Retail Value" already shown to
 *  dealers elsewhere in the app; a line held/rejected down to zero drops out entirely
 *  rather than showing an empty, zero-value row. */
export function groupProductRows(rows: OrderExportRow[]): ProductExportRow[] {
	const groups = new Map<string, { articleNo: string; articleName: string; mrpMinor: number; gender: string; sizes: Map<string, number> }>();
	for (const row of rows) {
		const key = `${row.articleNo}||${row.colour}`;
		let group = groups.get(key);
		if (!group) { group = { articleNo: row.articleNo, articleName: row.productFamily, mrpMinor: row.mrpMinor, gender: titleCase(row.gender || "Unknown"), sizes: new Map() }; groups.set(key, group); }
		if (row.approvedQty > 0) group.sizes.set(row.size, (group.sizes.get(row.size) ?? 0) + row.approvedQty);
	}
	return [...groups.values()]
		.filter((group) => group.sizes.size > 0)
		.sort((a, b) => a.articleNo.localeCompare(b.articleNo))
		.map((group) => {
			const sizeQuantities = [...group.sizes.entries()].sort((a, b) => sizeSortKey(a[0]) - sizeSortKey(b[0])).map(([size, qty]) => `${size}x${qty}`).join(", ");
			const totalPairs = [...group.sizes.values()].reduce((sum, qty) => sum + qty, 0);
			return { articleNo: group.articleNo, articleName: group.articleName, mrpMinor: group.mrpMinor, gender: group.gender, sizeQuantities, totalValueMinor: group.mrpMinor * totalPairs };
		});
}

export function toProductCsv(rows: ProductExportRow[]): string {
	const lines = [PRODUCT_HEADERS.join(",")];
	for (const row of rows) {
		lines.push([row.articleNo, row.articleName, (row.mrpMinor / 100).toFixed(2), row.gender, row.sizeQuantities, (row.totalValueMinor / 100).toFixed(2)].map(csvEscape).join(","));
	}
	return lines.join("\r\n");
}

function sendCsv(context: Context<{ Variables: AuthVariables }>, rows: ProductExportRow[], filenamePrefix: string) {
	context.header("Content-Type", "text/csv; charset=utf-8");
	context.header("Content-Disposition", `attachment; filename="${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv"`);
	return context.body(toProductCsv(rows));
}

/** Must be registered before registerAdminOrderRoutes: its GET /api/admin/orders/:orderId
 *  would otherwise shadow the literal /api/admin/orders/export-products.csv route. */
export function registerAdminProductExportRoutes(app: Hono<{ Variables: AuthVariables }>, exporter?: OrdersExporter): void {
	if (!exporter) return;
	app.get("/api/admin/orders/:orderId/export-products.csv", async (context) => {
		const rows = await exporter.exportRows(context.get("session"), { orderId: context.req.param("orderId") });
		return sendCsv(context, groupProductRows(rows), `kitco-order-${context.req.param("orderId")}`);
	});
	app.get("/api/admin/orders/export-products.csv", async (context) => {
		const rows = await exporter.exportRows(context.get("session"), parseFilters(context.req.query()));
		return sendCsv(context, groupProductRows(rows), "kitco-orders-summary");
	});
}

/** Must be registered before registerOrderRoutes: its GET /api/orders/:orderId would
 *  otherwise shadow the literal /api/orders/export-products.csv route. Every query is
 *  additionally scoped by the caller's own dealerId -- never another dealer's orders. */
export function registerDealerProductExportRoutes(app: Hono<{ Variables: AuthVariables }>, exporter?: OrdersExporter): void {
	if (!exporter) return;
	app.get("/api/orders/:orderId/export-products.csv", async (context) => {
		const session = context.get("session");
		const rows = await exporter.exportRows(session, { orderId: context.req.param("orderId"), dealerId: session.dealerId ?? undefined });
		return sendCsv(context, groupProductRows(rows), `kitco-order-${context.req.param("orderId")}`);
	});
	app.get("/api/orders/export-products.csv", async (context) => {
		const session = context.get("session");
		const rows = await exporter.exportRows(session, { dealerId: session.dealerId ?? undefined });
		return sendCsv(context, groupProductRows(rows), "kitco-my-orders");
	});
}
