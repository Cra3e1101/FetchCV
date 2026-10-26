import "./interface-theme.css";

const KEY = "fetchcv.interface-theme";
const THEMES = ["white", "neutral-dark", "light", "dark"];
let pendingTheme;
let themeFrame = null;
let restoreFrame = null;

const normalizeTheme = value => THEMES.includes(value) ? value : "white";

export function readInterfaceTheme() {
  try { return normalizeTheme(localStorage.getItem(KEY)); } catch { return "white"; }
}

function restorePaletteTransitions() {
  if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
  restoreFrame = null;
  delete document.documentElement.dataset.interfaceThemeChanging;
}

function commitTheme(theme, switching = false) {
  const root = document.documentElement;
  const colorScheme = ["dark", "neutral-dark"].includes(theme) ? "dark" : "light";
  if (root.dataset.interfaceTheme === theme && root.dataset.colorScheme === colorScheme) return theme;
  if (switching) {
    if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
    root.dataset.interfaceThemeChanging = "";
    // Keep color tweens disabled across a painted frame. Repeated input extends
    // this window; geometric/opacity animations keep their original durations.
    restoreFrame = requestAnimationFrame(() => {
      restoreFrame = requestAnimationFrame(restorePaletteTransitions);
    });
  }
  if (root.dataset.interfaceTheme !== theme) root.dataset.interfaceTheme = theme;
  if (root.dataset.colorScheme !== colorScheme) root.dataset.colorScheme = colorScheme;
  return theme;
}

// Startup and explicit application stay synchronous and supersede queued input.
export function applyInterfaceTheme(value = readInterfaceTheme()) {
  if (themeFrame !== null) cancelAnimationFrame(themeFrame);
  themeFrame = null;
  pendingTheme = undefined;
  restorePaletteTransitions();
  return commitTheme(normalizeTheme(value));
}

export function saveInterfaceTheme(value) {
  const theme = normalizeTheme(value);
  try { localStorage.setItem(KEY, theme); } catch { /* Selection still works without storage. */ }
  pendingTheme = theme;
  if (themeFrame === null) {
    // Selection responds immediately; only the last requested palette is applied
    // per frame. This queue survives closing/unmounting the settings picker.
    themeFrame = requestAnimationFrame(() => {
      const next = pendingTheme;
      themeFrame = null;
      pendingTheme = undefined;
      commitTheme(next, true);
    });
  }
  return theme;
}
