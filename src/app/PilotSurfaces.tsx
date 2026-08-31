import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/ui";
import { ControlConsole } from "../features/admin/ControlConsole";
import type { ControlOrder } from "../features/admin/AdminOrderPanel";
import { OrdersTable } from "../features/reports/OrdersTable";
import "./surfaces.css";

interface LiveOrder extends ControlOrder {
  version?: number;
  retailValueMinor?: number;
  submittedAt?: string;
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
    {reports && orders.length > 0 && <a className="ui-btn ui-btn-secondary ui-btn-md" href="/api/orders/export-products.csv">Download order summary</a>}
    {status !== "ready" ? <SurfaceState status={status} retry={load} /> : orders.length === 0 ? <div className="pilot-orders-empty"><strong>No orders yet.</strong><a className="ui-btn ui-btn-primary ui-btn-md" href="/products">Start an order</a></div>
      : <OrdersTable orders={orders} variant="dealer" downloadHrefFor={(orderId) => `/api/orders/${orderId}/export-products.csv`} />}
  </main>;
}
