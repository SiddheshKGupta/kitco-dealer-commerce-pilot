import { useCallback, useEffect, useState } from "react";
import { AdminWorkspace } from "../features/admin/AdminWorkspace";
import type { ControlOrder } from "../features/admin/AdminOrderPanel";
import type { FulfilmentAllocation } from "../features/dispatch/fulfilment";
import { formatRetailValue } from "../features/catalogue/types";
import { DealerFulfilmentStatus } from "../features/reports/DealerFulfilmentStatus";
import "./surfaces.css";

interface LiveOrder extends ControlOrder {
  version?: number;
  retailValueMinor?: number;
}

function useOrders(path: "/api/orders" | "/api/admin/orders") {
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const load = useCallback(() => {
    setStatus("loading");
    void fetch(path, { credentials: "include" }).then(async (response) => {
      if (response.status === 401 || response.status === 403) { setStatus("forbidden"); return; }
      if (!response.ok) throw new Error("Orders could not be loaded");
      const body = await response.json() as { orders?: LiveOrder[] };
      setOrders((body.orders ?? []).map((order) => ({ ...order, allocations: order.allocations ?? [], audit: order.audit ?? [] })));
      setStatus("ready");
    }).catch(() => setStatus("error"));
  }, [path]);
  useEffect(load, [load]);
  return { orders, status, load };
}

function SurfaceState({ status, retry }: { status: "loading" | "error" | "forbidden"; retry: () => void }) {
  if (status === "loading") return <p className="pilot-surface-state" role="status">Loading live orders…</p>;
  if (status === "forbidden") return <div className="pilot-surface-state" role="alert"><strong>Sign in with the correct account to continue.</strong><a className="primary-action" href="/login">Sign in</a></div>;
  return <div className="pilot-surface-state" role="alert"><strong>Orders could not be loaded.</strong><button className="primary-action" type="button" onClick={retry}>Try again</button></div>;
}

export function ControlSurface() {
  const { orders, status, load } = useOrders("/api/admin/orders");
  if (status !== "ready") return <main className="shell-content pilot-control-loading"><h1>KITCO Control</h1><SurfaceState status={status} retry={load} /></main>;
  if (orders.length === 0) return <main className="shell-content pilot-control-loading"><p className="eyebrow">KITCO Control</p><h1>No orders awaiting review.</h1><p className="intro">Submitted dealer orders will appear here automatically.</p></main>;
  return <div className="pilot-control-surface"><AdminWorkspace order={orders[0]} /></div>;
}

export function OrdersSurface({ reports = false }: { reports?: boolean }) {
  const { orders, status, load } = useOrders("/api/orders");
  return <main className="shell-content pilot-orders-surface">
    <p className="eyebrow">{reports ? "Dealer reporting" : "Dealer ordering"}</p>
    <h1>{reports ? "Fulfilment reports" : "Current Order"}</h1>
    <p className="intro">{reports ? "Track ordered, dispatched, held, and pending pairs from KITCO's live ledger." : "Track submitted orders or start your next order from the catalogue."}</p>
    {status !== "ready" ? <SurfaceState status={status} retry={load} /> : orders.length === 0 ? <div className="pilot-orders-empty"><strong>No submitted orders yet.</strong><a className="primary-action" href="/products">Start an order</a></div> : <div className="pilot-order-list">{orders.map((order) => <article key={order.id} className="pilot-order-card"><header><div><span>Order</span><strong>{order.id}</strong></div><b>{order.status}</b></header><div className="pilot-order-meta"><span>Version {order.version ?? 1}</span>{typeof order.retailValueMinor === "number" && <span>Retail Value {formatRetailValue(order.retailValueMinor)}</span>}</div><DealerFulfilmentStatus order={{ allocations: order.allocations as FulfilmentAllocation[] }} /></article>)}</div>}
  </main>;
}
