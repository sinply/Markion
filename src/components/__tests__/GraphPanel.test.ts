import { describe, it, expect } from "vitest";
import { layout, downsampleGraph, VIEW_H, VIEW_W } from "../GraphPanel";
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

describe("downsampleGraph", () => {
  it("keeps all linked nodes before filling the budget with isolated ones", () => {
    const ns = nodes(10); // n0..n9
    const edges: GraphEdge[] = [
      { source: "n0", target: "n1" },
      { source: "n1", target: "n2" },
      { source: "n0", target: "n9" },
    ];
    const { nodes: kept, edges: keptEdges } = downsampleGraph(ns, edges, 5);
    // Linked set = {n0,n1,n2,n9} (4 nodes); budget fills with 1 isolated node.
    expect(kept).toHaveLength(5);
    for (const id of ["n0", "n1", "n2", "n9"]) {
      expect(kept.some((n) => n.id === id)).toBe(true);
    }
    expect(keptEdges).toEqual(edges); // all edges stay, endpoints kept
  });

  it("keeps all linked nodes and drops isolated ones when over budget", () => {
    const ns = nodes(6); // n0..n5; n2, n3 are isolated
    const edges: GraphEdge[] = [
      { source: "n0", target: "n1" },
      { source: "n4", target: "n5" },
    ];
    const { nodes: kept, edges: keptEdges } = downsampleGraph(ns, edges, 2);
    // Linked nodes are always kept (n0,n1,n4,n5 = 4 > budget); the budget only
    // limits how many isolated nodes (n2,n3) are filled in afterwards.
    expect(kept).toHaveLength(4);
    expect(keptEdges).toEqual(edges);
    expect(kept.some((n) => n.id === "n2")).toBe(false);
    expect(kept.some((n) => n.id === "n3")).toBe(false);
  });

  it("fills the remaining budget with isolated nodes", () => {
    const ns = nodes(5); // n0 linked; n1..n4 isolated
    const edges: GraphEdge[] = [{ source: "n0", target: "n0" }];
    const { nodes: kept } = downsampleGraph(ns, edges, 3);
    expect(kept).toHaveLength(3); // n0 + 2 isolated
    expect(kept[0].id).toBe("n0");
  });

  it("keeps everything when the budget is large enough", () => {
    const ns = nodes(3);
    const edges: GraphEdge[] = [{ source: "n0", target: "n2" }];
    const { nodes: kept, edges: keptEdges } = downsampleGraph(ns, edges, 100);
    expect(kept).toHaveLength(3);
    expect(keptEdges).toEqual(edges);
  });
});
