-- Two catalogue defects found during the pilot, both in size assignment.
--
-- 1. The Reebok buy-form parser (src/imports/reebok.ts) hard-codes the columns
--    it reads as 7..12, so REEBOK_7_12 was created without a '13' even though
--    Reebok sells it. Every Reebok colourway was silently missing a sellable
--    size, and a dealer had no way to order it.
-- 2. The Nike item master does carry 5..13 for men's, and the import enabled
--    the whole span. KITCO only sells men's 7..13, so sizes 5 and 6 were being
--    offered to dealers and could not be fulfilled. Nike unisex genuinely runs
--    5..13 and is left alone; Nike apparel on NIKE_ALPHA (S/M/L) is untouched.
--
-- This is a data repair of rows the catalogue import already wrote, not a
-- schema change. It is written so that a database with no catalogue loaded yet
-- is a clean no-op, and so that re-running it against a repaired database
-- changes nothing.

-- 1. Give REEBOK_7_12 the missing '13' (sort_order 6, after '12').
insert into public.size_values (organisation_id, size_set_id, label, sort_order)
select ss.organisation_id, ss.id, '13', 6
from public.size_sets ss
where ss.code = 'REEBOK_7_12'
on conflict (size_set_id, label) do nothing;

-- 2. Enable it on every colourway already assigned to that size set. Membership
--    of a size set is only expressed through product_size_values, so the set of
--    affected colourways is derived from their existing 7..12 rows.
insert into public.product_size_values (organisation_id, product_colourway_id, size_value_id, enabled)
select distinct existing.organisation_id, existing.product_colourway_id, new_size.id, true
from public.product_size_values existing
join public.size_values sibling on sibling.id = existing.size_value_id
join public.size_sets ss on ss.id = sibling.size_set_id and ss.code = 'REEBOK_7_12'
join public.size_values new_size on new_size.size_set_id = ss.id and new_size.label = '13'
on conflict (product_colourway_id, size_value_id) do nothing;

-- 3. Correct the Nike men's enabled range to 7..13. Stated as the full range
--    rather than "disable 5 and 6" so the migration converges on the intended
--    state from either direction; the trailing enabled <> ... predicate keeps a
--    re-run from touching a single row.
update public.product_size_values psv
set enabled = (sv.label in ('7', '8', '9', '10', '11', '12', '13'))
from public.size_values sv
join public.size_sets ss on ss.id = sv.size_set_id
where sv.id = psv.size_value_id
  and ss.code = 'NIKE_WHOLE'
  and exists (
    select 1
    from public.product_colourways pc
    join public.product_families pf on pf.id = pc.product_family_id
    join public.brands b on b.id = pf.brand_id
    where pc.id = psv.product_colourway_id
      and b.code = 'NIKE'
      and pf.gender = 'MENS'
  )
  and psv.enabled <> (sv.label in ('7', '8', '9', '10', '11', '12', '13'));
