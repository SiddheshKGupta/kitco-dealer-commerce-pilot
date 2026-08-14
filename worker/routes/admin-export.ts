import type { Hono } from "hono";
import type { AuthVariables, SessionIdentity } from "../middleware/auth";

export interface OrderExportRow {
	orderNo: string; orderDate: string; dealerCode: string; dealerName: string; city: string; state: string; gstin: string;
	brand: string; productFamily: string; articleNo: string; colour: string; gender: string; category: string; offering: string; season: string;
	size: string; orderedQty: number; approvedQty: number; heldQty: number; dispatchedQty: number; pendingQty: number;
	mrpMinor: number; retailValueMinor: number; holdReason: string; orderStatus: string; fulfilmentStatus: string;
}

/** One consolidated dealer-wise CSV, one row per dealer -> order -> article -> size (D7). */
export interface OrdersExporter {
	exportRows(session: SessionIdentity): Promise<OrderExportRow[]>;
}

const HEADERS = [
	"Order No", "Order Date", "Dealer Code", "Dealer Name", "City", "State", "GSTIN",
	"Brand", "Product Family", "Article No", "Colour", "Gender", "Category", "Offering", "Season",
	"Size", "Ordered Qty", "Approved Qty", "Held Qty", "Dispatched Qty", "Pending Qty",
	"MRP", "Retail Value", "Hold Reason", "Order Status", "Fulfilment Status",
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
			(row.mrpMinor / 100).toFixed(2), (row.retailValueMinor / 100).toFixed(2),
			row.holdReason, row.orderStatus, row.fulfilmentStatus,
		].map(csvEscape).join(","));
	}
	return lines.join("\r\n");
}

export function registerAdminExportRoutes(app: Hono<{ Variables: AuthVariables }>, exporter?: OrdersExporter): void {
	if (!exporter) return;
	app.get("/api/admin/orders/export.csv", async (context) => {
		const rows = await exporter.exportRows(context.get("session"));
		context.header("Content-Type", "text/csv; charset=utf-8");
		context.header("Content-Disposition", `attachment; filename="kitco-orders-${new Date().toISOString().slice(0, 10)}.csv"`);
		return context.body(toCsv(rows));
	});
}
