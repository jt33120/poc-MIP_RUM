"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Effet « live » : re-fetch des server components toutes les 5 s (PLAN §9.2). */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
