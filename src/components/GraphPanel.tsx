import { useEffect, useRef, useState } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { readFile, scanGraph, type GraphNode, type GraphEdge } from "../lib/ipc";

interface Pos {
  x: number;
  y: number;
}

/** Simple force-directed layout: a few iterations of repulsion + spring. */
function layout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  const N = nodes.length;
  const W = 600;
  const H = 400;
  nodes.forEach((n, i) => {
    // spread around a circle for a stable initial layout
    const a = (i / Math.max(1, N)) * Math.PI * 2;
    pos.set(n.id, { x: W / 2 + Math.cos(a) * (W / 3), y: H / 2 + Math.sin(a) * (H / 3) });
  });

  const acc = new Map<string, { x: number; y: number }>();
  const k = 0.9;
  for (let iter = 0; iter < 80; iter++) {
    nodes.forEach((n) => acc.set(n.id, { x: 0, y: 0 }));
    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = pos.get(nodes[i].id)!;
        const b = pos.get(nodes[j].id)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = dx * dx + dy * dy;
        }
        const f = (3000 / d2) * k;
        acc.get(nodes[i].id)!.x += dx * f;
        acc.get(nodes[i].id)!.y += dy * f;
        acc.get(nodes[j].id)!.x -= dx * f;
        acc.get(nodes[j].id)!.y -= dy * f;
      }
    }
    // springs
    edges.forEach((e) => {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (dist - 120) * 0.01;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      acc.get(e.source)!.x += fx;
      acc.get(e.source)!.y += fy;
      acc.get(e.target)!.x -= fx;
      acc.get(e.target)!.y -= fy;
    });
    // integrate
    nodes.forEach((n) => {
      const p = pos.get(n.id)!;
      const a = acc.get(n.id)!;
      p.x += a.x;
      p.y += a.y;
      // center gravity
      p.x += (W / 2 - p.x) * 0.01;
      p.y += (H / 2 - p.y) * 0.01;
    });
  }
  return pos;
}

export function GraphPanel() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const openDoc = useDocStore((s) => s.openDoc);
  const setActiveContent = useDocStore((s) => s.setActiveContent);
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [pos, setPos] = useState<Map<string, Pos>>(new Map());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!vaultRoot) return;
      try {
        const [nodes, edges] = await scanGraph(vaultRoot);
        if (cancelled) return;
        setData({ nodes, edges });
        setPos(layout(nodes, edges));
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [vaultRoot]);

  const openNode = async (id: string) => {
    if (!vaultRoot) return;
    try {
      const content = await readFile(vaultRoot, id);
      const title = id.split("/").pop() ?? id;
      openDoc(title, id);
      setActiveContent(content);
    } catch {
      // ignore
    }
  };

  return (
    <div style={{ padding: 8, overflow: "auto", fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, color: "var(--fg-muted)" }}>
        GRAPH
      </div>
      {err && <div style={{ color: "var(--fg-muted)" }}>{err}</div>}
      {!data && !err && <div style={{ color: "var(--fg-muted)" }}>Scanning…</div>}
      {data && data.nodes.length === 0 && (
        <div style={{ color: "var(--fg-muted)" }}>No notes yet</div>
      )}
      {data && data.nodes.length > 0 && (
        <svg width="100%" height={320} viewBox="0 0 600 400" style={{ background: "var(--panel-bg)", borderRadius: 6, border: "1px solid var(--border)" }}>
          {data.edges.map((e, i) => {
            const a = pos.get(e.source);
            const b = pos.get(e.target);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--border)"
                strokeWidth={1}
              />
            );
          })}
          {data.nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            return (
              <g key={n.id} onClick={() => openNode(n.id)} style={{ cursor: "pointer" }}>
                <circle cx={p.x} cy={p.y} r={8} fill="var(--accent)" opacity={0.9} />
                <text
                  x={p.x + 10}
                  y={p.y + 3}
                  fontSize={10}
                  fill="var(--fg)"
                >
                  {n.title}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
