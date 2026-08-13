import { describe, expect, it } from "vitest";

import migrationSql from "../../supabase/migrations/20260813160000_kitco_core.sql?raw";

const exposedTables = [
  ...migrationSql.matchAll(/create table public\.(\w+)\s*\(/gi)
].map((match) => match[1]);

describe("Supabase RLS boundary", () => {
  it("enables and forces RLS on every public table", () => {
    expect(exposedTables.length).toBeGreaterThan(40);

    for (const table of exposedTables) {
      expect(migrationSql).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, "i")
      );
      expect(migrationSql).toMatch(
        new RegExp(`alter table public\\.${table} force row level security`, "i")
      );
    }
  });

  it("scopes dealer reads and mutable drafts to the authenticated dealer", () => {
    expect(migrationSql).toMatch(
      /create policy orders_dealer_select[\s\S]*?to authenticated[\s\S]*?using \(\(select private\.is_current_dealer\(dealer_id, organisation_id\)\)\)/i
    );
    expect(migrationSql).toMatch(
      /create policy draft_orders_dealer_update[\s\S]*?to authenticated[\s\S]*?using \([\s\S]*?\)[\s\S]*?with check \([\s\S]*?\)/i
    );
    expect(migrationSql).not.toMatch(/to authenticated\s+(?:using|with check)\s*\(\s*true\s*\)/i);
  });

  it("keeps admin-only mutation tables without authenticated write policies", () => {
    for (const table of [
      "catalogue_import_jobs",
      "dispatches",
      "dispatch_lines",
      "holds",
      "hold_allocations"
    ]) {
      expect(migrationSql).not.toMatch(
        new RegExp(`create policy ${table}\\w*_(?:insert|update|delete)[\\s\\S]*?to authenticated`, "i")
      );
    }
  });

  it("hardens private security-definer helpers", () => {
    expect(migrationSql).toMatch(/create schema private/i);
    expect(migrationSql).toMatch(
      /create or replace function private\.is_current_dealer[\s\S]*?security definer[\s\S]*?set search_path = ''[\s\S]*?select auth\.uid\(\)/i
    );
    expect(migrationSql).toMatch(
      /revoke execute on function private\.is_current_dealer\(uuid, uuid\) from public/i
    );
  });
});

