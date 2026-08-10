import { useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import type { Theme } from "../lib/types";

/** Themes that resolve to a dark base for the OS-scheme fallback. */
const DARK_THEMES: Theme[] = ["dark", "dracula", "nord", "solarized"];

/** Apply the theme setting to <html data-theme>. "system" follows the OS. */
export function useTheme() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (resolved: Theme) => {
      root.setAttribute("data-theme", resolved);
    };

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches ? "dark" : "light");
      const onChange = (e: MediaQueryListEvent) =>
        apply(e.matches ? "dark" : "light");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }

    apply(theme);
  }, [theme]);
}

export { DARK_THEMES };
