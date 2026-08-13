import { describe, expect, it } from "vitest";
import migrationSql from "../../supabase/migrations/20260813181500_relationship_rls.sql?raw";

describe("relationship-aware dealer write policies", () => {
  it("binds cancellation requests to a cancellable order owned by the current dealer", () => {
    expect(migrationSql).toMatch(/drop policy if exists cancellation_requests_dealer_insert/i);
    expect(migrationSql).toMatch(/create policy cancellation_requests_dealer_insert[\s\S]*?cancellation_requests\.status\s*=\s*'PENDING'[\s\S]*?from public\.orders o/i);
    expect(migrationSql).toMatch(/o\.id\s*=\s*cancellation_requests\.order_id[\s\S]*?o\.organisation_id\s*=\s*cancellation_requests\.organisation_id[\s\S]*?o\.dealer_id\s*=\s*cancellation_requests\.dealer_id/i);
    expect(migrationSql).toMatch(/o\.status in \('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED'\)[\s\S]*?private\.is_current_dealer\(o\.dealer_id, o\.organisation_id\)/i);
  });

  it("requires a current dealer-owned active Bill-To location on draft orders", () => {
    expect(migrationSql).toMatch(
      /create policy draft_orders_dealer_insert[\s\S]*?dealer_locations bill_to[\s\S]*?bill_to\.id\s*=\s*draft_orders\.bill_to_location_id[\s\S]*?bill_to\.organisation_id\s*=\s*draft_orders\.organisation_id[\s\S]*?bill_to\.dealer_id\s*=\s*draft_orders\.dealer_id[\s\S]*?bill_to\.location_type\s+in\s*\('BILL_TO',\s*'BOTH'\)[\s\S]*?bill_to\.active/i,
    );
    expect(migrationSql).toMatch(/create policy draft_orders_dealer_update[\s\S]*?with check[\s\S]*?dealer_locations bill_to/i);
  });

  it("accepts draft lines only for published offerings in the same organisation", () => {
    expect(migrationSql).toMatch(
      /create policy draft_order_lines_dealer_insert[\s\S]*?commercial_offerings offering[\s\S]*?offering\.id\s*=\s*draft_order_lines\.commercial_offering_id[\s\S]*?offering\.organisation_id\s*=\s*draft_order_lines\.organisation_id[\s\S]*?offering\.published_at is not null/i,
    );
    expect(migrationSql).toMatch(/create policy draft_order_lines_dealer_update[\s\S]*?with check[\s\S]*?offering\.published_at is not null/i);
  });

  it("accepts only offering-enabled sizes and same-dealer active Ship-To locations", () => {
    expect(migrationSql).toMatch(
      /create policy draft_order_line_sizes_dealer_insert[\s\S]*?product_size_values enabled_size[\s\S]*?enabled_size\.size_value_id\s*=\s*draft_order_line_sizes\.size_value_id[\s\S]*?enabled_size\.enabled/i,
    );
    expect(migrationSql).toMatch(
      /create policy draft_delivery_allocations_dealer_insert[\s\S]*?dealer_locations ship_to[\s\S]*?ship_to\.dealer_id\s*=\s*draft\.dealer_id[\s\S]*?ship_to\.location_type\s+in\s*\('SHIP_TO',\s*'BOTH'\)[\s\S]*?ship_to\.active/i,
    );
  });
});
