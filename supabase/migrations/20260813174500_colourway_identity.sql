-- One source article can legitimately have multiple colourways (for example,
-- Lee Cooper continuation-colour rows). Preserve each exact colour identity.
alter table public.product_colourways
  drop constraint product_colourways_organisation_id_article_no_key;

alter table public.product_colourways
  add constraint product_colourways_organisation_article_colour_key
  unique nulls not distinct (organisation_id, article_no, colour);
