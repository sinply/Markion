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
  | "nord"
  | "dracula"
  | "solarized";

export interface Settings {
  assetsStrategy: AssetsStrategy;
  pathStyle: PathStyle;
  theme: Theme;
  showHiddenFiles: boolean;
  livePreview: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  assetsStrategy: "vault-assets",
  pathStyle: "relative",
  theme: "system",
  showHiddenFiles: false,
  livePreview: true,
};
