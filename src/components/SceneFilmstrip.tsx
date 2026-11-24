import { memo, useEffect, useRef, useState } from "react";
import type { StudioDocument } from "../types";
import type { StoryScene } from "../types/storyboard";
import type { RenderTargetTable } from "../lib/authoring/project-render";
import { sceneSnapshot } from "../lib/scene-snapshot";

const ScenePicture = memo(function ScenePicture({ template, scene, targets }: { template: SVGSVGElement; scene: StoryScene; targets?: RenderTargetTable | null }) {
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
        const svg = sceneSnapshot(template, scene, targets);
        url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        setUrl(url);
      });
    });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(pending); if (url) URL.revokeObjectURL(url); };
  }, [template, scene, targets]);
  return <span className="scene-picture"><span ref={host}/>{url && <img src={url} alt="" />}</span>;
});

export default function SceneFilmstrip({ doc, template, targets, selected, onSelect, onReorder }: {
  doc: StudioDocument; template: SVGSVGElement; targets?: RenderTargetTable | null; selected: string | null;
  onSelect: (scene: StoryScene, index: number) => void; onReorder: (scenes: StoryScene[]) => void;
}) {
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
      <ScenePicture template={template} scene={scene} targets={targets} />
      <span>{index + 1}. {scene.title}</span><small>{scene.duration}s</small>
    </button>)}</nav>;
}
