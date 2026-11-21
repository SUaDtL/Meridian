import { useEffect, useRef, useState } from "react";
import type { RenderTargetTable } from "../lib/authoring/project-render";
import { createStoryboardPlayer } from "../lib/storyboard-runtime";
import type { StoryboardController, StoryPlaybackState, StoryScene } from "../types/storyboard";

export default function StoryPreviewPlayer({ svg, story, table, accent, onReady }: {
  svg: string; story: StoryScene[]; table: RenderTargetTable; accent: string; onReady: (ready: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<StoryboardController | undefined>(undefined);
  const [playback, setPlayback] = useState<Pick<StoryPlaybackState, "sceneIndex" | "playing">>();
  useEffect(() => {
    const root = host.current?.querySelector<SVGSVGElement>("[data-meridian-export]");
    if (!root) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const controller = createStoryboardPlayer(root, { version: 2, scenes: story, loop: false },
      { targetTable: table, accent, reducedMotion: motion.matches, initialPreview: 0,
        onUpdate: ({ sceneIndex, playing }) => setPlayback(current => current?.sceneIndex === sceneIndex && current.playing === playing
          ? current : { sceneIndex, playing }) });
    if (!controller) return;
    player.current = controller;
    onReady(true);
    const update = () => controller.setReducedMotion(motion.matches);
    motion.addEventListener("change", update);
    return () => { motion.removeEventListener("change", update); controller.destroy(); player.current = undefined; };
  }, [svg, story, table, accent, onReady]);
  const sceneIndex = playback?.sceneIndex;
  const active = sceneIndex === undefined ? undefined : story[sceneIndex];
  const canGoEarlier = sceneIndex !== undefined && sceneIndex > 0;
  const canGoLater = sceneIndex !== undefined && sceneIndex < story.length - 1;
  return (
    <section className="migration-preview story-suggestion-preview" aria-label="Story preview">
      <div ref={host} dangerouslySetInnerHTML={{ __html: svg }} />
      <p role="status" aria-atomic="true">{active && sceneIndex !== undefined
        ? `Scene ${sceneIndex + 1} of ${story.length} · ${active.title || "Untitled scene"}` : ""}</p>
      <div className="recovery-actions" role="group" aria-label="Story preview controls">
        {story.length > 1 && <button type="button" className="button quiet" aria-disabled={!canGoEarlier}
          onClick={() => { if (canGoEarlier) player.current?.preview(sceneIndex - 1); }}>Previous scene</button>}
        <button type="button" className="button secondary" disabled={sceneIndex === undefined}
          onClick={() => playback?.playing ? player.current?.pause() : player.current?.play()}>{playback?.playing ? "Pause story" : "Play story"}</button>
        {story.length > 1 && <button type="button" className="button quiet" aria-disabled={!canGoLater}
          onClick={() => { if (canGoLater) player.current?.preview(sceneIndex + 1); }}>Next scene</button>}
      </div>
      <div className="recovery-actions" role="group" aria-label="Preview a scene">
        {story.map((scene, index) => <button key={scene.id} type="button" className="button quiet" aria-pressed={playback?.sceneIndex === index}
          onClick={() => player.current?.preview(index)}>Preview {scene.title || "Untitled scene"}</button>)}
      </div>
    </section>
  );
}
