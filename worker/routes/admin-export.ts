import type { Hono } from "hono";
import type { AuthVariables, SessionIdentity } from "../middleware/auth";

export interface OrderExportRow {
	orderNo: string; orderDate: string; dealerCode: string; dealerName: string; city: string; state: string; gstin: string;
	brand: string; productFamily: string; articleNo: string; colour: string; gender: string; category: string; offering: string; season: string;
	size: string; orderedQty: number; approvedQty: number; heldQty: number; dispatchedQty: number; pendingQty: number;
	dispatchDate: string; dispatchNumber: string;
	mrpMinor: number; orderedValueMinor: number; retailValueMinor: number; holdStatus: string; holdReason: string; orderStatus: string; fulfilmentStatus: string;
}

/** Query-param filters for the export, all optional and org-scoped by the caller. */
export interface OrderExportFilters {
	dealerId?: string; dateFrom?: string; dateTo?: string; brand?: string; orderStatus?: string; holdStatus?: string; state?: string;
}

/** One consolidated dealer-wise CSV, one row per dealer -> order -> article -> size (D7). */
export interface OrdersExporter {
	exportRows(session: SessionIdentity, filters: OrderExportFilters): Promise<OrderExportRow[]>;
}

// 30 columns per the export spec (§29): the original 26 plus dispatch date/number and a
// per-line hold status/reason pair -- see commit message for the column additions rationale.
const HEADERS = [
	"Order No", "Order Date", "Dealer Code", "Dealer Name", "City", "State", "GSTIN",
	"Brand", "Product Family", "Article No", "Colour", "Gender", "Category", "Offering", "Season",
	"Size", "Ordered Qty", "Approved Qty", "Held Qty", "Dispatched Qty", "Pending Qty",
	"Dispatch Date", "Dispatch Number",
	"MRP", "Ordered Value", "Retail Value", "Hold Status", "Hold Reason", "Order Status", "Fulfilment Status",
];

function csvEscape(value: string | number): string {
	const text = String(value);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: OrderExportRow[]): string {
	const lines = [HEADERS.join(",")];
	for (const row of rows) {
		lines.push([
			row.orderNo, row.orderDate, row.dealerCode, row.dealerName, row.city, row.state, row.gstin,
			row.brand, row.productFamily, row.articleNo, row.colour, row.gender, row.category, row.offering, row.season,
			row.size, row.orderedQty, row.approvedQty, row.heldQty, row.dispatchedQty, row.pendingQty,
			row.dispatchDate, row.dispatchNumber,
			(row.mrpMinor / 100).toFixed(2), (row.orderedValueMinor / 100).toFixed(2), (row.retailValueMinor / 100).toFixed(2),
			row.holdStatus, row.holdReason, row.orderStatus, row.fulfilmentStatus,
		].map(csvEscape).join(","));
	}
	return lines.join("\r\n");
}

function parseFilters(query: Record<string, string>): OrderExportFilters {
	const pick = (key: string) => { const value = query[key]?.trim(); return value ? value : undefined; };
	return {
		dealerId: pick("dealerId"), dateFrom: pick("dateFrom"), dateTo: pick("dateTo"),
		brand: pick("brand"), orderStatus: pick("orderStatus"), holdStatus: pick("holdStatus"), state: pick("state"),
	};
}

export function registerAdminExportRoutes(app: Hono<{ Variables: AuthVariables }>, exporter?: OrdersExporter): void {
	if (!exporter) return;
	app.get("/api/admin/orders/export.csv", async (context) => {
		const rows = await exporter.exportRows(context.get("session"), parseFilters(context.req.query()));
		context.header("Content-Type", "text/csv; charset=utf-8");
		context.header("Content-Disposition", `attachment; filename="kitco-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
		return context.body(toCsv(rows));
	});
}
