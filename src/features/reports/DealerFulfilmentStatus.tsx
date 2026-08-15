import { groupByArticle, summarizeFulfilment, type FulfilmentAllocation } from "../dispatch/fulfilment";

export function DealerFulfilmentStatus({ order }: { order: { allocations: FulfilmentAllocation[] } }) {
	const status = summarizeFulfilment(order.allocations);
	return <section className="dealer-fulfilment" aria-label="Order fulfilment"><strong>Fulfilment</strong><div><span>Ordered {status.orderedPairs} pairs</span><span>Dispatched {status.dispatchedPairs} pairs</span><span>Pending {status.pendingPairs} pairs</span>{status.heldPairs > 0 && <span>Credit Hold {status.heldPairs} {status.heldPairs === 1 ? "pair" : "pairs"}</span>}</div></section>;
}

function articleLabel(identity: FulfilmentAllocation) {
	if (!identity.articleNo) return "Article";
	const name = identity.familyName ?? identity.articleNo;
	return [identity.brand, name, identity.articleNo !== name ? identity.articleNo : null].filter(Boolean).join(" · ");
}

/** Per-article breakdown for an expanded order card: family/article name, colour, size×pairs, and plain-language status. */
export function DealerOrderArticles({ allocations }: { allocations: FulfilmentAllocation[] }) {
	const articles = groupByArticle(allocations);
	return <div className="dealer-order-articles">{articles.map(([orderLineId, items]) => {
		const identity = items[0];
		const summary = summarizeFulfilment(items);
		return <article className="dealer-order-article" key={orderLineId}>
			<header><strong>{articleLabel(identity)}</strong>{identity.colour && <span>{identity.colour}</span>}</header>
			<div className="dealer-order-article-sizes">{items.map((item) => <span key={`${item.orderLineId}:${item.size}`}>Size {item.size} · {item.approvedPairs} {item.approvedPairs === 1 ? "pair" : "pairs"}</span>)}</div>
			<div className="dealer-order-article-status"><span>Ordered {summary.orderedPairs} pairs</span><span>Dispatched {summary.dispatchedPairs} pairs</span><span>Pending {summary.pendingPairs} pairs</span>{summary.heldPairs > 0 && <span>Credit Hold {summary.heldPairs} {summary.heldPairs === 1 ? "pair" : "pairs"}</span>}</div>
		</article>;
	})}</div>;
}
