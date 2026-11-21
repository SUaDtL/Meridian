import { useEffect, useMemo, useRef, useState } from "react";
import type { MermaidProjectV3, OrphanAnnotation } from "../lib/authoring/mermaid-project";
import { orphanCleanupLimit, type openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import type { RenderTargetTable } from "../lib/authoring/project-render";
import { retainedAnnotationKind } from "../lib/authoring/remap-annotation";
import { buildExportFrame } from "../lib/export";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type RemapPreview = Awaited<ReturnType<Editor["prepareOrphanRemap"]>> & { url: string };
const pageSize = 40;
const reasons: Record<OrphanAnnotation["reason"], string> = {
  missing: "Former target missing",
  ambiguous: "Former target ambiguous",
  retired: "Former target removed",
  unsupported: "Former target could not be verified",
};

export default function OrphanReviewDialog({ editor, project, targets, onApply, onClose }: {
  editor: Editor; project: MermaidProjectV3; targets?: RenderTargetTable; onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyStructure"]>["status"]; onClose: () => void;
}) {
  const orphans = project.identity.orphans;
  const sceneTitles = useMemo(() => new Map(project.storyboard.scenes.map(scene => [scene.id, scene.title || "Untitled scene"])),
    [project.storyboard.scenes]);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState<{ proposal: ReadyProposal; scope: readonly OrphanAnnotation[]; hidden: number }>();
  const [error, setError] = useState("");
  const [remap, setRemap] = useState<OrphanAnnotation>();
  const [targetId, setTargetId] = useState("");
  const [candidate, setCandidate] = useState<RemapPreview>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState(false);
  const remapWork = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => remapWork.current?.abort(), []);
  useEffect(() => () => { if (candidate) URL.revokeObjectURL(candidate.url); }, [candidate]);
  const reattachSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (remap) reattachSelect.current?.focus(); }, [remap]);
  const confirm = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ready) confirm.current?.focus(); }, [ready]);
  const needle = query.trim().toLowerCase();
  const matches = orphans.filter(record => record.legacyKey.toLowerCase().includes(needle)
    || reasons[record.reason].toLowerCase().includes(needle));
  const visible = matches.slice(0, limit);
  const hidden = selected.size - visible.filter(record => selected.has(record.id)).length;

  const onlySelected = selected.size === 1 ? orphans.find(record => selected.has(record.id)) : undefined;
  const kind = remap ? retainedAnnotationKind(project, remap) : onlySelected ? retainedAnnotationKind(project, onlySelected) : undefined;
  const destinations = kind ? targets?.targets.filter(item => item.elementKind === kind) ?? [] : [];
  const sourceIds = new Map(project.identity.elements.map(item => [item.id, item.binding.sourceId]));

  function leaveRemap() {
    remapWork.current?.abort();
    remapWork.current = undefined;
    setBusy(false);
    setRemap(undefined);
    setCandidate(undefined);
    setError("");
    requestAnimationFrame(() => search.current?.focus());
  }

  async function reviewRemap() {
    if (!remap || !targetId || remapWork.current) return;
    const work = new AbortController();
    remapWork.current = work;
    setBusy(true);
    setError("");
    setCandidate(undefined);
    setPainted(false);
    try {
      const result = await editor.prepareOrphanRemap(remap.id, targetId, project, work.signal);
      work.signal.throwIfAborted();
      const { svg } = buildExportFrame(result.preview, result.document);
      setCandidate({ ...result, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    } catch (reason) {
      if (!work.signal.aborted) setError(reason instanceof Error ? reason.message : "The annotation could not be reattached.");
    } finally {
      if (remapWork.current === work) {
        remapWork.current = undefined;
        setBusy(false);
      }
    }
  }

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

  function apply(proposal: ReadyProposal) {
    const status = onApply(proposal);
    if (status !== "applied") {
      setReady(undefined);
      setCandidate(undefined);
      setError(status === "stale" ? "This project changed. Review the current annotations again."
        : "The selected annotation changes could not be applied with Undo.");
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
        <button type="button" className="button primary" onClick={() => apply(ready.proposal)}>Remove reviewed annotations</button>
      </div>
    </section> : remap ? <section className="heading-form" aria-label="Reattach an annotation">
      <p>Reattach {remap.legacyKey} to one current {kind}.</p>
      <p>{details(remap)}</p>
      <label>Destination<select ref={reattachSelect} value={targetId} disabled={busy} onChange={event => {
        setTargetId(event.target.value);
        setCandidate(undefined);
        setError("");
      }}>
        <option value="">Choose a current element</option>
        {destinations.map(item => <option key={item.id} value={item.id}>{item.label || "Unnamed element"} ({sourceIds.get(item.id)})</option>)}
      </select></label>
      {busy && <p role="status">Checking the proposed reattachment…</p>}
      {candidate && <section className="migration-preview" aria-label="Proposed annotation reattachment">
        <p>{candidate.orphan.legacyKey} will attach to {candidate.target.label || "the selected element"}.</p>
        <img src={candidate.url} alt="Diagram with the proposed annotation" onLoad={() => setPainted(true)}
          onError={() => setError("The proposed diagram could not be displayed.")} />
      </section>}
      <div className="dialog-actions">
        <button type="button" className="button quiet" onClick={leaveRemap}>Back to annotations</button>
        <button type="button" className="button secondary" disabled={!targetId || busy} onClick={() => void reviewRemap()}>Preview reattachment</button>
        <button type="button" className="button primary" disabled={!painted || !candidate || busy}
          onClick={() => { if (candidate && painted) apply(candidate.proposal); }}>Apply reviewed reattachment</button>
      </div>
    </section> : <section className="heading-form" aria-label="Retained annotations">
      <p>Meridian keeps annotations whose original element cannot be resolved. Choose a record to reattach or records to remove.</p>
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
        {!!destinations.length && onlySelected && !onlySelected.retained.componentIds?.length &&
          <button type="button" className="button secondary" onClick={() => { setRemap(onlySelected); setTargetId(""); setError(""); }}>
            Reattach selected annotation
          </button>}
      </div>
    </section>}
    {error && <p role="alert">{error}</p>}
  </Modal>;
}
