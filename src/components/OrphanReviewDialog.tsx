import { useEffect, useMemo, useRef, useState } from "react";
import type { MermaidProjectV3, OrphanAnnotation } from "../lib/authoring/mermaid-project";
import { orphanCleanupLimit, type openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
const pageSize = 40;
const reasons: Record<OrphanAnnotation["reason"], string> = {
  missing: "Former target missing",
  ambiguous: "Former target ambiguous",
  retired: "Former target removed",
  unsupported: "Former target could not be verified",
};

export default function OrphanReviewDialog({ editor, project, onApply, onClose }: {
  editor: Editor; project: MermaidProjectV3; onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyStructure"]>["status"]; onClose: () => void;
}) {
  const orphans = project.identity.orphans;
  const sceneTitles = useMemo(() => new Map(project.storyboard.scenes.map(scene => [scene.id, scene.title || "Untitled scene"])),
    [project.storyboard.scenes]);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState<{ proposal: ReadyProposal; scope: readonly OrphanAnnotation[]; hidden: number }>();
  const [error, setError] = useState("");
  const confirm = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ready) confirm.current?.focus(); }, [ready]);
  const needle = query.trim().toLowerCase();
  const matches = orphans.filter(record => record.legacyKey.toLowerCase().includes(needle)
    || reasons[record.reason].toLowerCase().includes(needle));
  const visible = matches.slice(0, limit);
  const hidden = selected.size - visible.filter(record => selected.has(record.id)).length;

  function details({ retained }: OrphanAnnotation) {
    const scenes = [...new Set(retained.sceneReferences?.map(slot => sceneTitles.get(slot.sceneId) ?? "Untitled scene"))];
    return [
      retained.style && "Appearance settings",
      retained.role && `Role ${retained.role}`,
      scenes.length > 0 && `Scene references in ${scenes.join(", ")}`,
      !!retained.componentIds?.length && `${retained.componentIds.length} component references`,
    ].filter(Boolean).join(" · ");
  }

  function review() {
    try {
      const scope = orphans.filter(record => selected.has(record.id));
      if (scope.length !== selected.size) throw new Error("The selected annotations have changed.");
      setReady({ proposal: editor.prepareOrphanCleanup([...selected], project), scope, hidden });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The selected annotations could not be reviewed.");
    }
  }

  function apply() {
    if (!ready) return;
    const status = onApply(ready.proposal);
    if (status !== "applied") {
      setReady(undefined);
      setError(status === "stale" ? "This project changed. Review the current annotations again."
        : "The selected annotations could not be removed with Undo.");
    }
  }

  return <Modal title="Unresolved annotations" wide initialFocus="[name='annotation-search']" onClose={onClose}>
    {ready ? <section className="heading-form" aria-label="Annotations to remove">
      <h3 ref={confirm} tabIndex={-1}>Review annotation removal</h3>
      <p>Remove {ready.scope.length} selected {ready.scope.length === 1 ? "annotation" : "annotations"}.
        {ready.hidden > 0 && ` This includes ${ready.hidden} outside the visible results.`} Undo restores the removed records.</p>
      <ul className="project-list annotation-list">{ready.scope.map(record => <li className="project-row" key={record.id}>
        <strong>{record.legacyKey}</strong>
        <small>{details(record) || reasons[record.reason]}</small>
      </li>)}</ul>
      <div className="dialog-actions">
        <button type="button" className="button quiet" onClick={() => { setReady(undefined); requestAnimationFrame(() => search.current?.focus()); }}>Back to annotations</button>
        <button type="button" className="button primary" onClick={apply}>Remove reviewed annotations</button>
      </div>
    </section> : <section className="heading-form" aria-label="Retained annotations">
      <p>Meridian keeps annotations whose original element cannot be resolved. Choose the records you want to remove.</p>
      <label>Find an annotation<input ref={search} type="search" name="annotation-search" maxLength={160} value={query}
        onChange={event => { setQuery(event.target.value); setLimit(pageSize); }} /></label>
      <p role="status">{selected.size} selected · {hidden} hidden · {orphans.length} unresolved</p>
      {!visible.length && <p>No matching annotations.</p>}
      <ul className="project-list annotation-list">{visible.map(record => {
        const retained = details(record);
        return <li className="project-row" key={record.id}>
          <label className="check-label">
            <input type="checkbox" checked={selected.has(record.id)}
              disabled={selected.size >= orphanCleanupLimit && !selected.has(record.id)} onChange={event => {
                const next = new Set(selected);
                if (event.target.checked) next.add(record.id);
                else next.delete(record.id);
                setSelected(next);
              }} />{record.legacyKey}
          </label>
          <small>{reasons[record.reason]}{retained && ` · ${retained}`}</small>
        </li>;
      })}</ul>
      {visible.length < matches.length && <button type="button" className="button quiet"
        onClick={() => setLimit(value => value + pageSize)}>Show more annotations</button>}
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear selection</button>
        <button type="button" className="button secondary" disabled={!selected.size} onClick={review}>Review removal</button>
      </div>
    </section>}
    {error && <p role="alert">{error}</p>}
  </Modal>;
}
