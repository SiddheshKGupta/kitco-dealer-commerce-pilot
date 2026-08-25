// Phase 2 (Add Dealer, CSV import, credential provisioning, account state machine)
// against real Postgres — real migrations, real constraints, real triggers.
//
// WHY THESE SPECIFIC PROBES
// The v4 P0 was an RPC that could not write a table it claimed to write, and 233
// mocked tests never noticed. The equivalent failure here is:
//
//   - a BEFORE UPDATE trigger on `dealers` (three tables already carry one) would
//     block every CSV update and every credential issuance, silently, in production
//   - the `account_state` check constraint refusing a state the machine can emit
//   - the composite (organisation_id, id) FKs not actually stopping a cross-tenant
//     group or GST registration from being attached
//   - `dealer_gst_registrations` NOT raising 23505 on a shared GSTIN, which is the
//     branch supabase-admin-dealers.ts deliberately tolerates
//
// None of those are observable through a mock, and three of this project's migrations
// previously existed only in the production database — so the file on disk is not
// evidence either.
//
// Everything runs inside a self-aborting DO block: the raise carries the results and
// rolls the transaction back, so live pilot data is untouched. See harness.ts.

import { beforeAll, describe, expect, it } from "vitest";
import { execSql, fields, hasCredentials, probe, SKIP_REASON, SNAPSHOT_SQL } from "./harness";

if (!hasCredentials) console.warn(`\n[tests/db] SKIPPED dealer-onboarding\n  ${SKIP_REASON}\n`);

let baseline: Record<string, unknown> = {};

beforeAll(async () => {
  if (!hasCredentials) return;
  const snapshot = await execSql(SNAPSHOT_SQL);
  expect(snapshot.ok, `could not reach the database: ${snapshot.error}`).toBe(true);
  baseline = snapshot.rows[0];
});

const ACCOUNT_STATES = [
  "IMPORTED", "CREDENTIALS_PENDING", "CREDENTIALS_ISSUED", "FIRST_LOGIN_PENDING",
  "OTP_PENDING", "PASSWORD_CHANGE_REQUIRED", "ACTIVE", "SUSPENDED", "DISABLED",
];

const DECLARE = `  v_org uuid; v_org2 uuid; v_group uuid; v_group2 uuid; v_gst uuid;
  v_dealer uuid; v_dealer2 uuid; v_state text; v_gstin text; v_suffix text;
  v_out text := '';`;

/** Scaffolding every probe below starts from: a group and a GST registration in the
 *  caller's own organisation, plus a second organisation to prove the tenant FKs. */
const SEED = `  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'PROBE >> SEED_MISSING'; end if;
  v_suffix := replace(gen_random_uuid()::text, '-', '');

  insert into public.organisations (code, name) values ('PROBE-' || v_suffix, 'Probe Org')
  returning id into v_org2;

  insert into public.dealer_groups (organisation_id, group_code, group_name)
  values (v_org, 'PROBE' || substr(v_suffix, 1, 8), 'Probe Group') returning id into v_group;
  insert into public.dealer_groups (organisation_id, group_code, group_name)
  values (v_org2, 'PROBEX' || substr(v_suffix, 1, 8), 'Other Tenant Group') returning id into v_group2;

  v_gstin := '99' || upper(substr(v_suffix, 1, 13));
  insert into public.gst_registrations (organisation_id, gstin, verification_status)
  values (v_org, v_gstin, 'UNVERIFIED') returning id into v_gst;`;

