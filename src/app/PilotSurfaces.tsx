import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/ui";
import { ControlConsole } from "../features/admin/ControlConsole";
import { StatusPill } from "../features/admin/ControlSections";
import type { ControlOrder } from "../features/admin/AdminOrderPanel";
import type { FulfilmentAllocation } from "../features/dispatch/fulfilment";
import { formatRetailValue } from "../features/catalogue/types";
import { DealerFulfilmentStatus, DealerOrderArticles } from "../features/reports/DealerFulfilmentStatus";
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
  if (status === "forbidden") return <div className="pilot-surface-state" role="alert"><strong>Sign in with the correct account to continue.</strong><a className="ui-btn ui-btn-primary ui-btn-md" href="/login">Sign in</a></div>;
  return <div className="pilot-surface-state" role="alert"><strong>Orders could not be loaded.</strong><Button onClick={retry}>Try again</Button></div>;
}

export function ControlSurface() {
  return <div className="pilot-control-surface"><ControlConsole /></div>;
}

export function OrdersSurface({ reports = false }: { reports?: boolean }) {
  const { orders, status, load } = useOrders("/api/orders");
  return <main className="shell-content pilot-orders-surface">
    <p className="eyebrow">{reports ? "Order status" : "Your orders"}</p>
    <h1>{reports ? "Where's my order?" : "Your Orders"}</h1>
    <p className="intro">{reports ? "See what's been approved, held, dispatched, or is still pending for every order." : "See your past orders below, or start a new one from Products."}</p>
    {status !== "ready" ? <SurfaceState status={status} retry={load} /> : orders.length === 0 ? <div className="pilot-orders-empty"><strong>No orders yet.</strong><a className="ui-btn ui-btn-primary ui-btn-md" href="/products">Start an order</a></div> : <div className="pilot-order-list">{orders.map((order) => <article key={order.id} className="pilot-order-card"><header><div><span>Order</span><strong>{order.orderNumber ?? order.id}</strong></div><StatusPill value={order.status} /></header><div className="pilot-order-meta">{typeof order.retailValueMinor === "number" && <span className="pilot-order-value">{formatRetailValue(order.retailValueMinor)}</span>}</div><DealerFulfilmentStatus order={{ allocations: order.allocations as FulfilmentAllocation[] }} />{order.allocations.length > 0 && <details className="pilot-order-details"><summary>See the articles in this order</summary><DealerOrderArticles allocations={order.allocations as FulfilmentAllocation[]} /></details>}</article>)}</div>}
  </main>;
}
