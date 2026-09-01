const ACCENTS = {
  coral: { base: "#c96f52", strong: "#a95339" },
  sage: { base: "#688b78", strong: "#4f715f" },
  slate: { base: "#6d7c8b", strong: "#536271" },
  amber: { base: "#b8884a", strong: "#916a34" },
};

export const DEFAULT_APPEARANCE = {
  accent: "coral",
  density: "comfortable",
  theme: "system",
};

export function normalizeAppearance(value = {}) {
  return {
    accent: ACCENTS[value.accent] ? value.accent : DEFAULT_APPEARANCE.accent,
    density: ["comfortable", "compact"].includes(value.density) ? value.density : DEFAULT_APPEARANCE.density,
    theme: ["system", "light", "dark"].includes(value.theme) ? value.theme : DEFAULT_APPEARANCE.theme,
  };
}

function systemThemeMedia() {
  const browserWindow = globalThis.window;
  if (!browserWindow || typeof browserWindow.matchMedia !== "function") return null;
  return browserWindow.matchMedia("(prefers-color-scheme: dark)");
}

export function resolvedTheme(theme, media = null) {
  const preference = media || systemThemeMedia();
  return theme === "system" ? (preference?.matches ? "dark" : "light") : theme;
}

export function applyAppearance(value = {}, root = document.documentElement) {
  const appearance = normalizeAppearance(value);
  const accent = ACCENTS[appearance.accent];
  root.dataset.themePreference = appearance.theme;
  root.dataset.theme = resolvedTheme(appearance.theme);
  root.dataset.density = appearance.density;
  root.style.setProperty("--coral", accent.base);
  root.style.setProperty("--coral-dark", accent.strong);
  root.style.setProperty("--coral-soft", `color-mix(in srgb, ${accent.base} 14%, transparent)`);
  return appearance;
}

export function watchSystemTheme(getAppearance, root = document.documentElement) {
  const media = systemThemeMedia();
  if (!media?.addEventListener) return () => {};
  const update = () => {
    const appearance = normalizeAppearance(getAppearance?.());
    if (appearance.theme === "system") applyAppearance(appearance, root);
  };
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
