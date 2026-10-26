import { useState } from "react";
import { AppearancePreview } from "./AppearancePreview";
import { SegmentedControl } from "./SegmentedControl";
import { readInterfaceTheme, saveInterfaceTheme } from "./interface-theme";

const THEMES = [
  { id: "white", label: "简约白" },
  { id: "neutral-dark", label: "简约深色" },
  { id: "light", label: "暖色浅色" },
  { id: "dark", label: "暖色深色" },
].map((theme) => ({ ...theme, preview: <AppearancePreview theme={theme.id} /> }));

export function InterfaceThemePicker() {
  const [theme, setTheme] = useState(readInterfaceTheme);
  return <SegmentedControl aria-label="主题" variant="preview" tabs={THEMES} value={theme} onChange={(value) => setTheme(saveInterfaceTheme(value))} />;
}
