import type { Link, Profile } from "./types";

// Server-only: reads the existing Express API (routes/public.js) that already
// backs the vanilla profile page. This app doesn't own the data — it's a new
// frontend for the same SQLite-backed profiles.
const API_BASE = process.env.EXPRESS_API_URL || "http://localhost:3000";

export async function getProfile(slug: string): Promise<Profile | null> {
  const res = await fetch(`${API_BASE}/api/public/${encodeURIComponent(slug)}/profile`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export async function getLinks(slug: string): Promise<Link[]> {
  const res = await fetch(`${API_BASE}/api/public/${encodeURIComponent(slug)}/links`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Profile/link image paths (e.g. "/uploads/abc.png") come back relative to
 * the Express server, not this Next app's own origin — point them at the
 * API host so the browser can actually load them.
 */
export function resolveAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path}`;
}
