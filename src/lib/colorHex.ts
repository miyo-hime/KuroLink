// accents live as "r, g, b" triplets (they feed css vars); <input type=color>
// speaks hex. translate at that boundary, nowhere else.

export function rgbToHex(rgb: string): string {
  const [r, g, b] = rgb.split(",").map((s) => parseInt(s.trim(), 10));
  const h = (n: number) => (isNaN(n) ? 0 : n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
