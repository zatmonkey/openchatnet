"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { usagePage } from "@/lib/usage-pages";

export function UsageBeacon() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    const page = usagePage(pathname);
    if (
      !page ||
      navigator.doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl
    )
      return;
    void fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);
  return null;
}
