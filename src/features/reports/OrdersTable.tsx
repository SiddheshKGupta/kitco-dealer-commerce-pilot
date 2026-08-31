import { Fragment } from "react";
import { Button } from "../../components/ui";
import { StatusPill } from "../admin/ControlSections";
import { formatRetailValue } from "../catalogue/types";
import { summarizeFulfilment, type FulfilmentAllocation } from "../dispatch/fulfilment";
import { useIsNarrowViewport } from "../../hooks/useIsNarrowViewport";
import { DealerOrderArticles } from "./DealerFulfilmentStatus";
import "./orders-table.css";

export interface OrderTableRow {
	id: string;
	orderNumber?: string;
	status: string;
	submittedAt?: string;
	retailValueMinor?: number;
	allocations: FulfilmentAllocation[];
	dealerName?: string;
	dealerCity?: string;
	dealerState?: string;
}

const dash = "—";
const shortDate = (value?: string) => (value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : dash);

function HoldFlag({ pairs }: { pairs: number }) {
	if (pairs <= 0) return null;
	return <span className="orders-table-hold">⚑ {pairs} on hold</span>;
}

/** One dense table on desktop, one card list on mobile -- same data, laid out for the two
 *  very different scenes this screen serves: an ops desk scanning many rows at once, and a
 *  dealer checking their own orders on a phone in a shop. "variant" only changes which
 *  identity/action columns make sense -- a dealer's own orders never need a Dealer column
 *  or a decision-review button; an admin queue always does. */
export function OrdersTable({ orders, variant, onReview, downloadHrefFor }: {
	orders: OrderTableRow[];
	variant: "dealer" | "admin";
	onReview?: (orderId: string) => void;
	downloadHrefFor?: (orderId: string) => string;
}) {
	const narrow = useIsNarrowViewport(900);
	return narrow
		? <OrderCards orders={orders} variant={variant} onReview={onReview} downloadHrefFor={downloadHrefFor} />
		: <OrderDenseTable orders={orders} variant={variant} onReview={onReview} downloadHrefFor={downloadHrefFor} />;
}

function OrderDenseTable({ orders, variant, onReview, downloadHrefFor }: {
	orders: OrderTableRow[]; variant: "dealer" | "admin";
	onReview?: (orderId: string) => void; downloadHrefFor?: (orderId: string) => string;
}) {
	const showDealerColumn = variant === "admin";
	const columnCount = showDealerColumn ? 9 : 8;
	return <div className="orders-table-wrap">
		<table className="orders-table">
			<thead>
				<tr className="orders-table-group-row">
					<th colSpan={showDealerColumn ? 3 : 2} />
					<th colSpan={4} className="orders-table-group">Pairs</th>
					<th colSpan={2} />
				</tr>
				<tr>
					<th>Order</th>
					{showDealerColumn && <th>Dealer</th>}
					<th>Status</th>
					<th className="right">Requested</th>
					<th className="right">Confirmed</th>
					<th className="right">Shipped</th>
					<th className="right">Remaining</th>
					<th className="right">Value</th>
					<th />
				</tr>
			</thead>
			<tbody>
				{orders.map((order) => {
					const summary = summarizeFulfilment(order.allocations);
					return <Fragment key={order.id}>
						<tr>
							<td><strong>{order.orderNumber ?? order.id.slice(0, 8)}</strong><span className="orders-table-sub">{shortDate(order.submittedAt)}</span></td>
							{showDealerColumn && <td>{order.dealerName ?? dash}<span className="orders-table-sub">{[order.dealerCity, order.dealerState].filter(Boolean).join(", ") || dash}</span></td>}
							<td><div className="orders-table-status-cell"><StatusPill value={order.status} /><HoldFlag pairs={summary.heldPairs} /></div></td>
							<td className="right">{summary.orderedPairs}</td>
							<td className="right">{summary.approvedPairs}</td>
							<td className="right">{summary.dispatchedPairs}</td>
							<td className="right">{summary.pendingPairs}</td>
							<td className="right">{typeof order.retailValueMinor === "number" ? formatRetailValue(order.retailValueMinor) : dash}</td>
							<td className="right">
								{variant === "admin" && onReview && <Button variant="secondary" size="sm" onClick={() => onReview(order.id)}>Review</Button>}
								{variant === "dealer" && downloadHrefFor && <a className="ui-btn ui-btn-secondary ui-btn-sm" href={downloadHrefFor(order.id)}>Download</a>}
							</td>
						</tr>
						{variant === "dealer" && <tr className="orders-table-detail-row">
							<td colSpan={columnCount}>
								<details className="pilot-order-details">
									<summary>See the articles in this order</summary>
									<DealerOrderArticles allocations={order.allocations} />
								</details>
							</td>
						</tr>}
					</Fragment>;
				})}
			</tbody>
		</table>
	</div>;
}

function OrderCards({ orders, variant, onReview, downloadHrefFor }: {
	orders: OrderTableRow[]; variant: "dealer" | "admin";
	onReview?: (orderId: string) => void; downloadHrefFor?: (orderId: string) => string;
}) {
	// Reuses .pilot-order-card and friends from src/app/surfaces.css, which every route
	// bundles today (PilotSurfaces is statically imported, not lazy) -- see OrdersSurface.
	return <div className="pilot-order-list">
		{orders.map((order) => {
			const summary = summarizeFulfilment(order.allocations);
			return <article className="pilot-order-card" key={order.id}>
				<header>
					<div><span>Order</span><strong>{order.orderNumber ?? order.id.slice(0, 8)}</strong></div>
					<StatusPill value={order.status} />
				</header>
				{variant === "admin" && <p className="orders-table-card-dealer"><strong>{order.dealerName ?? dash}</strong> {[order.dealerCity, order.dealerState].filter(Boolean).join(", ")}</p>}
				<div className="pilot-order-meta">
					{typeof order.retailValueMinor === "number" && <span className="pilot-order-value">{formatRetailValue(order.retailValueMinor)}</span>}
					<span className="orders-table-card-date">{shortDate(order.submittedAt)}</span>
					<HoldFlag pairs={summary.heldPairs} />
				</div>
				<div className="dealer-fulfilment">
					<strong>Fulfilment</strong>
					<div>
						<span>Requested {summary.orderedPairs} pairs</span>
						<span>Confirmed {summary.approvedPairs} pairs</span>
						<span>Shipped {summary.dispatchedPairs} pairs</span>
						<span>Remaining {summary.pendingPairs} pairs</span>
					</div>
				</div>
				{variant === "dealer" && order.allocations.length > 0 && <details className="pilot-order-details">
					<summary>See the articles in this order</summary>
					<DealerOrderArticles allocations={order.allocations} />
				</details>}
				{variant === "admin" && onReview && <Button variant="secondary" full onClick={() => onReview(order.id)}>Review</Button>}
				{variant === "dealer" && downloadHrefFor && <a className="ui-btn ui-btn-secondary ui-btn-md" href={downloadHrefFor(order.id)}>Download this order</a>}
			</article>;
		})}
	</div>;
}
