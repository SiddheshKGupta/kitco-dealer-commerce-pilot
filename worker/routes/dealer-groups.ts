import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables, SessionIdentity } from "../middleware/auth";
import { parseBody } from "./shared";

/** A sibling dealer as a Bill-To/Ship-To picker needs to see it. Deliberately narrow:
 *  group membership authorises SELECTABILITY and nothing else -- a sibling's orders,
 *  credit, logins and activity never appear here or anywhere else (v5 §3). */
export interface GroupDealerLocationRow {
  id: string;
  name: string;
  locationType: string;
  address: Record<string, unknown>;
}

export interface GroupDealerRow {
  dealerId: string;
  dealerCode: string;
  displayName: string;
  gstin: string | null;
  city: string | null;
  state: string | null;
  isSelf: boolean;
  isMainDealer: boolean;
  /** Active SHIP_TO/BOTH locations only -- exactly the ship-to candidates, so the
   *  picker can never offer a location resolveOrderPartners would then reject. */
  locations: GroupDealerLocationRow[];
}

export interface DealerGroupPayload {
  group: { id: string; groupCode: string; groupName: string; status: string } | null;
  dealers: GroupDealerRow[];
}

export interface MembershipRequestRow {
  id: string;
  requestedGroupCode: string;
  status: string;
  requestedAt: string;
  decidedAt: string | null;
  decisionNotes: string | null;
}

export interface AdminDealerGroupRow {
  id: string;
  groupCode: string;
  groupName: string;
  status: string;
  primaryDealerId: string | null;
  dealerCount: number;
}

export interface AdminMembershipRequestRow extends MembershipRequestRow {
  dealerId: string;
  dealerCode: string;
  dealerName: string;
}

/** Whatever the browser claims the partner functions are. Every id here is untrusted
 *  input and is re-derived from the database against the session's own dealer. */
export interface OrderPartnerSelection {
  billToDealerId?: string | null;
  shipToDealerId?: string | null;
  shipToLocationId?: string | null;
}

export interface ResolvedOrderPartners {
  orderingDealerId: string;
  billToDealerId: string;
  shipToDealerId: string;
  shipToLocationId: string | null;
  /** The group that authorised a cross-dealer selection; null when the dealer named
   *  only itself (no group, or a SUSPENDED one). */
  dealerGroupId: string | null;
}

export interface DealerGroupsStore {
  groupForDealer(session: SessionIdentity): Promise<DealerGroupPayload>;
  listOwnRequests(session: SessionIdentity): Promise<MembershipRequestRow[]>;
  requestMembership(session: SessionIdentity, groupCode: string, correlationId: string): Promise<MembershipRequestRow>;
  listGroups(session: SessionIdentity): Promise<AdminDealerGroupRow[]>;
  createGroup(session: SessionIdentity, groupCode: string, groupName: string, correlationId: string): Promise<{ id: string }>;
  assignDealer(session: SessionIdentity, groupId: string, dealerCode: string, isMainDealer: boolean, correlationId: string): Promise<{ dealerId: string }>;
  listPendingRequests(session: SessionIdentity): Promise<AdminMembershipRequestRow[]>;
  approveRequest(session: SessionIdentity, requestId: string, correlationId: string): Promise<{ dealerId: string; groupId: string }>;
  rejectRequest(session: SessionIdentity, requestId: string, notes: string, correlationId: string): Promise<void>;
  /** Phase 4's checkout calls this. Returns the partner set proven against the
   *  database, or throws -- never echoes back what the caller supplied. */
  resolveOrderPartners(session: SessionIdentity, selection: OrderPartnerSelection): Promise<ResolvedOrderPartners>;
}

const groupCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/, "Use letters, numbers and underscores only, 2-40 characters");
const groupNameSchema = z.string().trim().min(2).max(120);
const dealerCodeSchema = z.string().trim().min(1).max(40);
const notesSchema = z.string().trim().min(3).max(500);

const requestMembershipSchema = z.object({ groupCode: groupCodeSchema }).strict();
const createGroupSchema = z.object({ groupCode: groupCodeSchema, groupName: groupNameSchema }).strict();
// dealerCode, not dealerId: parseBody rejects a top-level `dealerId` outright
// (shared.ts FORBIDDEN_FIELDS), so the dealer is named by its org-unique code and
// resolved to a row server-side -- which is what this whole feature is about anyway.
const assignDealerSchema = z.object({ dealerCode: dealerCodeSchema, isMainDealer: z.boolean().optional() }).strict();
const rejectSchema = z.object({ notes: notesSchema }).strict();

export function registerDealerGroupRoutes(app: Hono<{ Variables: AuthVariables }>, store?: DealerGroupsStore): void {
  if (!store) return;

  app.get("/api/dealer/group", async (context) => context.json(await store.groupForDealer(context.get("session"))));

  app.get("/api/dealer/group/requests", async (context) =>
    context.json({ requests: await store.listOwnRequests(context.get("session")) }));

  app.post("/api/dealer/group/requests", async (context) => {
    const input = await parseBody(context, requestMembershipSchema);
    const request = await store.requestMembership(context.get("session"), input.groupCode, context.get("correlationId"));
    return context.json(request, 201);
  });

  app.get("/api/admin/dealer-groups", async (context) => context.json({ groups: await store.listGroups(context.get("session")) }));

  app.post("/api/admin/dealer-groups", async (context) => {
    const input = await parseBody(context, createGroupSchema);
    const result = await store.createGroup(context.get("session"), input.groupCode, input.groupName, context.get("correlationId"));
    return context.json(result, 201);
  });

  // The literal /requests routes must precede /:groupId/dealers: Hono matches in
  // registration order and :groupId would otherwise swallow "requests" (same hazard
  // documented in app.ts for /api/orders/:orderId vs /api/orders/export-*.csv).
  app.get("/api/admin/dealer-groups/requests", async (context) =>
    context.json({ requests: await store.listPendingRequests(context.get("session")) }));

  app.post("/api/admin/dealer-groups/requests/:requestId/approve", async (context) => {
    const result = await store.approveRequest(context.get("session"), context.req.param("requestId"), context.get("correlationId"));
    return context.json(result);
  });

  app.post("/api/admin/dealer-groups/requests/:requestId/reject", async (context) => {
    const input = await parseBody(context, rejectSchema);
    await store.rejectRequest(context.get("session"), context.req.param("requestId"), input.notes, context.get("correlationId"));
    return context.json({ ok: true });
  });

  app.post("/api/admin/dealer-groups/:groupId/dealers", async (context) => {
    const input = await parseBody(context, assignDealerSchema);
    const result = await store.assignDealer(
      context.get("session"),
      context.req.param("groupId"),
      input.dealerCode,
      input.isMainDealer ?? false,
      context.get("correlationId"),
    );
    return context.json(result, 201);
  });
}
