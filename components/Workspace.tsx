import { useRef } from "preact/hooks";
import Terminal, { type SessionMeta } from "./Terminal.tsx";
import type { Leaf, Node } from "./layout.ts";

interface Common {
  visible: boolean;
  focusedId: string;
  /** Highlight the focused pane — only when the tab is split into >1 pane. */
  showFocus: boolean;
  onFocus: (leafId: string) => void;
  onResize: (splitId: string, ratio: number) => void;
  onMeta: (term: string, m: SessionMeta) => void;
}

interface PaneRect {
  leaf: Leaf;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface DivRect {
  id: string;
  dir: "row" | "col";
  // boundary line position + extent (fractions 0..1)
  bx: number;
  by: number;
  bw: number;
  bh: number;
  // the split's full bounds, for mapping a pointer to a ratio
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

// Flatten the split tree into absolutely-positioned pane + divider rects (in
// fractions of the container). Crucially, panes are keyed by leaf id and never
// move in the DOM tree — splitting only changes their style, so the xterm /
// browser instance is preserved (no remount, no blank-on-split).
function collect(
  node: Node,
  x: number,
  y: number,
  w: number,
  h: number,
  panes: PaneRect[],
  divs: DivRect[],
) {
  if (node.type === "leaf") {
    panes.push({ leaf: node, x, y, w, h });
    return;
  }
  if (node.dir === "row") {
    const wa = w * node.ratio;
    collect(node.a, x, y, wa, h, panes, divs);
    collect(node.b, x + wa, y, w - wa, h, panes, divs);
    divs.push({
      id: node.id,
      dir: "row",
      bx: x + wa,
      by: y,
      bw: w,
      bh: h,
      sx: x,
      sy: y,
      sw: w,
      sh: h,
    });
  } else {
    const ha = h * node.ratio;
    collect(node.a, x, y, w, ha, panes, divs);
    collect(node.b, x, y + ha, w, h - ha, panes, divs);
    divs.push({
      id: node.id,
      dir: "col",
      bx: x,
      by: y + ha,
      bw: w,
      bh: h,
      sx: x,
      sy: y,
      sw: w,
      sh: h,
    });
  }
}

const pct = (v: number) => `${v * 100}%`;

export default function Workspace({ node, ...c }: { node: Node } & Common) {
  const ref = useRef<HTMLDivElement>(null);
  const panes: PaneRect[] = [];
  const divs: DivRect[] = [];
  collect(node, 0, 0, 1, 1, panes, divs);

  function startDrag(d: DivRect, e: PointerEvent) {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const frac = d.dir === "row"
        ? (ev.clientX - r.left) / r.width
        : (ev.clientY - r.top) / r.height;
      const ratio = d.dir === "row"
        ? (frac - d.sx) / d.sw
        : (frac - d.sy) / d.sh;
      c.onResize(d.id, ratio);
    };
    const up = () => {
      globalThis.removeEventListener("pointermove", move);
      globalThis.removeEventListener("pointerup", up);
    };
    globalThis.addEventListener("pointermove", move);
    globalThis.addEventListener("pointerup", up);
  }

  return (
    <div ref={ref} class="relative h-full w-full">
      {panes.map((p) => {
        const focused = p.leaf.id === c.focusedId;
        return (
          <div
            key={p.leaf.id}
            onMouseDown={() => c.onFocus(p.leaf.id)}
            class={`absolute overflow-hidden ${
              c.showFocus
                ? `rounded-md ring-1 ${focused ? "ring-[#2f6ee6]" : "ring-white/10"}`
                : ""
            }`}
            style={{ left: pct(p.x), top: pct(p.y), width: pct(p.w), height: pct(p.h) }}
          >
            <Terminal
              name={p.leaf.term}
              visible={c.visible}
              focused={c.visible && focused}
              onMeta={(m) => c.onMeta(p.leaf.term, m)}
            />
          </div>
        );
      })}

      {divs.map((d) => (
        <div
          key={d.id}
          onPointerDown={(e) => startDrag(d, e)}
          class={`absolute z-20 bg-black/40 hover:bg-[#2f6ee6] transition-colors ${
            d.dir === "row" ? "cursor-col-resize" : "cursor-row-resize"
          }`}
          style={d.dir === "row"
            ? { left: pct(d.bx), top: pct(d.by), height: pct(d.bh), width: "6px", marginLeft: "-3px" }
            : { top: pct(d.by), left: pct(d.bx), width: pct(d.bw), height: "6px", marginTop: "-3px" }}
        />
      ))}
    </div>
  );
}
