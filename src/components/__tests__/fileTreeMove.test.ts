import { describe, it, expect } from "vitest";
import { resolveMoveTarget, adjustReorderIndex } from "../FileTree";

/**
 * react-arborist hands onMove a payload whose ids are vault-relative PATHS
 * (`convertTree` sets `id: node.path`) and whose top-level nodes have
 * `parent.id === "__REACT_ARBORIST_INTERNAL_ROOT__"`. Passing those straight
 * to the backend made nested drags silent no-ops (junk index entries) and
 * top-level drags fail with ENOENT.
 */
describe("resolveMoveTarget", () => {
  const ROOT_ID = "__REACT_ARBORIST_INTERNAL_ROOT__";
  const nodeAt = (id: string, parentId: string, isRoot = false) => ({
    id,
    parent: { id: parentId, isRoot },
  });

  it("reduces a nested path id to its bare file name", () => {
    const t = resolveMoveTarget({
      dragIds: ["notes/a.md"],
      dragNodes: [nodeAt("notes/a.md", "notes")],
      parentId: "notes",
    });
    expect(t).toEqual({ name: "a.md", srcParent: "notes", destParent: "notes" });
  });

  it("maps arborist's internal root to the vault root", () => {
    const t = resolveMoveTarget({
      dragIds: ["intro.md"],
      dragNodes: [nodeAt("intro.md", ROOT_ID, true)],
      parentId: "notes",
    });
    expect(t).toEqual({ name: "intro.md", srcParent: "", destParent: "notes" });
  });

  it("treats a drop on the root as the vault root", () => {
    const t = resolveMoveTarget({
      dragIds: ["notes/a.md"],
      dragNodes: [nodeAt("notes/a.md", "notes")],
      parentId: null,
    });
    expect(t).toEqual({ name: "a.md", srcParent: "notes", destParent: "" });
  });

  it("returns null for an empty payload", () => {
    expect(resolveMoveTarget({})).toBeNull();
    expect(resolveMoveTarget({ dragIds: [] })).toBeNull();
  });
});

/**
 * react-arborist's `onMove.index` is a PRE-removal slot while
 * `tree_index::reorder` splices the row out before inserting — dragging a row
 * downwards used to land one slot too far.
 */
describe("adjustReorderIndex", () => {
  const sibs = ["a.md", "b.md", "c.md"];

  it("shifts a downward drop left by the dragged row", () => {
    // Dropping `a` between b and c is arborist slot 2 → post-removal 1.
    expect(adjustReorderIndex({ dragIds: ["a.md"], index: 2 }, sibs)).toBe(1);
  });

  it("leaves an upward drop untouched", () => {
    expect(adjustReorderIndex({ dragIds: ["c.md"], index: 0 }, sibs)).toBe(0);
  });

  it("shifts by every dragged row that started before the slot", () => {
    expect(adjustReorderIndex({ dragIds: ["a.md", "b.md"], index: 3 }, sibs)).toBe(1);
  });

  it("treats a missing index as the top slot", () => {
    expect(adjustReorderIndex({ dragIds: ["b.md"] }, sibs)).toBe(0);
    expect(adjustReorderIndex({}, sibs)).toBe(0);
  });
});
