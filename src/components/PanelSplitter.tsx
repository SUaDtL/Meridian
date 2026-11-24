import { useLayoutEffect, useRef, useState } from "react";

type Side = "source" | "inspector";
type Width = number | "auto" | "wide";

export function usePanelWidth(side: Side) {
  const key = "meridian:panel:" + side;
  const max = side === "source" ? 1440 : 560;
  const [width, setWidth] = useState<Width>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (side === "source" && saved === "wide") return "wide";
      const pixels = Number(saved);
      if (Number.isFinite(pixels) && pixels > 0) return Math.min(max, Math.max(220, pixels));
    } catch { /* Use the responsive default when storage is unavailable. */ }
    return "auto";
  });
  function resize(next: Width, remember = true) {
    const value = typeof next === "number" ? Math.round(Math.max(220, Math.min(max, next))) : next;
    setWidth(value);
    if (remember) try {
      if (value === "auto") localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch { /* The current session still has the requested width. */ }
  }
  return { width, max, resize };
}

export default function PanelSplitter({ side, preference }: { side: Side; preference: ReturnType<typeof usePanelWidth> }) {
  const separator = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  const [actual, setActual] = useState(220);
  useLayoutEffect(() => {
    const panel = separator.current?.parentElement;
    if (!panel) return;
    const measure = () => setActual(Math.round(panel.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const direction = side === "source" ? 1 : -1;
  return <div ref={separator} className={"panel-splitter splitter-" + side} role="separator" aria-label={"Resize " + side + " panel"}
    title="Drag or use the arrow keys to resize. Double-click to restore automatic width."
    aria-orientation="vertical" aria-valuemin={Math.min(220, actual)} aria-valuemax={Math.max(preference.max,actual)} aria-valuenow={actual} tabIndex={0}
    onDoubleClick={() => preference.resize("auto")}
    onPointerDown={e => {
      if (e.button !== 0) return;
      drag.current = { x: e.clientX, width: e.currentTarget.parentElement!.getBoundingClientRect().width, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => {
      const start = drag.current;
      if (!start) return;
      if (e.clientX !== start.x) start.moved = true;
      if (start.moved) preference.resize(start.width + direction * (e.clientX - start.x), false);
    }}
    onPointerUp={e => {
      if (drag.current && (drag.current.moved || e.clientX !== drag.current.x)) preference.resize(drag.current.width + direction * (e.clientX - drag.current.x));
      drag.current = null;
    }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={e => {
      if (e.key === "Home") { e.preventDefault(); preference.resize("auto"); return; }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault(); preference.resize(actual + direction * (e.key === "ArrowRight" ? 16 : -16));
    }} />;
}
