import { useEffect, useMemo, useRef, useState } from "react";
import { useVaultStore } from "../stores/vaultStore";
import { useDocStore } from "../stores/docStore";
import { readFile, scanGraph, type GraphNode, type GraphEdge } from "../lib/ipc";

interface Pos {
  x: number;
  y: number;
}

export const VIEW_W = 600;
export const VIEW_H = 400;
const MAX_NODES = 120;

/** Force-directed layout, then normalize to fit the viewBox. Exported for tests. */
export function layout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  const N = nodes.length;
  nodes.forEach((n, i) => {
    const a = (i / Math.max(1, N)) * Math.PI * 2;
    pos.set(n.id, {
      x: VIEW_W / 2 + Math.cos(a) * (VIEW_W / 3),
      y: VIEW_H / 2 + Math.sin(a) * (VIEW_H / 3),
    });
  });

  const acc = new Map<string, { x: number; y: number }>();
  const k = 0.9;
  for (let iter = 0; iter < 60; iter++) {
    nodes.forEach((n) => acc.set(n.id, { x: 0, y: 0 }));
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
        const f = (6000 / d2) * k;
        acc.get(nodes[i].id)!.x += dx * f;
        acc.get(nodes[i].id)!.y += dy * f;
        acc.get(nodes[j].id)!.x -= dx * f;
        acc.get(nodes[j].id)!.y -= dy * f;
      }
    }
    edges.forEach((e) => {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (dist - 110) * 0.012;
      acc.get(e.source)!.x += (dx / dist) * f;
      acc.get(e.source)!.y += (dy / dist) * f;
      acc.get(e.target)!.x -= (dx / dist) * f;
      acc.get(e.target)!.y -= (dy / dist) * f;
    });
    nodes.forEach((n) => {
      const p = pos.get(n.id)!;
      const a = acc.get(n.id)!;
      p.x += a.x;
      p.y += a.y;
      p.x += (VIEW_W / 2 - p.x) * 0.02;
      p.y += (VIEW_H / 2 - p.y) * 0.02;
    });
  }

  // Normalize to fit within the viewBox, then center the scaled content.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    const p = pos.get(n.id)!;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  const pad = 30;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const sx = (VIEW_W - pad * 2) / w;
  const sy = (VIEW_H - pad * 2) / h;
  const s = Math.min(sx, sy);
  // Center the scaled bounding box in the viewBox (handles aspect mismatch).
  const offsetX = (VIEW_W - s * w) / 2;
  const offsetY = (VIEW_H - s * h) / 2;
  nodes.forEach((n) => {
    const p = pos.get(n.id)!;
    p.x = offsetX + (p.x - minX) * s;
    p.y = offsetY + (p.y - minY) * s;
  });
  return pos;
}

