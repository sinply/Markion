import { describe, it, expect } from "vitest";
import { layout, VIEW_H, VIEW_W } from "../GraphPanel";
import type { GraphNode, GraphEdge } from "../../lib/ipc";

function nodes(count: number): GraphNode[] {
  return Array.from({ length: count }, (_, i) => ({ id: `n${i}`, title: `n${i}` }));
}

function chainEdges(ns: GraphNode[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (let i = 0; i < ns.length - 1; i++) {
    edges.push({ source: ns[i].id, target: ns[i + 1].id });
  }
  return edges;
}

describe("graph layout", () => {
  it("keeps nodes inside the viewBox with margin", () => {
    const ns = nodes(50);
    const pos = layout(ns, chainEdges(ns));
    for (const n of ns) {
      const p = pos.get(n.id)!;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(VIEW_W);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(VIEW_H);
    }
  });

  it("spreads many nodes so they do not all collide at one point", () => {
    const ns = nodes(100);
    const pos = layout(ns, chainEdges(ns));
    const pts = ns.map((n) => pos.get(n.id)!);
    const distinct = new Set(pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));
    expect(distinct.size).toBeGreaterThan(50);
  });

  it("handles isolated nodes (no edges) without NaN", () => {
    const ns = nodes(20);
    const pos = layout(ns, []);
    for (const n of ns) {
      const p = pos.get(n.id)!;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});
