// the seven directions from terminal-mockup.html, made real. each preset is a
// bundle: the ghostty canvas palette, the cockpit accent, a glass tint, a font,
// and which crt toys are on. the store merges a preset with user overrides into
// a ResolvedTheme that the canvas + the whole HUD read from.

export type Vibrancy = "acrylic" | "blur" | "none";

export interface Effects {
  scanlines: boolean;
  vignette: boolean;
  glow: boolean;
}

// matches the ITheme shape ghostty-web wants, no more no less
export interface GhosttyTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

interface PaletteSpec {
  bg: string; // nominal dark, used for cursorAccent + selection text only
  fg: string;
  cursor: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
}

// the canvas is always transparent - the .terminal-inner tint is what you see, so
// the glass patch's clearRect stays happy. selection swaps to the accent (no alpha,
// ghostty solid-swaps it), text inverts to the nominal bg. locked-on look.
function palette(p: PaletteSpec): GhosttyTheme {
  return {
    background: "rgba(0, 0, 0, 0)",
    foreground: p.fg,
    cursor: p.cursor,
    cursorAccent: p.bg,
    selectionBackground: p.cursor,
    selectionForeground: p.bg,
    black: p.black,
    red: p.red,
    green: p.green,
    yellow: p.yellow,
    blue: p.blue,
    magenta: p.magenta,
    cyan: p.cyan,
    white: p.white,
    brightBlack: p.black,
    brightRed: p.red,
    brightGreen: p.green,
    brightYellow: p.yellow,
    brightBlue: p.blue,
    brightMagenta: p.magenta,
    brightCyan: p.cyan,
    brightWhite: p.white,
  };
}

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  fontFamily: string; // bare family, resolve() wraps it in the fallback stack
  fontSize: number;
  vibrancy: Vibrancy;
  tintRgb: string; // "r, g, b" for the .terminal-inner frost
  tintAlpha: number;
  accentRgb: string; // "r, g, b" - the cockpit's whole color story
  effects: Effects;
  ghostty: GhosttyTheme;
}

export const PRESETS: Preset[] = [
  {
    id: "baseline",
    name: "baseline",
    blurb: "what shipped first. flat, dense, honest",
    fontFamily: "JetBrains Mono",
    fontSize: 14,
    vibrancy: "none",
    tintRgb: "6, 6, 12",
    tintAlpha: 1,
    accentRgb: "0, 212, 255",
    effects: { scanlines: false, vignette: false, glow: false },
    ghostty: palette({
      bg: "#06060c", fg: "#d8d8e4", cursor: "#00d4ff", black: "#4a4a64",
      red: "#e8254e", green: "#8ccc26", yellow: "#e8a800", blue: "#00a0ff",
      magenta: "#c850c0", cyan: "#00d4ff", white: "#d8d8e4",
    }),
  },
  {
    id: "hud",
    name: "hud nominal",
    blurb: "the loosened, padded refit. brighter cyan",
    fontFamily: "JetBrains Mono",
    fontSize: 14,
    vibrancy: "none",
    tintRgb: "10, 10, 20",
    tintAlpha: 1,
    accentRgb: "63, 220, 255",
    effects: { scanlines: false, vignette: true, glow: false },
    ghostty: palette({
      bg: "#050509", fg: "#dadae6", cursor: "#3fdcff", black: "#5a5a78",
      red: "#ff4a6e", green: "#9be84a", yellow: "#ffc24a", blue: "#40b8ff",
      magenta: "#e070e0", cyan: "#3fdcff", white: "#dadae6",
    }),
  },
  {
    id: "phosphor",
    name: "phosphor",
    blurb: "crt bloom, scanlines, green-cyan glass",
    fontFamily: "Fira Code",
    fontSize: 14,
    vibrancy: "none",
    tintRgb: "4, 8, 10",
    tintAlpha: 1,
    accentRgb: "57, 255, 224",
    effects: { scanlines: true, vignette: true, glow: true },
    ghostty: palette({
      bg: "#04080a", fg: "#79f0d8", cursor: "#39ffe0", black: "#3a6a64",
      red: "#ff6a7a", green: "#7dff8a", yellow: "#ffe07a", blue: "#6ad4ff",
      magenta: "#ff8ae0", cyan: "#39ffe0", white: "#9bffb0",
    }),
  },
  {
    id: "glass",
    name: "glass cockpit",
    blurb: "translucent, blurred, floating over acrylic",
    fontFamily: "Geist Mono",
    fontSize: 14,
    vibrancy: "acrylic",
    tintRgb: "8, 10, 22",
    tintAlpha: 0.55,
    accentRgb: "95, 224, 255",
    effects: { scanlines: false, vignette: true, glow: false },
    ghostty: palette({
      bg: "#080a16", fg: "#ececf6", cursor: "#5fe0ff", black: "#8888a8",
      red: "#ff6585", green: "#a8ee62", yellow: "#ffce5f", blue: "#62c2ff",
      magenta: "#ef88ef", cyan: "#5fe0ff", white: "#ececf6",
    }),
  },
  {
    id: "ink",
    name: "ink",
    blurb: "warm, soft, low contrast. reading mode",
    fontFamily: "IBM Plex Mono",
    fontSize: 15,
    vibrancy: "none",
    tintRgb: "12, 11, 10",
    tintAlpha: 1,
    accentRgb: "127, 200, 192",
    effects: { scanlines: false, vignette: false, glow: false },
    ghostty: palette({
      bg: "#0c0b0a", fg: "#e6e0d4", cursor: "#7fc8c0", black: "#6a6458",
      red: "#d98a8a", green: "#a8c082", yellow: "#d4b572", blue: "#8ab0cc",
      magenta: "#c89ac8", cyan: "#7fc8c0", white: "#e6e0d4",
    }),
  },
  {
    id: "neon",
    name: "neon overdrive",
    blurb: "punchy mecha instrument cluster, full glow",
    fontFamily: "Martian Mono",
    fontSize: 13,
    vibrancy: "none",
    tintRgb: "2, 2, 7",
    tintAlpha: 1,
    accentRgb: "42, 224, 255",
    effects: { scanlines: false, vignette: true, glow: true },
    ghostty: palette({
      bg: "#020207", fg: "#e8ecff", cursor: "#2ae0ff", black: "#454560",
      red: "#ff2e6e", green: "#b6ff3a", yellow: "#ffd23a", blue: "#4aa8ff",
      magenta: "#ff5ad8", cyan: "#2ae0ff", white: "#e8ecff",
    }),
  },
  {
    id: "fusion",
    name: "fusion",
    blurb: "glass cockpit + neon brights + glow. the default",
    fontFamily: "Geist Mono",
    fontSize: 14,
    vibrancy: "acrylic",
    tintRgb: "6, 6, 14",
    tintAlpha: 0.62,
    accentRgb: "42, 224, 255",
    effects: { scanlines: true, vignette: true, glow: true },
    ghostty: palette({
      bg: "#06060c", fg: "#eef0fb", cursor: "#2ae0ff", black: "#5a5a78",
      red: "#ff2e6e", green: "#b6ff3a", yellow: "#ffd23a", blue: "#4aa8ff",
      magenta: "#ff5ad8", cyan: "#2ae0ff", white: "#eef0fb",
    }),
  },
];

