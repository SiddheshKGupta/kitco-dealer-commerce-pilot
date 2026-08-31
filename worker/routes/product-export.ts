import type { Context, Hono } from "hono";
import type { AuthVariables } from "../middleware/auth";
import { csvEscape, parseFilters, type OrderExportRow, type OrdersExporter } from "./admin-export";

export interface ProductExportRow {
	dealerCode: string; dealerName: string; articleNo: string; articleName: string; mrpMinor: number; gender: string; sizes: Map<string, number>; grandTotalPairs: number; totalValueMinor: number;
}

function titleCase(value: string): string {
	return value.split(" ").filter(Boolean).map((word) => word.charAt(0) + word.slice(1).toLowerCase()).join(" ");
}

function sizeSortKey(label: string): number {
	const value = Number.parseFloat(label);
	return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

/** Groups the flat per-order/line/size export rows into one row per distinct dealer +
 *  article (article no. + colour, since the same article no. can carry more than one
 *  colourway at a different MRP -- colour itself isn't a requested column, but still
 *  separates the grain). Grouping by dealer as well as article matters even for a
 *  single-dealer export (it's a no-op there) and is essential for a multi-dealer
 *  consolidated export: without it, two different dealers' orders of the same article
 *  would silently merge into one blended quantity with no way to tell them apart.
 *  Quantities default to approvedQty, matching the "Retail Value" already shown on the
 *  admin side; a line held/rejected down to zero drops out entirely rather than showing
 *  an empty, zero-value row. The dealer's own download passes "orderedQty" instead --
 *  otherwise every order still awaiting a decision (approvedQty still 0) would produce a
 *  completely empty file for the dealer who just placed it. */
export function groupProductRows(rows: OrderExportRow[], qtyField: "approvedQty" | "orderedQty" = "approvedQty"): ProductExportRow[] {
	const groups = new Map<string, { dealerCode: string; dealerName: string; articleNo: string; articleName: string; mrpMinor: number; gender: string; sizes: Map<string, number> }>();
	for (const row of rows) {
		const key = `${row.dealerCode}||${row.articleNo}||${row.colour}`;
		let group = groups.get(key);
		if (!group) { group = { dealerCode: row.dealerCode, dealerName: row.dealerName, articleNo: row.articleNo, articleName: row.productFamily, mrpMinor: row.mrpMinor, gender: titleCase(row.gender || "Unknown"), sizes: new Map() }; groups.set(key, group); }
		const qty = row[qtyField];
		if (qty > 0) group.sizes.set(row.size, (group.sizes.get(row.size) ?? 0) + qty);
	}
	return [...groups.values()]
		.filter((group) => group.sizes.size > 0)
		.sort((a, b) => a.dealerName.localeCompare(b.dealerName) || a.articleNo.localeCompare(b.articleNo))
		.map((group) => {
			const grandTotalPairs = [...group.sizes.values()].reduce((sum, qty) => sum + qty, 0);
			return { dealerCode: group.dealerCode, dealerName: group.dealerName, articleNo: group.articleNo, articleName: group.articleName, mrpMinor: group.mrpMinor, gender: group.gender, sizes: group.sizes, grandTotalPairs, totalValueMinor: group.mrpMinor * grandTotalPairs };
		});
}

/** One column per distinct size seen ANYWHERE in this export (sparse -- blank where a
 *  given article doesn't carry that size), kept consistent across every dealer's block
 *  so columns line up throughout the file. Rows are grouped into one block per dealer --
 *  printing "Dealer Code,Dealer Name" once followed by that dealer's article table --
 *  rather than repeating the dealer on every article row. This is a no-op shape (one
 *  block) for a single dealer's own report and the real payoff for a multi-dealer
 *  consolidated export, where repeating the same dealer on every line was pure noise. */
export function toProductCsv(rows: ProductExportRow[]): string {
	const allSizes = [...new Set(rows.flatMap((row) => [...row.sizes.keys()]))].sort((a, b) => sizeSortKey(a) - sizeSortKey(b));
	const articleHeaders = ["Article No", "Article Name", "MRP", "Gender", ...allSizes, "Grand Total", "Total Value"];
	const blocks: string[][] = [];
	let currentDealer = "";
	let block: string[] = [];
	for (const row of rows) {
		const dealerKey = `${row.dealerCode}||${row.dealerName}`;
		if (dealerKey !== currentDealer) {
			if (block.length > 0) blocks.push(block);
			currentDealer = dealerKey;
			block = ["Dealer Code,Dealer Name", [row.dealerCode, row.dealerName].map(csvEscape).join(","), articleHeaders.join(",")];
		}
		block.push([
			row.articleNo, row.articleName, (row.mrpMinor / 100).toFixed(2), row.gender,
			...allSizes.map((size) => row.sizes.get(size) ?? ""),
			row.grandTotalPairs, (row.totalValueMinor / 100).toFixed(2),
		].map(csvEscape).join(","));
	}
	if (block.length > 0) blocks.push(block);
	return blocks.map((lines) => lines.join("\r\n")).join("\r\n\r\n");
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
		return sendCsv(context, groupProductRows(rows, "orderedQty"), `kitco-order-${context.req.param("orderId")}`);
	});
	app.get("/api/orders/export-products.csv", async (context) => {
		const session = context.get("session");
		const rows = await exporter.exportRows(session, { dealerId: session.dealerId ?? undefined });
		return sendCsv(context, groupProductRows(rows, "orderedQty"), "kitco-my-orders");
	});
}
