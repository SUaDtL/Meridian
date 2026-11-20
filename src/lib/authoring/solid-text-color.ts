export type Rgb = readonly [number, number, number];
export type SrgbPaint = { channels: Rgb; opacity: number };
export type SolidTextPaint = { text: SrgbPaint; backing: Rgb; bold: boolean };

/** Preserve fractional computed sRGB channels. Other color spaces require separate evidence. */
export function readSrgbPaint(value: string): SrgbPaint | undefined {
  const color = value.trim().toLowerCase();
  if (color === 'transparent') return { channels: [0, 0, 0], opacity: 0 };
  if (/^#[a-f0-9]{6}$/.test(color)) {
    const channel = (index: number) => Number.parseInt(color.slice(index, index + 2), 16);
    return { channels: [channel(1), channel(3), channel(5)], opacity: 1 };
  }
  const match = /^rgba?\(\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)[, ]+\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(color);
  if (!match) return undefined;
  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  const opacity = Number(match[4] ?? '1');
  if (![red, green, blue].every(channel => channel >= 0 && channel <= 255) || !(opacity >= 0 && opacity <= 1)) return undefined;
  return { channels: [red, green, blue], opacity };
}

function luminance([red, green, blue]: Rgb) {
  const linear = (channel: number) => {
    const degree = channel / 255;
    return degree <= 0.04045 ? degree / 12.92 : ((degree + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

export function solidTextContrast({ text, backing, bold }: SolidTextPaint, pixels: number) {
  const blend = (index: 0 | 1 | 2) => text.channels[index] * text.opacity + backing[index] * (1 - text.opacity);
  const lightness = luminance([blend(0), blend(1), blend(2)]);
  const backdrop = luminance(backing);
  const ratio = (Math.max(lightness, backdrop) + 0.05) / (Math.min(lightness, backdrop) + 0.05);
  const threshold = pixels >= 24 || (bold && pixels >= 56 / 3) ? 3 : 4.5;
  return { ratio, threshold };
}
