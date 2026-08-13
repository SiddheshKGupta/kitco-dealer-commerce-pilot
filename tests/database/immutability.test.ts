import { describe, expect, it } from "vitest";

import migrationSql from "../../supabase/migrations/20260813160000_kitco_core.sql?raw";

describe("immutable evidence", () => {
  it("rejects updates and deletes for submitted order version data", () => {
    expect(migrationSql).toMatch(
      /create trigger order_versions_immutable[\s\S]*?before update or delete on public\.order_versions/i
    );
    expect(migrationSql).toMatch(
      /create trigger order_lines_immutable[\s\S]*?before update or delete on public\.order_lines/i
    );
    expect(migrationSql).toMatch(
      /create trigger order_line_sizes_immutable[\s\S]*?before update or delete on public\.order_line_sizes/i
    );
  });

  it("makes audit events append-only and unavailable for direct client inserts", () => {
    expect(migrationSql).toMatch(
      /create trigger audit_events_append_only[\s\S]*?before update or delete on public\.audit_events/i
    );
    expect(migrationSql).not.toMatch(
      /create policy audit_events\w*_insert[\s\S]*?to authenticated/i
    );
    expect(migrationSql).toMatch(/revoke insert, update, delete on public\.audit_events from anon, authenticated/i);
  });
});

