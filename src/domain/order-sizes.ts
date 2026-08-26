/** Size x quantity: one shared formatter (V5_PRODUCT_SPEC.md §4).
 *
 *  Every surface that renders sizes to a human -- dealer order cards, admin review
 *  tiles, lifecycle emails -- calls this instead of hand-rolling its own
 *  `${size}x${qty}` join. Three near-identical implementations is how those drift.
 *
 *  CSV exports are explicitly out of scope (decision B10): they keep their existing
 *  shapes (a `Size` column, or wide one-column-per-size), never this parenthesised form.
 */

/** "(8 x 10), (9 x 5), (10 x 5)" -- zero-quantity sizes are dropped, never shown as (8 x 0). */
export function formatSizeQuantities(quantities: Readonly<Record<string, number>>): string {
  return Object.entries(quantities)
    .filter(([, pairs]) => pairs > 0)
    .map(([size, pairs]) => `(${size} x ${pairs})`)
    .join(", ");
}

/** Size System is never optional (V5_PRODUCT_SPEC.md §4): a dealer must never see a bare
 *  numeric size, because a US 9, a UK 9 and an EU 9 are three different shoes. Every
 *  size_set lacks a confirmed size_system_id today (the migration only added the column),
 *  so this degrades to an honest "Not confirmed" rather than fabricating a system or
 *  blocking checkout on data that doesn't exist yet. */
export function sizeSystemDisplayLabel(label: string | null | undefined): string {
  const trimmed = label?.trim();
  return trimmed ? trimmed : "Not confirmed";
}