describe.skipIf(!hasCredentials)("Phase 2 dealer onboarding against real Postgres", () => {
  it("writes a dealer exactly the way the Add Dealer route does, and can update it afterwards", async () => {
    const payload = await probe(DECLARE, `${SEED}

  insert into public.dealers (organisation_id, code, name, legal_name, display_name,
      address_line1, address_line2, city, state, pin_code, contact_person, mobile,
      master_email, secondary_email, is_main_dealer, dealer_group_id, gst_registration_id,
      account_state, source_system, source_reference, last_synced_at)
  values (v_org, 'PROBE-A-' || substr(v_suffix, 1, 8), 'Probe One', 'PROBE ONE PVT LTD', 'Probe One',
      'Fraser Road', null, 'Patna', 'Bihar', '800001', 'Ramesh', '9000000001',
      'probe-a@example.invalid', null, true, v_group, v_gst,
      'IMPORTED', 'ADMIN_CONSOLE', 'probe.csv#2', now())
  returning id into v_dealer;
  v_out := v_out || 'insert=OK';

  -- The P0 shape: three tables in this schema carry BEFORE UPDATE triggers that raise
  -- 55000. If dealers ever grew one, every CSV update and every credential issuance
  -- would fail in production while the mocked suite stayed green.
  update public.dealers
     set display_name = 'Probe One Renamed', mobile = '9000000002',
         account_state = 'CREDENTIALS_ISSUED', credentials_issued_at = now(), updated_at = now()
   where id = v_dealer and organisation_id = v_org;
  select account_state into v_state from public.dealers where id = v_dealer;
  v_out := v_out || ' | update=' || coalesce(v_state, 'BLOCKED');

  -- The credential-issuance flags, on a row that already exists.
  update public.app_users set must_change_password = true, status = 'ACTIVE'
   where organisation_id = v_org and app_role = 'DEALER';
  v_out := v_out || ' | app_users_flags=OK';`);

    const result = fields(payload);
    expect(result.insert).toBe("OK");
    expect(result.update).toBe("CREDENTIALS_ISSUED");
    expect(result.app_users_flags).toBe("OK");
  });

  it("accepts every state the machine can emit and refuses one it cannot", async () => {
    const payload = await probe(DECLARE, `${SEED}

  insert into public.dealers (organisation_id, code, name, account_state)
  values (v_org, 'PROBE-B-' || substr(v_suffix, 1, 8), 'Probe Two', 'IMPORTED')
  returning id into v_dealer;

  foreach v_state in array array[${ACCOUNT_STATES.map((state) => `'${state}'`).join(", ")}]
  loop
    update public.dealers set account_state = v_state where id = v_dealer and organisation_id = v_org;
  end loop;
  v_out := v_out || 'states=ALL_ACCEPTED';

  begin
    update public.dealers set account_state = 'NOT_A_REAL_STATE' where id = v_dealer and organisation_id = v_org;
    v_out := v_out || ' | unknown_state=ACCEPTED';
  exception when check_violation then
    v_out := v_out || ' | unknown_state=REJECTED';
  end;`);

    const result = fields(payload);
    expect(result.states).toBe("ALL_ACCEPTED");
    // A constraint that let anything through would make the machine advisory only.
    expect(result.unknown_state).toBe("REJECTED");
  });

  it("lets two dealers share one GST registration, which the v4 mirror table cannot express", async () => {
    const payload = await probe(DECLARE, `${SEED}

  insert into public.dealers (organisation_id, code, name, gst_registration_id, account_state)
  values (v_org, 'PROBE-C-' || substr(v_suffix, 1, 8), 'Probe Three', v_gst, 'IMPORTED')
  returning id into v_dealer;
  insert into public.dealers (organisation_id, code, name, gst_registration_id, account_state)
  values (v_org, 'PROBE-D-' || substr(v_suffix, 1, 8), 'Probe Four', v_gst, 'IMPORTED')
  returning id into v_dealer2;
  v_out := v_out || 'shared_v5_registration=OK';

  insert into public.dealer_gst_registrations (organisation_id, dealer_id, gstin, is_primary)
  values (v_org, v_dealer, v_gstin, true);
  begin
    insert into public.dealer_gst_registrations (organisation_id, dealer_id, gstin, is_primary)
    values (v_org, v_dealer2, v_gstin, true);
    v_out := v_out || ' | v4_mirror_second_dealer=ACCEPTED';
  exception when unique_violation then
    v_out := v_out || ' | v4_mirror_second_dealer=23505';
  end;`);

    const result = fields(payload);
    expect(result.shared_v5_registration).toBe("OK");
    // This is why mirrorV4Gst() swallows 23505: unique (organisation_id, gstin) on the
    // v4 table structurally cannot hold a shared GSTIN, and failing a dealer's creation
    // over a legacy mirror row would be the tail wagging the dog.
    expect(result.v4_mirror_second_dealer).toBe("23505");
  });

  it("refuses a dealer group and a GST registration belonging to another organisation", async () => {
    const payload = await probe(DECLARE, `${SEED}

  begin
    insert into public.dealers (organisation_id, code, name, dealer_group_id, account_state)
    values (v_org, 'PROBE-E-' || substr(v_suffix, 1, 8), 'Probe Five', v_group2, 'IMPORTED');
    v_out := v_out || 'foreign_group=ACCEPTED';
  exception when foreign_key_violation then
    v_out := v_out || 'foreign_group=REJECTED';
  end;

  insert into public.gst_registrations (organisation_id, gstin, verification_status)
  values (v_org2, 'XX' || upper(substr(v_suffix, 1, 13)), 'UNVERIFIED') returning id into v_gst;
  begin
    insert into public.dealers (organisation_id, code, name, gst_registration_id, account_state)
    values (v_org, 'PROBE-F-' || substr(v_suffix, 1, 8), 'Probe Six', v_gst, 'IMPORTED');
    v_out := v_out || ' | foreign_gst=ACCEPTED';
  exception when foreign_key_violation then
    v_out := v_out || ' | foreign_gst=REJECTED';
  end;

  -- Dealer code uniqueness is per organisation, which is what makes the import's
  -- match-on-dealer_code safe: another tenant's code is a different dealer.
  begin
    insert into public.dealers (organisation_id, code, name, account_state)
    values (v_org, (select code from public.dealers where organisation_id = v_org limit 1), 'Probe Seven', 'IMPORTED');
    v_out := v_out || ' | duplicate_code=ACCEPTED';
  exception when unique_violation then
    v_out := v_out || ' | duplicate_code=23505';
  end;`);

    const result = fields(payload);
    // These composite FKs are the schema's half of the tenant boundary. The Worker's
    // .eq("organisation_id", ...) is the other half, and neither is redundant.
    expect(result.foreign_group).toBe("REJECTED");
    expect(result.foreign_gst).toBe("REJECTED");
    expect(result.duplicate_code).toBe("23505");
  });

  it("matches the row counts snapshotted at suite start", async () => {
    const after = await execSql(SNAPSHOT_SQL);
    expect(after.ok, after.error).toBe(true);
    expect(
      after.rows[0],
      "A probe COMMITTED. Live pilot data may have been modified — inspect before running anything else.",
    ).toEqual(baseline);
  });
});
