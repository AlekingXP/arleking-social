import { useSyncExternalStore } from "react";

function storageKey(slug: string) {
  return `vip-badge-revealed:${slug}`;
}

function noopSubscribe() {
  // The flag is only ever written by this same tab (see VipBadge's
  // markRevealSeen), so there's nothing external to subscribe to.
  return () => {};
}

/**
 * Whether this browser has already seen the given profile's VIP reveal
 * animation, read from localStorage.
 *
 * Uses useSyncExternalStore instead of a useEffect+setState so the first
 * client render can safely mirror the server (getServerSnapshot -> null)
 * without a setState-during-effect render cascade or a hydration mismatch.
 */
export function useVipRevealSeen(slug: string): boolean | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => readSeen(slug),
    () => null,
  );
}

function readSeen(slug: string): boolean {
  try {
    return localStorage.getItem(storageKey(slug)) === "1";
  } catch {
    // localStorage unavailable (private mode, storage disabled) — treat as first visit.
    return false;
  }
}

export function markVipRevealSeen(slug: string) {
  try {
    localStorage.setItem(storageKey(slug), "1");
  } catch {
    // Ignore — worst case the reveal plays again on the next visit.
  }
}