export const DEFAULT_PRESET_ID = "fusion";

export const FONT_OPTIONS = [
  "Geist Mono",
  "JetBrains Mono",
  "Fira Code",
  "IBM Plex Mono",
  "Martian Mono",
] as const;

// nerd-font + generic fallbacks ride behind every choice so glyphs/icons survive
export function fontStack(family: string): string {
  return `"${family}", "JetBrainsMono Nerd Font", "CaskaydiaCove Nerd Font", "FiraCode Nerd Font", "Cascadia Code", monospace`;
}

// the editable ansi slots the settings panel exposes as swatches
export type ColorKey =
  | "foreground"
  | "cursor"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan";

export interface ThemeOverrides {
  fontFamily?: string;
  fontSize?: number;
  vibrancy?: Vibrancy;
  tintAlpha?: number;
  accentRgb?: string;
  effects?: Partial<Effects>;
  colors?: Partial<Record<ColorKey, string>>;
}

export interface StoredAppearance {
  presetId: string;
  overrides: ThemeOverrides;
}

export interface ResolvedTheme {
  presetId: string;
  fontFamily: string; // bare family (for the dropdown's current value)
  fontStack: string; // full css stack (for actual rendering)
  fontSize: number;
  vibrancy: Vibrancy;
  tint: string; // rgba(...) for --term-tint
  tintRgb: string;
  tintAlpha: number;
  accentRgb: string;
  effects: Effects;
  ghostty: GhosttyTheme;
}

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
}

export function resolveTheme(stored: StoredAppearance): ResolvedTheme {
  const preset = presetById(stored.presetId);
  const o = stored.overrides ?? {};

  const fontFamily = o.fontFamily ?? preset.fontFamily;
  const tintAlpha = o.tintAlpha ?? preset.tintAlpha;
  const accentRgb = o.accentRgb ?? preset.accentRgb;
  const effects: Effects = { ...preset.effects, ...(o.effects ?? {}) };

  const ghostty: GhosttyTheme = { ...preset.ghostty };
  if (o.colors) {
    for (const [k, v] of Object.entries(o.colors)) {
      if (!v) continue;
      if (k === "cursor") {
        ghostty.cursor = v;
        ghostty.selectionBackground = v;
      } else if (k === "foreground") {
        ghostty.foreground = v;
        ghostty.white = v;
      } else {
        // a normal ansi slot, brights track it
        (ghostty as unknown as Record<string, string>)[k] = v;
        (ghostty as unknown as Record<string, string>)[
          "bright" + k.charAt(0).toUpperCase() + k.slice(1)
        ] = v;
      }
    }
  }

  return {
    presetId: preset.id,
    fontFamily,
    fontStack: fontStack(fontFamily),
    fontSize: o.fontSize ?? preset.fontSize,
    vibrancy: o.vibrancy ?? preset.vibrancy,
    tint: `rgba(${preset.tintRgb}, ${tintAlpha})`,
    tintRgb: preset.tintRgb,
    tintAlpha,
    accentRgb,
    effects,
    ghostty,
  };
}
