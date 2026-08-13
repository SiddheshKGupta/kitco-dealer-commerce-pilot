import { summarizeFulfilment, type FulfilmentAllocation } from "../dispatch/fulfilment";

export function DealerFulfilmentStatus({ order }: { order: { allocations: FulfilmentAllocation[] } }) {
	const status = summarizeFulfilment(order.allocations);
	return <section className="dealer-fulfilment" aria-label="Order fulfilment"><strong>Fulfilment</strong><div><span>Ordered {status.orderedPairs} pairs</span><span>Dispatched {status.dispatchedPairs} pairs</span><span>Pending {status.pendingPairs} pairs</span>{status.heldPairs > 0 && <span>Credit Hold {status.heldPairs} {status.heldPairs === 1 ? "pair" : "pairs"}</span>}</div></section>;
}
