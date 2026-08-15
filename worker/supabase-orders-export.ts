import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionIdentity } from "./middleware/auth";
import type { OrderExportFilters, OrderExportRow, OrdersExporter } from "./routes/admin-export";

type Row = Record<string, any>;

function one(value: unknown): Row | null {
	return Array.isArray(value) ? (value[0] as Row | undefined) ?? null : value && typeof value === "object" ? value as Row : null;
}

function dateOnly(value: unknown): string {
	return typeof value === "string" ? value.slice(0, 10) : "";
}

// product_families/brands are non-nullable FKs, so marking them !inner never excludes rows that
// a default join would have included -- it just lets a brand filter push down as a real SQL join
// condition instead of an in-memory filter. hold_allocations/holds stay a default (non-inner)
// join UNLESS a hold-status filter is active: marking them !inner unconditionally would drop every
// size that has never had a hold at all, which is wrong when nobody asked to filter by hold status.
function buildExportSelect(filters: OrderExportFilters): string {
	const holdJoin = filters.holdStatus
		? "hold_allocations!inner(quantity_pairs,holds!inner(status,reason))"
		: "hold_allocations(quantity_pairs,holds(status,reason))";
	return `
  id,order_number,status,submitted_at,dealer_id,
  dealers!inner(code,name,city,state),
  order_versions(version_no,
    order_lines(id,mrp_minor,
      commercial_offerings(offering_type),
      product_colourways!inner(article_no,colour,product_families!inner(name,category,gender,brands!inner(name))),
      order_line_sizes(ordered_quantity_pairs,approved_quantity_pairs,size_values(label),
        dispatch_lines(quantity_pairs,dispatches(status,dispatched_at,dispatch_number)),
        ${holdJoin})))`;
}

function fulfilmentStatus(approvedPairs: number, dispatchedPairs: number, heldPairs: number): string {
	if (heldPairs > 0 && dispatchedPairs < approvedPairs - heldPairs) return "ON_HOLD";
	if (approvedPairs > 0 && dispatchedPairs >= approvedPairs) return "DISPATCHED";
	if (dispatchedPairs > 0) return "PARTIALLY_DISPATCHED";
	return "PENDING";
}

export class SupabaseOrdersExporter implements OrdersExporter {
	constructor(private readonly client: SupabaseClient) {}

