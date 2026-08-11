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
  | "solarized";

export type Language = "en" | "zh";

export type FontChoice = "system" | "serif" | "sans" | "mono" | "rounded";

export interface Settings {
  assetsStrategy: AssetsStrategy;
  pathStyle: PathStyle;
  theme: Theme;
  showHiddenFiles: boolean;
  livePreview: boolean;
  language: Language;
  font: FontChoice;
}

export const DEFAULT_SETTINGS: Settings = {
  assetsStrategy: "vault-assets",
  pathStyle: "relative",
  theme: "system",
  showHiddenFiles: false,
  livePreview: true,
  language: "zh",
  font: "system",
};
