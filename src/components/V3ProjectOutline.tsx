import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { OutlineSourceLocation, ProjectOutlineItem } from "../lib/authoring/project-outline";
import { bulkConnectionLimit } from "../lib/authoring/project-flowchart";
import Modal from "./Modal";

const pageSize = 80;
const selectionLimit = 200;
type OutlineRow = { item: ProjectOutlineItem; depth: number; branch: boolean; expanded: boolean };

function outlineRows(items: readonly ProjectOutlineItem[], relationships: boolean, query: string, collapsed: ReadonlySet<string>): OutlineRow[] {
  const matching = ({ label, endpoints, role, sourceId }: ProjectOutlineItem) =>
    [label, endpoints, role, sourceId].some(value => value?.toLowerCase().includes(query));
  if (relationships) return items.filter(item => item.kind === "edge" && matching(item))
    .map(item => ({ item, depth: 1, branch: false, expanded: false }));
  const nodes = items.filter(item => item.kind !== "edge");
  const byId = new Map(nodes.map(item => [item.id, item]));
  const children = new Map<string | null, ProjectOutlineItem[]>();
  for (const item of nodes) {
    const parent = item.parentId && byId.has(item.parentId) ? item.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(item);
    children.set(parent, siblings);
  }
  const included = new Set<string>();
  if (query) {
    for (const match of nodes.filter(matching)) {
      for (let item: ProjectOutlineItem | undefined = match; item && !included.has(item.id);
        item = item.parentId ? byId.get(item.parentId) : undefined) included.add(item.id);
    }
  }
  const rows: OutlineRow[] = [];
  const stack = (children.get(null) ?? []).map(item => ({ item, depth: 1 })).reverse();
  while (stack.length) {
    const { item, depth } = stack.pop()!;
    if (query && !included.has(item.id)) continue;
    const descendants = (children.get(item.id) ?? []).filter(child => !query || included.has(child.id));
    const branch = !!descendants.length;
    const expanded = branch && (!!query || !collapsed.has(item.id));
    rows.push({ item, depth, branch, expanded });
    if (expanded) stack.push(...descendants.map(child => ({ item: child, depth: depth + 1 })).reverse());
  }
  return rows;
}

