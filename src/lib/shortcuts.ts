/** Built-in keyboard shortcut bindings: command id -> combo string. Users can
 *  override any of these via Settings (persisted in `.markion/config.json`
 *  under `shortcuts`); `useCommands` merges the overrides over these. */

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  "app:save": "Ctrl+S",
  "app:saveAs": "Ctrl+Shift+S",
  "app:openFile": "Ctrl+O",
  "app:openFolder": "Ctrl+Shift+O",
  "md:bold": "Ctrl+B",
  "md:italic": "Ctrl+I",
  "md:heading1": "Ctrl+1",
  "md:heading2": "Ctrl+2",
  "md:heading3": "Ctrl+3",
  "app:toggleMode": "Ctrl+E",
  "app:closeTab": "Ctrl+W",
  "app:find": "Ctrl+F",
  "app:vaultSearch": "Ctrl+Shift+F",
  "app:reopenTab": "Ctrl+Shift+T",
};

export type ShortcutId = keyof typeof DEFAULT_SHORTCUTS;

export interface Combo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** Parse "Ctrl+Shift+K" / "Alt+1" / "F1" into a Combo (null when invalid). */
export function parseCombo(spec: string): Combo | null {
  const parts = spec.split("+").map((p) => p.trim()).filter(Boolean);
  const combo: Combo = { ctrl: false, shift: false, alt: false, key: "" };
  for (const p of parts) {
    if (/^(ctrl|cmd|meta|command)$/i.test(p)) combo.ctrl = true;
    else if (/^shift$/i.test(p)) combo.shift = true;
    else if (/^(alt|option)$/i.test(p)) combo.alt = true;
    else combo.key = p.toLowerCase();
  }
  return combo.key ? combo : null;
}

/** Effective bindings (defaults overridden by user settings). */
export function effectiveShortcuts(overrides: Record<string, string>): Record<string, string> {
  return { ...DEFAULT_SHORTCUTS, ...overrides };
}
