import { AdminOrderPanel, type ControlOrder } from "./AdminOrderPanel";
import { DealerFulfilmentStatus } from "../reports/DealerFulfilmentStatus";

/**
 * Route-ready KITCO Control composition. A future admin route supplies the
 * scoped order from its loader; this module owns no routing or data fetching.
 */
export function AdminWorkspace({ order }: { order: ControlOrder }) {
	return <div data-workspace="kitco-control"><AdminOrderPanel order={order} /><DealerFulfilmentStatus order={order} /></div>;
}
