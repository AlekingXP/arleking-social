// VIP tiers that exist today, each backed by a real Stripe subscription
// Price (see routes/stripe.js in the Express app). Reserved for later:
// 'diamante' ($10, blood-red diamond) and 'sello' ($15, black wax seal).
export type VipTier = "billete" | "king";

export interface Profile {
  user_id: number;
  slug: string;
  name: string;
  tagline: string;
  avatar_path: string | null;
  background_path: string | null;
  footer_text: string;
  accent_from: string;
  accent_to: string;
  vip_tier: VipTier | null;
  vip_activated_at: string | null;
}

export interface Link {
  id: number;
  user_id: number;
  order_index: number;
  type: "simple" | "featured";
  platform: string;
  label: string;
  subtitle: string | null;
  badge_left: string | null;
  badge_right: string | null;
  url: string;
  image_path: string | null;
  icon: string | null;
  enabled: number;
}
