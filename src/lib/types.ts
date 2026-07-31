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

export interface Settings {
  assetsStrategy: AssetsStrategy;
  pathStyle: PathStyle;
  theme: "system" | "light" | "dark";
  showHiddenFiles: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  assetsStrategy: "vault-assets",
  pathStyle: "relative",
  theme: "system",
  showHiddenFiles: false,
};
