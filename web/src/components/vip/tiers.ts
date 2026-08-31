import type { VipTier } from "@/lib/types";

export interface TierConfig {
  /** Sampled as a font glyph for the reveal's "form" phase target shape. */
  emoji: string;
  /** Custom gold-3D badge art (gradients + bevel + gloss) — what the settled badge actually shows. */
  icon: string;
  label: string;
  word: string;
  /** Particle + glow color, as an [r, g, b] triple for canvas rgba() strings. */
  colorRgb: [number, number, number];
  glowCss: string;
}

function svgToDataUri(svg: string): string {
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

const BILLETE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<defs>' +
  '<radialGradient id="g1" cx="35%" cy="30%" r="75%">' +
  '<stop offset="0%" stop-color="#fff6d6"/><stop offset="35%" stop-color="#ffd76a"/>' +
  '<stop offset="70%" stop-color="#e8a520"/><stop offset="100%" stop-color="#a9670a"/>' +
  '</radialGradient>' +
  '<linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0%" stop-color="#fff2c0"/><stop offset="50%" stop-color="#c8871a"/>' +
  '<stop offset="100%" stop-color="#6b430a"/>' +
  '</linearGradient>' +
  '</defs>' +
  '<circle cx="32" cy="34" r="28" fill="url(#g2)"/>' +
  '<circle cx="32" cy="31" r="26" fill="url(#g1)"/>' +
  '<circle cx="32" cy="31" r="26" fill="none" stroke="#8a5a10" stroke-width="1.5" opacity="0.5"/>' +
  '<text x="32" y="41" font-family="Georgia,serif" font-size="30" font-weight="700" text-anchor="middle" fill="#7a4c08" opacity="0.85">$</text>' +
  '<text x="32" y="39" font-family="Georgia,serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fffef0">$</text>' +
  '<ellipse cx="21" cy="17" rx="10" ry="5" fill="#fff" opacity="0.45"/>' +
  '</svg>';

const KING_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<defs>' +
  '<linearGradient id="g3" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0%" stop-color="#fff6d6"/><stop offset="40%" stop-color="#ffd76a"/>' +
  '<stop offset="100%" stop-color="#a9670a"/>' +
  '</linearGradient>' +
  '</defs>' +
  '<path d="M8 46 L8 26 L18 34 L26 20 L32 30 L38 20 L46 34 L56 26 L56 46 Z" fill="url(#g3)" stroke="#7a4c08" stroke-width="1.5" stroke-linejoin="round"/>' +
  '<rect x="8" y="46" width="48" height="8" rx="2" fill="url(#g3)" stroke="#7a4c08" stroke-width="1.5"/>' +
  '<circle cx="8" cy="26" r="4" fill="#fff2c0" stroke="#7a4c08" stroke-width="1"/>' +
  '<circle cx="32" cy="20" r="4.5" fill="#fff2c0" stroke="#7a4c08" stroke-width="1"/>' +
  '<circle cx="56" cy="26" r="4" fill="#fff2c0" stroke="#7a4c08" stroke-width="1"/>' +
  '<circle cx="26" cy="40" r="3" fill="#b3213f"/><circle cx="38" cy="40" r="3" fill="#1c3f91"/>' +
  '</svg>';

// Each tier gets its own icon, reveal word, and particle color. 'diamante'
// (🔴 red diamond, $10) and 'sello' (⚫ black wax seal, $15) plug into this
// same map when they're built, and VipRevealCanvas already reads everything
// it needs from here.
export const TIERS: Record<VipTier, TierConfig> = {
  billete: {
    emoji: "💵",
    icon: svgToDataUri(BILLETE_SVG),
    label: "Dollars",
    word: "VIP",
    colorRgb: [255, 205, 70],
    glowCss: "rgba(255, 205, 70, 0.55)",
  },
  king: {
    emoji: "👑",
    icon: svgToDataUri(KING_SVG),
    label: "THE KING",
    word: "KING",
    colorRgb: [255, 208, 90],
    glowCss: "rgba(255, 208, 90, 0.6)",
  },
};
