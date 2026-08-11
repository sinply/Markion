import { useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";

const FONTS: Record<string, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', 'Songti SC', SimSun, serif",
  sans: "Helvetica, Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
  rounded: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Varela Round', ui-rounded, system-ui, sans-serif",
};

/** Apply the font setting as a CSS variable on <html>. */
export function useFont() {
  const font = useSettingsStore((s) => s.font);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-font", FONTS[font] ?? FONTS.system);
  }, [font]);
}
