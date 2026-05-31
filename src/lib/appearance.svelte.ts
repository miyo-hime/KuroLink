import {
  resolveTheme,
  DEFAULT_PRESET_ID,
  normalizePresetId,
  type StoredAppearance,
  type ThemeOverrides,
  type ResolvedTheme,
} from "./themes";
import { getAppearance, saveAppearance, setWindowVibrancy } from "./ipc";

function mergeOverrides(base: ThemeOverrides, patch: ThemeOverrides): ThemeOverrides {
  return {
    ...base,
    ...patch,
    effects: { ...(base.effects ?? {}), ...(patch.effects ?? {}) },
    colors: { ...(base.colors ?? {}), ...(patch.colors ?? {}) },
  };
}

// one var to rule the cockpit. everything cyan downstream is rgba(var(--accent-rgb))
// or rgb(var(--accent-rgb)), so writing this retints the entire HUD. the terminal
// frost tint goes global too so TerminalPanel's scoped css can read it.
function applyCockpit(a: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const r = document.documentElement.style;
  r.setProperty("--accent-rgb", a.accentRgb);
  r.setProperty("--term-tint", a.tint);
}

class AppearanceStore {
  presetId = $state(DEFAULT_PRESET_ID);
  overrides = $state<ThemeOverrides>({});
  settingsOpen = $state(false);
  loaded = $state(false);

  #lastVibrancy = "";
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  get active(): ResolvedTheme {
    return resolveTheme({ presetId: this.presetId, overrides: this.overrides });
  }

  async load() {
    try {
      const stored = (await getAppearance()) as StoredAppearance | null;
      if (stored?.presetId) {
        this.presetId = normalizePresetId(stored.presetId);
        this.overrides = stored.overrides ?? {};
      }
    } catch {
      // no saved appearance, the default preset stands
    }
    this.loaded = true;
    const a = this.active;
    applyCockpit(a);
    this.#lastVibrancy = a.vibrancy;
    setWindowVibrancy(a.vibrancy).catch(() => {});
  }

  openSettings() {
    this.settingsOpen = true;
  }
  closeSettings() {
    this.settingsOpen = false;
  }

  // a preset is a fresh starting point, so picking one wipes prior tweaks
  selectPreset(id: string) {
    this.presetId = normalizePresetId(id);
    this.overrides = {};
    this.#afterChange();
  }

  setOverride(patch: ThemeOverrides) {
    this.overrides = mergeOverrides(this.overrides, patch);
    this.#afterChange();
  }

  resetOverrides() {
    this.overrides = {};
    this.#afterChange();
  }

  #afterChange() {
    const a = this.active;
    applyCockpit(a);
    if (a.vibrancy !== this.#lastVibrancy) {
      this.#lastVibrancy = a.vibrancy;
      setWindowVibrancy(a.vibrancy).catch(() => {});
    }
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      saveAppearance({ presetId: this.presetId, overrides: this.overrides }).catch(() => {});
    }, 250);
  }
}

export const appearance = new AppearanceStore();
