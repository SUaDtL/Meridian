import { createStoryboardPlayer } from "./storyboard";
import type { StoryScene } from "../types/storyboard";
import type { RenderTargetTable } from "./authoring/project-render";

/** Capture the player's finished scene, including its camera and visibility, without touching the live stage. */
export function sceneSnapshot(template: SVGSVGElement, scene: StoryScene, targets?: RenderTargetTable | null): string {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:720px;visibility:hidden;pointer-events:none";
  const root = template.cloneNode(true) as SVGSVGElement;
  host.attachShadow({ mode: "open" }).append(root);
  document.body.append(host);
  try {
    const player = createStoryboardPlayer(root, { version: 1, scenes: [scene], loop: false }, {
      targetTable: targets ?? undefined, reducedMotion: true, initialPreview: 0,
    });
    try { return new XMLSerializer().serializeToString(root); }
    finally { player.destroy(); }
  } finally { host.remove(); }
}