export function GraphPanel() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const openDoc = useDocStore((s) => s.openDoc);
  const setActiveContent = useDocStore((s) => s.setActiveContent);
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!vaultRoot) return;
      try {
        const [allNodes, edges] = await scanGraph(vaultRoot);
        if (cancelled) return;
        // Downsample when the vault is large: keep linked nodes first, then
        // enough isolated ones to fill the budget, so the graph stays readable.
        const linked = new Set<string>();
        edges.forEach((e) => { linked.add(e.source); linked.add(e.target); });
        const linkedNodes = allNodes.filter((n) => linked.has(n.id));
        const rest = allNodes.filter((n) => !linked.has(n.id));
        const budget = Math.max(0, MAX_NODES - linkedNodes.length);
        const nodes = [...linkedNodes, ...rest.slice(0, budget)];
        setData({ nodes, edges: edges.filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target)) });
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [vaultRoot]);

  const pos = useMemo(() => (data ? layout(data.nodes, data.edges) : new Map()), [data]);

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

  const totalHint = data && data.nodes.length === MAX_NODES ? ` (showing ${MAX_NODES} of a large vault)` : "";

  return (
    <div style={{ padding: 8, overflow: "auto", fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 12, color: "var(--fg-muted)" }}>
        GRAPH{totalHint}
      </div>
      {err && <div style={{ color: "var(--fg-muted)" }}>{err}</div>}
      {!data && !err && <div style={{ color: "var(--fg-muted)" }}>Scanning…</div>}
      {data && data.nodes.length === 0 && (
        <div style={{ color: "var(--fg-muted)" }}>No notes yet</div>
      )}
      {data && data.nodes.length > 0 && (
        <div style={{ position: "relative" }}>
          <svg
            ref={svgRef}
            width="100%"
            height={360}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            style={{
              background: "var(--panel-bg)", borderRadius: 6, border: "1px solid var(--border)",
              touchAction: "none", cursor: "grab",
            }}
            onWheel={(e) => {
              e.preventDefault();
              const factor = e.deltaY > 0 ? 0.9 : 1.1;
              const rect = svgRef.current?.getBoundingClientRect();
              const ox = rect ? e.clientX - rect.left : VIEW_W / 2;
              const oy = rect ? e.clientY - rect.top : VIEW_H / 2;
              const scaleX = VIEW_W / (rect?.width ?? VIEW_W);
              const scaleY = VIEW_H / (rect?.height ?? VIEW_H);
              const px = ox * scaleX;
              const py = oy * scaleY;
              const next = Math.min(4, Math.max(0.2, zoom * factor));
              const k = next / zoom;
              setPan((p) => ({ x: px - k * (px - p.x), y: py - k * (py - p.y) }));
              setZoom(next);
            }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              dragRef.current = { x: e.clientX, y: e.clientY };
              (e.currentTarget as SVGElement).style.cursor = "grabbing";
            }}
            onMouseMove={(e) => {
              if (dragRef.current) {
                const rect = svgRef.current?.getBoundingClientRect();
                const sx = (rect?.width ?? VIEW_W) / VIEW_W;
                const sy = (rect?.height ?? VIEW_H) / VIEW_H;
                const dx = (e.clientX - dragRef.current.x) * sx;
                const dy = (e.clientY - dragRef.current.y) * sy;
                dragRef.current = { x: e.clientX, y: e.clientY };
                setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
              }
            }}
            onMouseUp={() => {
              dragRef.current = null;
              if (svgRef.current) svgRef.current.style.cursor = "grab";
            }}
            onMouseLeave={() => {
              dragRef.current = null;
              if (svgRef.current) svgRef.current.style.cursor = "grab";
            }}
          >
            {/* Zoom around the viewBox center so the graph stays centered while scaling */}
            <g transform={`translate(${pan.x},${pan.y}) translate(${VIEW_W / 2},${VIEW_H / 2}) scale(${zoom}) translate(${-VIEW_W / 2},${-VIEW_H / 2})`}>
              {data.edges.map((e, i) => {
                const a = pos.get(e.source);
                const b = pos.get(e.target);
                if (!a || !b) return null;
                return (
                  <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border)" strokeWidth={1} />
                );
              })}
              {data.nodes.map((n) => {
                const p = pos.get(n.id);
                if (!p) return null;
                const active = hover === n.id;
                return (
                  <g
                    key={n.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void openNode(n.id);
                    }}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: "pointer" }}
                  >
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={active ? 9 : 6}
                      fill="var(--accent)"
                      opacity={active ? 1 : 0.75}
                    />
                    {active && (
                      <g>
                        <rect
                          x={p.x + 10}
                          y={p.y - 9}
                          width={Math.max(40, n.title.length * 6 + 12)}
                          height={18}
                          rx={3}
                          fill="var(--bg)"
                          stroke="var(--border)"
                        />
                        <text x={p.x + 16} y={p.y + 4} fontSize={11} fill="var(--fg)">
                          {n.title}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}>
            <button
              onClick={() => { setZoom((z) => Math.min(4, z * 1.25)); }}
              style={{ width: 24, height: 24, cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", borderRadius: 4 }}
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => { setZoom((z) => Math.max(0.2, z * 0.8)); }}
              style={{ width: 24, height: 24, cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", borderRadius: 4 }}
              title="Zoom out"
            >
              −
            </button>
            <button
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              style={{ width: 24, height: 24, cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--fg)", borderRadius: 4 }}
              title="Reset"
            >
              ⟲
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
