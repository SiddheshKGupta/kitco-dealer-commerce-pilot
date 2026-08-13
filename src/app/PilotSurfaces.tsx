import { AdminWorkspace } from "../features/admin/AdminWorkspace";
import type { ControlOrder } from "../features/admin/AdminOrderPanel";
import "./surfaces.css";

const previewOrder: ControlOrder = {
  id: "PILOT-PREVIEW-001",
  status: "UNDER_REVIEW",
  allocations: [
    { orderLineId: "preview-line-1", size: "7", approvedPairs: 6, dispatchedPairs: 2, heldPairs: 1 },
    { orderLineId: "preview-line-1", size: "8", approvedPairs: 4, dispatchedPairs: 0, heldPairs: 0 },
  ],
  audit: [{ action: "ORDER_SUBMITTED", correlationId: "preview-correlation" }],
};

export function ControlSurface() {
  return <main className="pilot-control-surface">
    <p className="pilot-preview-note" role="status">Preview data · Sign in as an administrator to load live orders.</p>
    <AdminWorkspace order={previewOrder} />
  </main>;
}

export function OrdersSurface() {
  return <main className="shell-content pilot-orders-surface">
    <p className="eyebrow">Dealer ordering</p>
    <h1>Current Order</h1>
    <p className="intro">Choose a product to start or resume your server-saved order.</p>
    <a className="primary-action" href="/products">Browse products</a>
  </main>;
}
