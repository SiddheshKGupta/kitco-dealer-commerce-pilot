import { describe, expect, it } from "vitest";

import migrationSql from "../../supabase/migrations/20260813160000_kitco_core.sql?raw";

const requiredTables = [
  "organisations",
  "dealers",
  "app_users",
  "dealer_source_records",
  "dealer_gst_registrations",
  "dealer_locations",
  "dealer_seller_mappings",
  "brands",
  "product_families",
  "product_colourways",
  "size_sets",
  "size_values",
  "product_size_values",
  "product_media",
  "commercial_offerings",
  "seasons",
  "delivery_windows",
  "source_files",
  "import_profiles",
  "catalogue_import_jobs",
  "catalogue_import_rows",
  "master_source_links",
  "stock_snapshots",
  "stock_snapshot_lines",
  "schemes",
  "scheme_targets",
  "scheme_audiences",
  "scheme_rules",
  "draft_orders",
  "draft_order_lines",
  "draft_order_line_sizes",
  "draft_delivery_allocations",
  "orders",
  "order_versions",
  "order_lines",
  "order_line_sizes",
  "order_delivery_allocations",
  "order_status_history",
  "dispatches",
  "dispatch_lines",
  "holds",
  "hold_allocations",
  "cancellation_requests",
  "otp_challenges",
  "audit_events",
  "export_jobs"
] as const;

describe("KITCO core migration", () => {
  it("creates every minimum connected commerce table", () => {
    for (const table of requiredTables) {
      expect(migrationSql).toMatch(
        new RegExp(`create table public\\.${table}\\s*\\(`, "i")
      );
    }
  });

  it("uses timezone-aware timestamps and integer minor-unit money", () => {
    expect(migrationSql).not.toMatch(/\btimestamp\s+(?!with time zone)/i);
    expect(migrationSql).not.toMatch(/\b(?:money|real|double precision)\b/i);
    expect(migrationSql).toMatch(/mrp_minor\s+bigint/i);
    expect(migrationSql).toMatch(/retail_value_minor\s+bigint/i);
  });

  it("indexes organisation, dealer, and auth ownership predicates", () => {
    expect(migrationSql).toMatch(/create index app_users_auth_user_id_idx/i);
    expect(migrationSql).toMatch(/create index app_users_dealer_id_idx/i);
    expect(migrationSql).toMatch(/create index orders_dealer_id_idx/i);
    expect(migrationSql).toMatch(/create index orders_organisation_id_idx/i);
  });
});

