import { useEffect, useRef, useState } from "react";
import type { RenderTargetTable } from "../lib/authoring/project-render";
import { createStoryboardPlayer } from "../lib/storyboard-runtime";
import type { StoryboardController, StoryPlaybackState, StoryScene } from "../types/storyboard";

export default function StoryPreviewPlayer({ svg, story, table, accent, onReady }: {
  svg: string; story: StoryScene[]; table: RenderTargetTable; accent: string; onReady: (ready: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<StoryboardController | undefined>(undefined);
  const [playback, setPlayback] = useState<StoryPlaybackState>();
  useEffect(() => {
    const root = host.current?.querySelector<SVGSVGElement>("[data-meridian-export]");
    if (!root) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const controller = createStoryboardPlayer(root, { version: 2, scenes: story, loop: false },
      { targetTable: table, accent, reducedMotion: motion.matches, initialPreview: 0, onUpdate: setPlayback });
    if (!controller) return;
    player.current = controller;
    onReady(true);
    const update = () => controller.setReducedMotion(motion.matches);
    motion.addEventListener("change", update);
    return () => { motion.removeEventListener("change", update); controller.destroy(); player.current = undefined; };
  }, [svg, story, table, accent, onReady]);
  return (
    <div className="migration-preview story-suggestion-preview">
      <div ref={host} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="recovery-actions">
        {story.map((scene, index) => <button key={scene.id} type="button" className="button quiet" aria-pressed={playback?.sceneIndex === index}
          onClick={() => player.current?.preview(index)}>Preview {scene.title}</button>)}
        <button type="button" className="button secondary" onClick={() => playback?.playing ? player.current?.pause() : player.current?.play()}>{playback?.playing ? "Pause story" : "Play story"}</button>
      </div>
    </div>
  );
}
