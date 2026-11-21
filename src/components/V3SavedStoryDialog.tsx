import { useMemo } from "react";
import type { MermaidProjectV3 } from "../lib/authoring/mermaid-project";
import type { RenderTargetTable } from "../lib/authoring/project-render";
import { buildExportFrame } from "../lib/export";
import type { RenderResult } from "../types";
import { getTheme } from "../lib/themes";
import Modal from "./Modal";
import ResponsiveStoryPreview from "./StoryPreviewPlayer";

export default function V3SavedStoryDialog({ project, result, table, onClose }: {
  project: MermaidProjectV3; result: RenderResult; table: RenderTargetTable; onClose: () => void;
}) {
  const drawing = useMemo(() => {
    try { return { svg: buildExportFrame(result, project, { animated: true }).svg }; }
    catch { return { error: "The saved story drawing could not be prepared." }; }
  }, [result, project]);
  return <Modal title="Preview saved story" wide onClose={onClose}>
    {drawing.svg ? <ResponsiveStoryPreview svg={drawing.svg} story={project.storyboard.scenes}
      table={table} accent={getTheme(project.settings.theme).accent} loop={project.storyboard.loop} />
      : <p role="alert">{drawing.error}</p>}
  </Modal>;
}
