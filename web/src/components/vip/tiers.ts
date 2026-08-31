import type { VipTier } from "@/lib/types";

export interface TierConfig {
  emoji: string;
  label: string;
  word: string;
  /** Particle + glow color, as an [r, g, b] triple for canvas rgba() strings. */
  colorRgb: [number, number, number];
  glowCss: string;
}

// Each tier gets its own emoji, reveal word, and particle color. Only
// 'billete' is implemented — 'diamante' (🔴 red diamond, $10) and 'sello'
// (⚫ black wax seal, $15) plug into this same map when they're built, and
// VipRevealCanvas already reads everything it needs from here.
export const TIERS: Record<VipTier, TierConfig> = {
  billete: {
    emoji: "💵",
    label: "Billete dorado",
    word: "VIP",
    colorRgb: [255, 205, 70],
    glowCss: "rgba(255, 205, 70, 0.55)",
  },
};
