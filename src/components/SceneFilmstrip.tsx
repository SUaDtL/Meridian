import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { StudioDocument, RenderResult } from "../types";
import type { StoryScene } from "../types/storyboard";
import type { RenderTargetTable } from "../lib/authoring/project-render";
import { buildExportFrame } from "../lib/export";
import { createStoryboardPlayer } from "../lib/storyboard";

const ScenePicture = memo(function ScenePicture({ svg, scene, targets }: { svg: string; scene: StoryScene; targets?: RenderTargetTable | null }) {
  const host = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let url: string | undefined;
    let pending = 0;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      pending = requestAnimationFrame(() => {
        const shadow = node.shadowRoot ?? node.attachShadow({ mode: "open" });
        const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement as unknown as SVGSVGElement;
        root.style.cssText = "position:absolute;width:144px;height:64px;visibility:hidden;pointer-events:none";
        shadow.replaceChildren(root);
        const player = createStoryboardPlayer(root, { version: 1, scenes: [scene], loop: false }, {
          targetTable: targets ?? undefined, reducedMotion: true, initialPreview: 0,
        });
        root.removeAttribute("style");
        url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" }));
        player.destroy();
        root.remove();
        setUrl(url);
      });
    });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(pending); if (url) URL.revokeObjectURL(url); };
  }, [svg, scene, targets]);
  return <span className="scene-picture"><span ref={host}/>{url && <img src={url} alt="" />}</span>;
});

export default function SceneFilmstrip({ doc, result, targets, selected, onSelect, onReorder }: {
  doc: StudioDocument; result: RenderResult; targets?: RenderTargetTable | null; selected: string | null;
  onSelect: (scene: StoryScene, index: number) => void; onReorder: (scenes: StoryScene[]) => void;
}) {
  const svg = useMemo(() => buildExportFrame(result, doc).svg, [result, doc.title, doc.subtitle, doc.settings]);
  const scenes = doc.storyboard?.scenes ?? [];
  const dragged = useRef<string | null>(null);
  return <nav className="scene-filmstrip" aria-label="Scene filmstrip">{scenes.map((scene, index) =>
    <button key={scene.id} aria-pressed={scene.id === selected} onClick={() => onSelect(scene, index)}
      draggable onDragStart={event => { dragged.current = scene.id; event.dataTransfer.setData("text/plain",scene.id); }}
      onDragEnd={() => { dragged.current = null; }}
      onDragOver={event => { if (dragged.current) event.preventDefault(); }}
      onDrop={event => {
        event.preventDefault();
        const from = scenes.findIndex(item => item.id === dragged.current);
        if (from < 0 || from === index) return;
        const next = [...scenes]; next.splice(index, 0, ...next.splice(from, 1)); onReorder(next);
      }}>
      <ScenePicture svg={svg} scene={scene} targets={targets} />
      <span>{index + 1}. {scene.title}</span><small>{scene.duration}s</small>
    </button>)}</nav>;
}
