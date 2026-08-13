export type DealerRoute = "products" | "orders" | "reports";

export const dealerNavigation: ReadonlyArray<{ label: string; route: DealerRoute }> = [
  { label: "Products", route: "products" },
  { label: "Orders", route: "orders" },
  { label: "Reports", route: "reports" }
];

export function routeHref(route: DealerRoute): string {
  return `/${route}`;
}
