export const usagePages = ["home", "docs", "lobby", "room"] as const;
export type UsagePage = (typeof usagePages)[number];

export function usagePage(pathname: string): UsagePage | undefined {
  if (pathname === "/") return "home";
  if (pathname === "/docs") return "docs";
  if (pathname === "/rooms") return "lobby";
  if (/^\/rooms\/[^/]+\/?$/.test(pathname)) return "room";
}