export default function V3ProjectOutline({ items, selected, onSelection, canRename, onRename, onSource, onConnect, onGroup, onBulkText,
  onDesign, onResetDesign, onSaveComponent, onStory, onDeleteConnections, onClose }: {
  items: ProjectOutlineItem[];
  selected: ReadonlySet<string>;
  onSelection: Dispatch<SetStateAction<ReadonlySet<string>>>;
  canRename: boolean;
  onRename: (id: string) => void;
  onSource: (location: OutlineSourceLocation) => void;
  onConnect?: () => void;
  onGroup?: (hidden: number) => void;
  onBulkText: (hidden: number) => void;
  onDesign?: (hidden: number) => void;
  onResetDesign?: (hidden: number) => void;
  onSaveComponent?: (hidden: number) => void;
  onStory?: (hidden: number) => void;
  onDeleteConnections?: (hidden: number) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [relationships, setRelationships] = useState(false);
  const [limit, setLimit] = useState(pageSize);
  const [activeId, setActiveId] = useState<string>();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [checkboxSelection, setCheckboxSelection] = useState(false);
  const [refusedCount, setRefusedCount] = useState<number>();
  const list = useRef<HTMLUListElement>(null);
  const needle = query.trim().toLowerCase();
  const rows = useMemo(() => outlineRows(items, relationships, needle, collapsed), [items, relationships, needle, collapsed]);
  const visible = rows.slice(0, limit);
  const active = visible.find(row => row.item.id === activeId) ?? visible[0];
  const hidden = selected.size - visible.filter(row => selected.has(row.item.id)).length;
  const selectedNodes = selected.size > 0 && items.filter(item => item.kind === "node" && selected.has(item.id)).length === selected.size;
  const canSaveComponent = selected.size > 0 && selected.size <= 100
    && items.filter(item => item.kind !== "edge" && selected.has(item.id)).length === selected.size;
  const canDeleteConnections = selected.size > 0 && selected.size <= bulkConnectionLimit
    && items.filter(item => item.kind === "edge" && item.source && selected.has(item.id)).length === selected.size;
  const canCreateScene = selected.size > 0 && items.filter(item => item.kind !== "group" && selected.has(item.id)).length === selected.size;

  useEffect(() => {
    if (active && document.activeElement === list.current) {
      document.getElementById(`${id}-${active.item.id}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [active, id]);

  function select(itemId: string, toggle = false) {
    setActiveId(itemId);
    const next = new Set(toggle ? selected : []);
    if (toggle && next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    updateSelection(next);
  }

  function updateSelection(next: ReadonlySet<string>) {
    if (next.size > selectionLimit) {
      setRefusedCount(next.size);
      return;
    }
    setRefusedCount(undefined);
    onSelection(next);
  }

  function setExpanded(itemId: string, expanded: boolean) {
    if (needle) return;
    setCollapsed(current => {
      const next = new Set(current);
      if (expanded) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function keyboard(event: KeyboardEvent<HTMLUListElement>) {
    if (!active || event.nativeEvent.isComposing) return;
    const { item } = active;
    const index = visible.indexOf(active);
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1
        : Math.min(visible.length - 1, Math.max(0, index + (event.key === "ArrowUp" ? -1 : 1)));
      setActiveId(visible[next].item.id);
    } else if (event.key === "Enter" || (event.key === " " && event.shiftKey)) {
      event.preventDefault();
      select(item.id, event.shiftKey);
    } else if (!relationships && event.key === "ArrowLeft") {
      event.preventDefault();
      if (active.expanded && !needle) setExpanded(item.id, false);
      else if (item.parentId) setActiveId(item.parentId);
    } else if (!relationships && event.key === "ArrowRight") {
      event.preventDefault();
      if (active.branch && !active.expanded) setExpanded(item.id, true);
      else if (active.expanded && visible[index + 1]?.item.parentId === item.id) setActiveId(visible[index + 1].item.id);
    } else if (event.key === "F2" && canRename && item.kind === "node") {
      event.preventDefault();
      onRename(item.id);
    }
  }

  function setTab(showRelationships: boolean) {
    setRelationships(showRelationships);
    setActiveId(undefined);
    setLimit(pageSize);
  }

  return (
    <Modal title="Diagram outline" wide onClose={onClose} initialFocus="[name='outline-search']">
      <div className="heading-form project-outline">
        <label>Find an element<input name="outline-search" value={query} maxLength={160}
          onChange={event => { setQuery(event.target.value); setLimit(pageSize); setActiveId(undefined); }}
          onKeyDown={event => {
            if (event.key !== "ArrowDown" || !visible.length) return;
            event.preventDefault();
            if (checkboxSelection) list.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
            else list.current?.focus();
          }} /></label>
        <div className="recovery-actions" role="group" aria-label="Outline views">
          <button type="button" className="button secondary" aria-pressed={!relationships} onClick={() => setTab(false)}>Nodes and groups</button>
          <button type="button" className="button secondary" aria-pressed={relationships} onClick={() => setTab(true)}>Relationships</button>
        </div>
        <p role="status">{selected.size} selected · {hidden} hidden</p>
        {refusedCount !== undefined && <p role="alert">That action would select {refusedCount} elements. The limit is {selectionLimit}. {selected.size} are selected.</p>}
        <div className="recovery-actions" role="group" aria-label="Outline selection">
          <button type="button" className="button secondary" aria-pressed={checkboxSelection}
            onClick={() => setCheckboxSelection(current => !current)}>Select multiple</button>
          {onConnect && <button type="button" className="button secondary" onClick={onConnect}>Connect from selected node</button>}
          {onGroup && selectedNodes && <button type="button" className="button secondary" onClick={() => onGroup(hidden)}>Group selected nodes</button>}
          <button type="button" className="button quiet" disabled={!visible.length}
            onClick={() => updateSelection(new Set([...selected, ...visible.map(row => row.item.id)]))}>Select visible results</button>
          <button type="button" className="button quiet" disabled={!items.length}
            onClick={() => updateSelection(new Set(items.map(item => item.id)))}>Select all diagram elements</button>
          <button type="button" className="button quiet" disabled={!selected.size} onClick={() => updateSelection(new Set())}>Clear selection</button>
          <button type="button" className="button secondary" disabled={!selected.size} onClick={() => onBulkText(hidden)}>Change selected text color</button>
          {onDesign && <button type="button" className="button secondary" disabled={!selected.size}
            onClick={() => onDesign(hidden)}>Explore designs for selection</button>}
          {onResetDesign && <button type="button" className="button secondary" onClick={() => onResetDesign(hidden)}>Reset selected styles</button>}
          {onStory && canCreateScene && <button type="button" className="button secondary" onClick={() => onStory(hidden)}>Create scene from selection</button>}
          {onSaveComponent && <button type="button" className="button secondary" disabled={!canSaveComponent}
            title={canSaveComponent ? undefined : "Select one to 100 nodes or groups"}
            onClick={() => onSaveComponent(hidden)}>Save as component</button>}
          {onDeleteConnections && relationships && <button type="button" className="button secondary" disabled={!canDeleteConnections}
            onClick={() => onDeleteConnections(hidden)}>Delete selected connections</button>}
        </div>
        {onDeleteConnections && relationships && selected.size > 0 && !canDeleteConnections
          && <p>Choose up to {bulkConnectionLimit} connections with verified source IDs to delete together.</p>}
        <ul ref={list} role={checkboxSelection ? "list" : relationships ? "listbox" : "tree"}
          aria-label={relationships ? "Relationships" : "Diagram elements"}
          aria-activedescendant={!checkboxSelection && active ? `${id}-${active.item.id}` : undefined}
          aria-multiselectable={checkboxSelection ? undefined : true} tabIndex={!checkboxSelection && visible.length ? 0 : undefined}
          onKeyDown={checkboxSelection ? undefined : keyboard}>
          {visible.map(({ item, depth, branch, expanded }) => {
            const checked = selected.has(item.id);
            const content = <>
              <strong>{item.kind === "edge" ? item.endpoints || "Relationship" : item.label || item.sourceId || "Unnamed element"}</strong>
              <small>{item.kind === "edge" ? item.label && item.label !== item.endpoints ? item.label : "Relationship"
                : `${item.kind}${item.role ? ` · ${item.role}` : ""} · ${item.connections} ${item.connections === 1 ? "connection" : "connections"}`}
                {item.sourceId && ` · ${item.sourceId}`}{item.source && ` · Line ${item.source.line}`}</small>
            </>;
            return <li id={`${id}-${item.id}`} key={item.id} role={checkboxSelection ? undefined : relationships ? "option" : "treeitem"}
              aria-selected={checkboxSelection ? undefined : checked} aria-level={checkboxSelection || relationships ? undefined : depth}
              aria-expanded={!checkboxSelection && branch ? expanded : undefined}
              data-current={active?.item.id === item.id ? "true" : undefined} data-checked={checkboxSelection && checked ? "true" : undefined}
              style={{ paddingInlineStart: `${8 + Math.min(depth - 1, 12) * 13}px` }}
              onClick={checkboxSelection ? undefined : event => { list.current?.focus(); select(item.id, event.shiftKey || event.ctrlKey || event.metaKey); }}>
              {checkboxSelection ? <label className="outline-row-checkbox">
                <input type="checkbox" checked={checked} onFocus={() => setActiveId(item.id)} onChange={() => select(item.id, true)} />
                <span>{content}</span>
              </label> : content}
            </li>;
          })}
        </ul>
        {!visible.length && <p>{needle ? "No matching elements in this view." : "There are no elements in this view."}</p>}
        {visible.length < rows.length && <button className="button quiet" onClick={() => setLimit(current => current + pageSize)}>Show more</button>}
        {active && <div className="recovery-actions">
          <button type="button" className="button quiet" onClick={() => select(active.item.id, true)}>
            {selected.has(active.item.id) ? "Deselect current element" : "Select current element"}
          </button>
          {active.branch && !needle && <button type="button" className="button quiet" onClick={() => setExpanded(active.item.id, !active.expanded)}>
            {active.expanded ? "Collapse group" : "Expand group"}</button>}
          {canRename && active.item.kind === "node" && <button type="button" className="button quiet" onClick={() => onRename(active.item.id)}>Rename node</button>}
          <button type="button" className="button secondary" disabled={!active.item.source}
            onClick={() => { if (active.item.source) onSource(active.item.source); }}>Jump to source</button>
        </div>}
        {active && !active.item.source && <p className="muted-note">Meridian could not verify a unique source span for this element.</p>}
        {active && active.item.provenance.length > 0 && <section aria-label="Imported source">
          <h3>Imported source</h3>
          <ul>
            {active.item.provenance.map((record, index) => <li key={index} style={{ overflowWrap: "anywhere" }}>
              <strong>{record.relationship}</strong><br />
              <code>{record.virtualPath}#{record.pointer}</code><br />
              <small>{record.adapter} {record.adapterVersion}</small>
            </li>)}
          </ul>
        </section>}
      </div>
    </Modal>
  );
}
