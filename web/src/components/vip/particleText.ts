export interface TextPoint {
  x: number;
  y: number;
}

interface SampleOptions {
  fontPx: number;
  fontFamily?: string;
  maxPoints?: number;
}

/**
 * Renders `text` onto an offscreen canvas and samples the pixels it covers,
 * returning points centered on (0, 0). Callers offset these onto whatever
 * on-screen position they want the text to form at.
 *
 * Pure canvas logic with no React/animation concerns, so it can be swapped
 * or unit-tested independently of VipRevealCanvas.
 */
export function sampleTextPoints(text: string, opts: SampleOptions): TextPoint[] {
  const { fontPx, fontFamily = '"Playfair Display", Georgia, serif', maxPoints = 320 } = opts;

  const width = Math.ceil(fontPx * text.length * 0.85) + fontPx;
  const height = Math.ceil(fontPx * 1.6);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  ctx.fillStyle = "#fff";
  ctx.font = `700 ${fontPx}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);

  const { data } = ctx.getImageData(0, 0, width, height);
  const step = 3;
  const candidates: TextPoint[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 128) candidates.push({ x: x - width / 2, y: y - height / 2 });
    }
  }

  if (candidates.length <= maxPoints) return candidates;

  const stride = candidates.length / maxPoints;
  const picked: TextPoint[] = [];
  for (let i = 0; i < maxPoints; i++) picked.push(candidates[Math.floor(i * stride)]);
  return picked;
}
