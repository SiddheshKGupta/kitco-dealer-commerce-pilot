import { describe, expect, it } from "vitest";
import sql from "../../supabase/migrations/20260813184500_admin_fulfilment_rpc.sql?raw";

describe("atomic admin fulfilment functions", () => {
  it("approves orders without mutating immutable versions and records status evidence", () => {
    expect(sql).toMatch(/create or replace function public\.approve_kitco_order/i);
    expect(sql).toMatch(/app_role\s*=\s*'ADMIN'/i);
    expect(sql).toMatch(/update public\.orders[\s\S]*status\s*=\s*'APPROVED'/i);
    expect(sql).not.toMatch(/update public\.order_versions/i);
    expect(sql).toMatch(/insert into public\.order_status_history/i);
    expect(sql).toMatch(/event_type[\s\S]*'ORDER_APPROVED'/i);
  });

  it("prevents holds and dispatches from exceeding approved pending pairs", () => {
    expect(sql).toMatch(/create or replace function public\.apply_kitco_credit_hold/i);
    expect(sql).toMatch(/create or replace function public\.create_kitco_dispatch/i);
    expect(sql).toMatch(/dispatch_status\s*=\s*'FINALISED'/i);
    expect(sql).toMatch(/hold_status\s*=\s*'ACTIVE'/i);
    expect(sql).toMatch(/v_approved_pairs\s*-\s*v_dispatched_pairs\s*-\s*v_held_pairs/i);
    expect(sql).toMatch(/dispatch exceeds available pending quantity/i);
    expect(sql).toMatch(/hold exceeds available pending quantity/i);
  });

  it("makes every function service-role-only", () => {
    for (const name of ["approve_kitco_order", "apply_kitco_credit_hold", "create_kitco_dispatch"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}[\\s\\S]*from public, anon, authenticated`, "i"));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to service_role`, "i"));
    }
  });
});
