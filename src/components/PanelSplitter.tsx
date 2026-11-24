import { useRef, useState } from "react";

type Side = "source" | "inspector";
const limits = { source: [220, 760], inspector: [220, 560] };

export default function PanelSplitter({ side }: { side: Side }) {
  const key = "meridian:panel:" + side;
  const [min, max] = limits[side];
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      if (Number.isFinite(saved) && saved > 0) return clamp(saved);
    } catch { /* The live layout also works without storage. */ }
    return side === "source" ? 416 : 310;
  });
  const start = useRef<{ x: number; width: number } | null>(null);
  function resize(next: number, remember: boolean) {
    const value = clamp(next);
    setWidth(value);
    if (remember) try { localStorage.setItem(key, String(value)); } catch { /* session only */ }
  }
  const direction = side === "source" ? 1 : -1;
  return <div className={'panel-splitter splitter-' + side} role="separator" aria-label={'Resize ' + side + ' panel'}
    aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} tabIndex={0}
    ref={node => { node?.closest<HTMLElement>(".workspace")?.style.setProperty("--" + side + "-width", width + "px"); }}
    onPointerDown={e => {
      if (e.button !== 0) return;
      const actual = e.currentTarget.parentElement!.getBoundingClientRect().width;
      start.current = { x: e.clientX, width: actual }; e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => { if (start.current) resize(start.current.width + direction * (e.clientX - start.current.x), false); }}
    onPointerUp={e => { if (start.current) resize(start.current.width + direction * (e.clientX - start.current.x), true); start.current = null; }}
    onLostPointerCapture={() => { start.current = null; }}
    onKeyDown={e => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault(); resize(width + direction * (e.key === "ArrowRight" ? 16 : -16), true);
    }} />;
}
