// each preset is a bundle: the ghostty canvas palette, the cockpit accent, a
// glass tint, a font, and which crt toys are on. the store merges a preset with
// user overrides into a ResolvedTheme that the canvas + the whole HUD read from.

export type Vibrancy = "acrylic" | "blur" | "none";
export type CursorStyle = "block" | "bar" | "underline";

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
  cursorStyle: CursorStyle;
  vibrancy: Vibrancy;
  tintRgb: string; // "r, g, b" for the .terminal-inner frost
  tintAlpha: number;
  accentRgb: string; // "r, g, b" - the cockpit's whole color story
  effects: Effects;
  ghostty: GhosttyTheme;
}

export const PRESETS: Preset[] = [
  {
    id: "kurolink",
    name: "kurolink",
    blurb: "glass cockpit, neon brights, default lock-on",
    fontFamily: "Geist Mono",
    fontSize: 14,
    cursorStyle: "block",
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
  {
    id: "ink",
    name: "ink",
    blurb: "warm, soft, low contrast. reading mode",
    fontFamily: "IBM Plex Mono",
    fontSize: 15,
    cursorStyle: "bar",
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
    id: "phosphor",
    name: "phosphor",
    blurb: "crt bloom, scanlines, green-cyan glass",
    fontFamily: "Fira Code",
    fontSize: 14,
    cursorStyle: "block",
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
    id: "catppuccin-mocha",
    name: "catppuccin mocha",
    blurb: "pastel dark mode, soft but still readable",
    fontFamily: "JetBrains Mono",
    fontSize: 14,
    cursorStyle: "underline",
    vibrancy: "acrylic",
    tintRgb: "30, 30, 46",
    tintAlpha: 0.82,
    accentRgb: "137, 220, 235",
    effects: { scanlines: false, vignette: true, glow: true },
    ghostty: palette({
      bg: "#1e1e2e", fg: "#cdd6f4", cursor: "#89dceb", black: "#45475a",
      red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa",
      magenta: "#cba6f7", cyan: "#94e2d5", white: "#cdd6f4",
    }),
  },
  {
    id: "monokai",
    name: "monokai",
    blurb: "high-energy editor classic, loud in the useful way",
    fontFamily: "JetBrains Mono",
    fontSize: 14,
    cursorStyle: "bar",
    vibrancy: "none",
    tintRgb: "39, 40, 34",
    tintAlpha: 0.9,
    accentRgb: "102, 217, 239",
    effects: { scanlines: false, vignette: false, glow: false },
    ghostty: palette({
      bg: "#272822", fg: "#f8f8f2", cursor: "#66d9ef", black: "#49483e",
      red: "#f92672", green: "#a6e22e", yellow: "#e6db74", blue: "#66d9ef",
      magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
    }),
  },
  {
    id: "dracula",
    name: "dracula",
    blurb: "violet cockpit, candy ANSI, strong personality",
    fontFamily: "Fira Code",
    fontSize: 14,
    cursorStyle: "block",
    vibrancy: "acrylic",
    tintRgb: "40, 42, 54",
    tintAlpha: 0.88,
    accentRgb: "189, 147, 249",
    effects: { scanlines: false, vignette: true, glow: true },
    ghostty: palette({
      bg: "#282a36", fg: "#f8f8f2", cursor: "#bd93f9", black: "#6272a4",
      red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#8be9fd",
      magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
    }),
  },
  {
    id: "nord",
    name: "nord",
    blurb: "cold, restrained, readable arctic console",
    fontFamily: "IBM Plex Mono",
    fontSize: 14,
    cursorStyle: "underline",
    vibrancy: "none",
    tintRgb: "46, 52, 64",
    tintAlpha: 0.92,
    accentRgb: "136, 192, 208",
    effects: { scanlines: false, vignette: true, glow: false },
    ghostty: palette({
      bg: "#2e3440", fg: "#d8dee9", cursor: "#88c0d0", black: "#4c566a",
      red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1",
      magenta: "#b48ead", cyan: "#8fbcbb", white: "#d8dee9",
    }),
  },
  {
    id: "gruvbox-dark",
    name: "gruvbox dark",
    blurb: "warm retro shell energy, earthy and kind",
    fontFamily: "JetBrains Mono",
    fontSize: 14,
    cursorStyle: "block",
    vibrancy: "none",
    tintRgb: "40, 40, 40",
    tintAlpha: 0.94,
    accentRgb: "254, 128, 25",
    effects: { scanlines: false, vignette: false, glow: false },
    ghostty: palette({
      bg: "#282828", fg: "#ebdbb2", cursor: "#fe8019", black: "#665c54",
      red: "#fb4934", green: "#b8bb26", yellow: "#fabd2f", blue: "#83a598",
      magenta: "#d3869b", cyan: "#8ec07c", white: "#ebdbb2",
    }),
  },
];

export const DEFAULT_PRESET_ID = "kurolink";

const PRESET_ALIASES: Record<string, string> = {
  fusion: "kurolink",
};

export const FONT_OPTIONS = [
  "Geist Mono",
  "JetBrains Mono",
  "Fira Code",
  "IBM Plex Mono",
  "Martian Mono",
] as const;

export const CURSOR_STYLE_OPTIONS: { id: CursorStyle; label: string }[] = [
  { id: "block", label: "BLOCK" },
  { id: "bar", label: "BAR" },
  { id: "underline", label: "LINE" },
];

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
  cursorStyle?: CursorStyle;
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
  cursorStyle: CursorStyle;
  vibrancy: Vibrancy;
  tint: string; // rgba(...) for --term-tint
  tintRgb: string;
  tintAlpha: number;
  accentRgb: string;
  effects: Effects;
  ghostty: GhosttyTheme;
}

export function normalizePresetId(id: string): string {
  return PRESET_ALIASES[id] ?? id;
}

export function presetById(id: string): Preset {
  const normalized = normalizePresetId(id);
  return PRESETS.find((p) => p.id === normalized) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
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
    cursorStyle: o.cursorStyle ?? preset.cursorStyle,
    vibrancy: o.vibrancy ?? preset.vibrancy,
    tint: `rgba(${preset.tintRgb}, ${tintAlpha})`,
    tintRgb: preset.tintRgb,
    tintAlpha,
    accentRgb,
    effects,
    ghostty,
  };
}