	async exportRows(session: SessionIdentity, filters: OrderExportFilters = {}): Promise<OrderExportRow[]> {
		let query = this.client
			.from("orders")
			.select(buildExportSelect(filters))
			// Organisation scope is applied first and unconditionally: no filter combination below
			// can widen the result past this tenant's own orders.
			.eq("organisation_id", session.organisationId);
		if (filters.dealerId) query = query.eq("dealer_id", filters.dealerId);
		if (filters.orderStatus) query = query.eq("status", filters.orderStatus);
		if (filters.dateFrom) query = query.gte("submitted_at", filters.dateFrom);
		if (filters.dateTo) query = query.lte("submitted_at", `${filters.dateTo}T23:59:59.999Z`);
		if (filters.state) query = query.eq("dealers.state", filters.state);
		if (filters.brand) query = query.eq("order_versions.order_lines.product_colourways.product_families.brands.name", filters.brand);
		if (filters.holdStatus) query = query.eq("order_versions.order_lines.order_line_sizes.hold_allocations.holds.status", filters.holdStatus);
		const { data: orderRows, error: orderError } = await query.order("submitted_at", { ascending: false });
		if (orderError) throw new Error("EXPORT_QUERY_FAILED");

		const { data: gstRows, error: gstError } = await this.client
			.from("dealer_gst_registrations")
			.select("dealer_id,gstin,is_primary")
			.eq("organisation_id", session.organisationId);
		if (gstError) throw new Error("EXPORT_QUERY_FAILED");
		const gstByDealer = new Map<string, string>();
		for (const row of (gstRows ?? []) as Row[]) {
			const existing = gstByDealer.get(String(row.dealer_id));
			if (!existing || row.is_primary) gstByDealer.set(String(row.dealer_id), String(row.gstin));
		}

		const out: OrderExportRow[] = [];
		for (const order of (orderRows ?? []) as Row[]) {
			const dealer = one(order.dealers);
			const versions = Array.isArray(order.order_versions) ? order.order_versions : [];
			const latest = [...versions].sort((a: Row, b: Row) => Number(b.version_no) - Number(a.version_no))[0] as Row | undefined;
			if (!latest) continue;
			for (const line of (Array.isArray(latest.order_lines) ? latest.order_lines : []) as Row[]) {
				const colourway = one(line.product_colourways);
				const family = colourway ? one(colourway.product_families) : null;
				const brand = family ? one(family.brands) : null;
				const offering = one(line.commercial_offerings);
				for (const size of (Array.isArray(line.order_line_sizes) ? line.order_line_sizes : []) as Row[]) {
					const approvedPairs = Number(size.approved_quantity_pairs);
					const orderedPairs = Number(size.ordered_quantity_pairs ?? size.approved_quantity_pairs);
					const finalisedDispatches = (Array.isArray(size.dispatch_lines) ? size.dispatch_lines : [])
						.map((d: Row) => ({ pairs: Number(d.quantity_pairs), dispatch: one(d.dispatches) }))
						.filter((d: { dispatch: Row | null }) => d.dispatch?.status === "FINALISED");
					const dispatchedPairs = finalisedDispatches.reduce((sum: number, d: { pairs: number }) => sum + d.pairs, 0);
					const latestDispatch = [...finalisedDispatches]
						.sort((a, b) => String(b.dispatch?.dispatched_at ?? "").localeCompare(String(a.dispatch?.dispatched_at ?? "")))[0]?.dispatch;
					const holds = (Array.isArray(size.hold_allocations) ? size.hold_allocations : []) as Row[];
					const activeHolds = holds.filter((h: Row) => one(h.holds)?.status === "ACTIVE");
					const heldPairs = activeHolds.reduce((sum: number, h: Row) => sum + Number(h.quantity_pairs ?? 0), 0);
					const holdReason = activeHolds.map((h: Row) => one(h.holds)?.reason).filter(Boolean)[0] ?? "";
					const holdStatus = activeHolds.length > 0 ? "ACTIVE" : holds.some((h: Row) => one(h.holds)?.status === "RELEASED") ? "RELEASED" : "";
					out.push({
						orderNo: String(order.order_number ?? order.id),
						orderDate: dateOnly(order.submitted_at),
						dealerCode: dealer?.code ? String(dealer.code) : "",
						dealerName: dealer?.name ? String(dealer.name) : "",
						city: dealer?.city ? String(dealer.city) : "",
						state: dealer?.state ? String(dealer.state) : "",
						gstin: gstByDealer.get(String(order.dealer_id)) ?? "",
						brand: brand?.name ? String(brand.name) : "",
						productFamily: family?.name ? String(family.name) : "",
						articleNo: colourway?.article_no ? String(colourway.article_no) : "",
						colour: colourway?.colour ? String(colourway.colour) : "",
						gender: family?.gender ? String(family.gender) : "",
						category: family?.category ? String(family.category) : "",
						offering: offering?.offering_type ? String(offering.offering_type) : "",
						season: "", // seasons table has no rows yet (R5) — column kept for the report shape
						size: String(one(size.size_values)?.label ?? ""),
						orderedQty: orderedPairs,
						approvedQty: approvedPairs,
						heldQty: heldPairs,
						dispatchedQty: dispatchedPairs,
						pendingQty: approvedPairs - dispatchedPairs - heldPairs,
						dispatchDate: latestDispatch ? dateOnly(latestDispatch.dispatched_at) : "",
						dispatchNumber: latestDispatch?.dispatch_number ? String(latestDispatch.dispatch_number) : "",
						mrpMinor: Number(line.mrp_minor),
						orderedValueMinor: Number(line.mrp_minor) * orderedPairs,
						retailValueMinor: Number(line.mrp_minor) * approvedPairs,
						holdStatus: String(holdStatus),
						holdReason: String(holdReason),
						orderStatus: String(order.status),
						fulfilmentStatus: fulfilmentStatus(approvedPairs, dispatchedPairs, heldPairs),
					});
				}
			}
		}
		return out;
	}
}
