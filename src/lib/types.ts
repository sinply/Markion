export type NodeKind = "file" | "folder";

export interface TreeNode {
  name: string;
  path: string;
  kind: NodeKind;
  children: TreeNode[];
  collapsed: boolean;
}

export type AssetsStrategy = "vault-assets" | "doc-assets" | `custom:${string}`;
export type PathStyle = "relative" | "absolute";

export type Theme =
  | "system"
  | "light"
  | "dark"
  | "sepia"
  | "eye"
  | "nord"
  | "dracula"
  | "solarized"
  | "tokyo"
  | "catppuccin"
  | "gruvbox";

export type Language = "en" | "zh";

export type FontChoice = "system" | "serif" | "sans" | "mono" | "rounded";

export interface Settings {
  assetsStrategy: AssetsStrategy;
  pathStyle: PathStyle;
  theme: Theme;
  /** Vault-relative folder holding note templates ("" = none). */
  templateFolder: string;
  showHiddenFiles: boolean;
  /** Show the "Open Today's Note" menu entry / palette command (off by
   *  default — not everyone journals). */
  showDailyNote: boolean;
  livePreview: boolean;
  language: Language;
  font: FontChoice;
  showOutline: boolean;
  showBacklinks: boolean;
  showGraph: boolean;
  showTags: boolean;
  showWordCount: boolean;
  /** User-customized shortcuts: command id -> "Ctrl+Shift+K". Empty = defaults. */
  shortcuts: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  assetsStrategy: "vault-assets",
  pathStyle: "relative",
  theme: "system",
  templateFolder: "Templates",
  showHiddenFiles: false,
  showDailyNote: false,
  livePreview: true,
  language: "zh",
  font: "system",
  showOutline: true,
  showBacklinks: true,
  showGraph: true,
  showTags: true,
  showWordCount: true,
  shortcuts: {},
};
