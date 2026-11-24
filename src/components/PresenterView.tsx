import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { StoryScene } from "../types/storyboard";

export default function PresenterView({ scenes, index, previous, next }: {
  scenes: StoryScene[]; index: number; previous: () => void; next: () => void;
}) {
  const [panel, setPanel] = useState<Window | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!panel) return;
    const closed = () => setPanel(null);
    panel.addEventListener("pagehide", closed);
    return () => { panel.removeEventListener("pagehide", closed); if (!panel.closed) panel.close(); };
  }, [panel]);
  const current = scenes[index];
  if (!current) return null;
  function open() {
    if (panel && !panel.closed) { panel.focus(); return; }
    const popup = window.open("", "_blank", "popup,width=540,height=520");
    if (!popup) { setError(true); return; }
    setError(false);
    popup.document.title = "Meridian presenter notes";
    popup.document.body.style.cssText = "margin:2rem;background:#132126;color:#edf4f1;font:17px/1.55 system-ui;color-scheme:dark";
    setPanel(popup);
  }
  return <><button onClick={open}>Presenter view</button>
    {error && <span role="status">Allow a popup to open presenter notes.</span>}
    {panel && !panel.closed && createPortal(<main>
      <p>Scene {index + 1} of {scenes.length}</p>
      <h1>{current.title}</h1>
      <p style={{ whiteSpace: "pre-wrap" }}>{current.notes || "No presenter notes for this scene."}</p>
      <p>{scenes[index + 1] ? "Up next · " + scenes[index + 1].title : "Last scene"}</p>
      <button disabled={index === 0} onClick={previous}>Previous scene</button>{" "}
      <button disabled={index === scenes.length - 1} onClick={next}>Next scene</button>
    </main>, panel.document.body)}
  </>;
}
