import { describe, expect, it } from "vitest";
import sql from "../../supabase/migrations/20260813183000_atomic_order_submission.sql?raw";

describe("atomic production order submission", () => {
  it("revalidates OTP scope, current offering state and quantities inside one transaction", () => {
    expect(sql).toMatch(/create or replace function public\.submit_kitco_order/i);
    expect(sql).toMatch(/purpose\s*=\s*'ORDER_SUBMISSION'/i);
    expect(sql).toMatch(/consumed_at\s+is\s+not\s+null/i);
    expect(sql).toMatch(/published_at\s+is\s+not\s+null/i);
    expect(sql).toMatch(/order_multiple/i);
    expect(sql).toMatch(/product_size_values/i);
  });

  it("is callable only by the server role and records immutable evidence", () => {
    expect(sql).toMatch(/revoke all on function public\.submit_kitco_order[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.submit_kitco_order[\s\S]*to service_role/i);
    expect(sql).toMatch(/insert into public\.audit_events/i);
    expect(sql).toMatch(/insert into public\.order_versions/i);
  });
});
