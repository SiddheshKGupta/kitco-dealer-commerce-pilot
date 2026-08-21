export type DealerRoute = "products" | "cart" | "orders" | "reports";

export const dealerNavigation: ReadonlyArray<{ label: string; route: DealerRoute }> = [
  { label: "Products", route: "products" },
  { label: "Cart", route: "cart" },
  { label: "Orders", route: "orders" },
  { label: "Reports", route: "reports" }
];

export function routeHref(route: DealerRoute): string {
  return `/${route}`;
}
