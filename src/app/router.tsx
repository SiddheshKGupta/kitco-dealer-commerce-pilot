export type DealerRoute = "products" | "cart" | "orders" | "reports" | "profile";

export const dealerNavigation: ReadonlyArray<{ label: string; route: DealerRoute }> = [
  { label: "Products", route: "products" },
  { label: "Cart", route: "cart" },
  { label: "Orders", route: "orders" },
  { label: "Reports", route: "reports" },
  { label: "Profile", route: "profile" }
];

export function routeHref(route: DealerRoute): string {
  return `/${route}`;
}
