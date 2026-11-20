import { Code2, Play, Save, Sparkles } from "lucide-react";
import Modal from "./Modal";

export default function Guide({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="From idea to presentation."
      eyebrow="QUICK GUIDE"
      wide
      onClose={onClose}
    >
      <div className="guide-grid">
        <section>
          <h3>
            <Code2 size={19} />
            Start with your source
          </h3>
          <p>
            Choose an empty canvas, pick an example, or import a .mmd or
            Meridian project file. Paste or edit Mermaid in Source. Live
            rendering keeps the picture up to date; an incomplete edit keeps
            your last valid drawing visible.
          </p>
          <pre className="guide-code">
            {
              "flowchart LR\n  A[An idea] --> B{A decision}\n  B -->|Yes| C[Make it happen]\n  B -->|Not yet| A"
            }
          </pre>
          <p>Use Render now when live rendering is paused.</p>
        </section>
        <section>
          <h3>
            <Sparkles size={19} />
            Make it yours
          </h3>
          <p>
            Click the title on the canvas or the pencil beside the project name
            to edit your heading. Choose a coordinated preset or theme in
            Design, then adjust layout, canvas, and effects.
          </p>
          <p>
            Select a node, connection, or group on the canvas, or use the
            element picker. Only the controls supported by that element are
            shown. Reset individual properties to inherit the diagram style.
            Visual changes leave your Mermaid source intact.
          </p>
        </section>
        <section>
          <h3>
            <Play size={19} />
            Tell the story
          </h3>
          <p>
            Open Storyboard to add scenes. Choose what appears, what is
            highlighted, and where the camera goes. Selecting a scene gives you
            its settled preview; Play shows its transitions.
          </p>
          <p>
            Present hides the editing panels. Drag to pan, scroll or pinch to
            zoom, and use Fit to reset. Reduced-motion preferences are
            respected. Export HTML for a complete presentation that works
            offline.
          </p>
        </section>
        <section>
          <h3>
            <Save size={19} />
            Keep control of your work
          </h3>
          <p>
            The welcome screen gives you a choice each time you open Meridian.
            Continue resumes your latest project. Home returns to this screen
            without removing anything.
          </p>
          <p>
            Edits autosave in this browser. Undo and Redo in the toolbar cover
            source, design, headings, and scenes for the current editing
            session. The source editor also keeps its own typing history.
          </p>
          <p>
            Download a Project for a portable backup. PNG is a still image for
            slides; SVG stays crisp at any size; HTML preserves motion and
            scenes.
          </p>
        </section>
      </div>
      <div className="shortcut-grid">
        {[
          ["Ctrl / ⌘ S", "Download project"],
          ["Ctrl / ⌘ Enter", "Render now"],
          ["Ctrl / ⌘ Z", "Undo"],
          ["Ctrl / ⌘ Shift Z", "Redo"],
          ["F", "Fit diagram"],
          ["P", "Toggle presentation"],
          ["Esc", "Exit presentation or preview"],
          ["Space / ← / →", "Presentation playback"],
        ].map(([keys, action]) => (
          <span key={keys}>
            <kbd>{keys}</kbd>
            {action}
          </span>
        ))}
      </div>
      <p className="guide-footnote">
        Meridian by ArbiterForge ·{" "}
        <a
          href="https://mermaid.js.org/intro/"
          target="_blank"
          rel="noreferrer"
        >
          Mermaid syntax reference
        </a>{" "}
        · Projects stay on this device unless you export and share them.
      </p>
    </Modal>
  );
}
