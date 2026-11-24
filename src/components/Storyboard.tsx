import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, Check, ChevronDown, Copy, Film, Focus, Layers, Minus, Pause, Play, Plus, RotateCcw, Route, Search, SkipBack, SkipForward, Square, Trash2, Undo2, X } from 'lucide-react';
import type { RenderElement } from '../types/design';
import type { StoryboardState, StoryPlaybackAction, StoryPlaybackState, StoryScene } from '../types/storyboard';
import { createEmptyStoryboard, createScene, duplicateScene, expandStorySelection, missingStoryTargets, removeMissingStoryTargets, restoreMissingStoryTargets, storyboardDuration, type MissingStoryTargets } from '../lib/storyboard';
import '../storyboard.css';

export interface StoryboardProps {
  storyboard?: StoryboardState;
  elements: RenderElement[];
  selectedKey: string | null;
  selectedSceneId: string | null;
  onSelectScene: (id: string | null) => void;
  onChange: (storyboard: StoryboardState) => void;
  playback: StoryPlaybackState | null;
  onPlayback: (action: StoryPlaybackAction, value?: number) => void;
  disabledReason?: string;
  onShowCanvas?: () => void;
}

function timeLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function SelectionCheckbox({ checked, mixed, onChange, label }: { checked: boolean; mixed: boolean; onChange: (checked: boolean) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <input ref={input} type="checkbox" aria-label={label} checked={checked} aria-checked={mixed ? 'mixed' : checked} onChange={event => onChange(event.target.checked)} />;
}

/** Bounded, searchable rows; closed sections do not mount their target lists. */
const ElementPicker = memo(function ElementPicker({ elements, selected, onChange, label, canvasSelection, expandGroups = true }: {
  elements: RenderElement[];
  selected: string[];
  onChange: (keys: string[]) => void;
  label: string;
  canvasSelection?: RenderElement;
  expandGroups?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState('all');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [limit, setLimit] = useState(40);
  const [notice, setNotice] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const byKey = useMemo(() => new Map(elements.map(element => [element.key, element])), [elements]);
  const searchable = useMemo(() => elements.map(element => ({ element, text: `${element.label} ${element.sourceId}`.toLowerCase() })), [elements]);
  const matches = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return searchable.filter(({ element, text }) => (!query || text.includes(query)) && (kind === 'all' || element.kind === kind) && (!selectedOnly || selectedSet.has(element.key))).map(item => item.element);
  }, [searchable, filter, kind, selectedOnly, selectedSet]);
  const groupKeys = useMemo(() => {
    const expanded = new Map<string, string[]>();
    if (expandGroups) for (const element of matches.slice(0, limit)) if (element.kind === 'group') expanded.set(element.key, expandStorySelection(element.key, elements));
    return expanded;
  }, [matches, limit, elements, expandGroups]);
  const change = (keys: string[]) => {
    if (keys.length > 1500) { setNotice('Choose at most 1,500 targets. Narrow the search or select a smaller group.'); return; }
    setNotice(''); onChange(keys);
  };
  const toggle = (element: RenderElement, enabled: boolean) => {
    const keys = expandGroups && element.kind === 'group' ? (groupKeys.get(element.key) ?? expandStorySelection(element.key, elements)) : [element.key];
    const set = new Set(keys);
    change(enabled ? [...new Set([...selected, ...keys])] : selected.filter(key => !set.has(key)));
  };
  const availableSelection = canvasSelection && byKey.get(canvasSelection.key);
  const kinds = new Set(elements.map(element => element.kind));
  const presentSelected = selected.filter(key => byKey.has(key)).length;
  return <div className="sb-element-picker" role="group" aria-label={label}>
    {availableSelection && <button className="sb-canvas-selection" type="button" onClick={() => toggle(availableSelection, !selectedSet.has(availableSelection.key))}>
      {selectedSet.has(availableSelection.key) ? <Check size={14} /> : <Plus size={14} />}<span>{selectedSet.has(availableSelection.key) ? 'Remove' : 'Use'} <strong>{availableSelection.label || availableSelection.sourceId}</strong></span><small>canvas selection</small>
    </button>}
    {elements.length > 6 && <div className="sb-search"><Search size={14} /><input type="search" aria-label={`Search ${label.toLowerCase()}`} placeholder="Search by name or ID" value={filter} onChange={event => { setFilter(event.target.value); setLimit(40); }} /></div>}
    <div className="sb-picker-tools">
      <span>{presentSelected} selected</span>
      {kinds.size > 1 && <select aria-label={`Filter ${label.toLowerCase()} by type`} value={kind} onChange={event => { setKind(event.target.value); setLimit(40); }}><option value="all">All types</option>{kinds.has('node') && <option value="node">Nodes</option>}{kinds.has('group') && <option value="group">Groups</option>}{kinds.has('edge') && <option value="edge">Connectors</option>}</select>}
      <button type="button" className={selectedOnly ? 'is-active' : ''} aria-pressed={selectedOnly} onClick={() => { setSelectedOnly(!selectedOnly); setLimit(40); }}>Selected</button>
    </div>
    <div className="sb-element-list">
      {matches.slice(0, limit).map(element => {
        const keys = groupKeys.get(element.key) ?? [element.key];
        const count = keys.reduce((total, key) => total + Number(selectedSet.has(key)), 0);
        return <label key={element.key} className="sb-element-row">
          <SelectionCheckbox checked={count === keys.length} mixed={count > 0 && count < keys.length} label={element.label || element.sourceId} onChange={enabled => toggle(element, enabled)} />
          <span className={`sb-element-kind sb-kind-${element.kind}`} aria-hidden="true">{element.kind === 'edge' ? <Route size={14} /> : element.kind === 'group' ? <Layers size={14} /> : <Square size={13} />}</span>
          <span title={`${element.label} (${element.sourceId})`}>{element.label || element.sourceId}</span>
          {element.kind === 'group' && expandGroups && <small>+ members</small>}
        </label>;
      })}
      {!matches.length && <p className="sb-note">{filter || kind !== 'all' || selectedOnly ? 'No matching elements. Adjust the filters.' : 'This diagram has no selectable targets for this control.'}</p>}
    </div>
    {matches.length > limit && <button type="button" className="sb-more" onClick={() => setLimit(value => value + 40)}>Show {Math.min(40, matches.length - limit)} more <span>({matches.length - limit} remaining)</span></button>}
    <div className="sb-picker-actions"><button type="button" onClick={() => change([...new Set([...selected, ...matches.map(element => element.key)])])} disabled={!matches.length || matches.length > 1500}>Select {filter || kind !== 'all' ? 'results' : 'all'}</button><button type="button" onClick={() => onChange([])} disabled={!selected.length}>Clear selection</button></div>
    {notice && <p className="sb-note sb-warning" role="status">{notice}</p>}
  </div>;
});

function Section({ title, icon, summary, children, initialOpen = false }: { title: string; icon: React.ReactNode; summary: string; children: React.ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return <details className="sb-details" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{icon}<span>{title}</span><small>{summary}</small><ChevronDown size={15} /></summary>{open && <div className="sb-details-body">{children}</div>}</details>;
}

function TimingField({ id, label, value, min, max, step, presets, onCommit }: { id: string; label: string; value: number; min: number; max: number; step: number; presets: number[]; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const cancelling = useRef(false);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  const commit = (candidate: number) => {
    const next = Number.isFinite(candidate) ? Math.round(Math.max(min, Math.min(max, candidate)) * 100) / 100 : value;
    setDraft(String(next)); if (next !== value) onCommit(next);
  };
  return <div className="sb-timing-field">
    <div><label htmlFor={id}>{label}<small>seconds</small></label><div className="sb-stepper"><button type="button" aria-label={`Decrease ${label.toLowerCase()}`} disabled={value <= min} onClick={() => commit(value - step)}><Minus size={14} /></button><input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={draft} onFocus={() => setEditing(true)} onChange={event => setDraft(event.target.value)} onBlur={() => { setEditing(false); if (cancelling.current) { cancelling.current = false; setDraft(String(value)); } else commit(draft.trim() ? Number(draft) : NaN); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelling.current = true; event.stopPropagation(); event.currentTarget.blur(); } }} /><button type="button" aria-label={`Increase ${label.toLowerCase()}`} disabled={value >= max} onClick={() => commit(value + step)}><Plus size={14} /></button></div></div>
    <div className="sb-timing-presets">{presets.filter(preset => preset <= max).map(preset => <button key={preset} type="button" aria-label={`Set ${label.toLowerCase()} to ${preset} seconds`} aria-pressed={value === preset} onClick={() => commit(preset)}>{preset === 0 ? 'No transition' : `${preset}s`}</button>)}</div>
  </div>;
}

type EditorProps = {
  scene: StoryScene; index: number; count: number; elements: RenderElement[]; selectedElement?: RenderElement;
  playing: boolean; disabledReason?: string;
  onPatch: (patch: Partial<StoryScene>) => void; onMove: (offset: number) => void; onDuplicate: () => void; onDelete: () => void; onPreview: () => void; onPause: () => void; onCleanMissing: () => void;
};

const SceneEditor = memo(function SceneEditor({ scene, index, count, elements, selectedElement, playing, disabledReason, onPatch, onMove, onDuplicate, onDelete, onPreview, onPause, onCleanMissing }: EditorProps) {
  const id = useId();
  const available = useMemo(() => new Set(elements.map(element => element.key)), [elements]);
  const missing = useMemo(() => missingStoryTargets(scene, available), [scene, available]);
  const edges = useMemo(() => elements.filter(element => element.kind === 'edge'), [elements]);
  const [targetNotice, setTargetNotice] = useState('');
  const visible = useMemo(() => scene.visible === null ? null : new Set(scene.visible), [scene.visible]);
  const invisibleHighlights = visible === null ? 0 : scene.highlight.filter(key => available.has(key) && !visible.has(key)).length;
  const invisibleFlow = visible === null ? 0 : scene.flow.filter(key => available.has(key) && !visible.has(key)).length;
  const revealChosen = (keys: string[]) => {
    const visible = scene.visible === null ? null : [...new Set([...scene.visible, ...keys])];
    if (visible && visible.length > 1500) { setTargetNotice('This would exceed 1,500 visible targets. Show the full diagram or choose fewer elements.'); return; }
    setTargetNotice(''); onPatch({ visible });
  };
  return <div className="sb-editor">
    <div className="sb-edit-heading"><span>EDIT SCENE {index + 1}</span><div>
      <button className="sb-icon" type="button" onClick={() => onMove(-1)} disabled={playing || index === 0} aria-label="Move scene earlier" title="Move earlier"><ArrowUp size={16} /></button>
      <button className="sb-icon" type="button" onClick={() => onMove(1)} disabled={playing || index >= count - 1} aria-label="Move scene later" title="Move later"><ArrowDown size={16} /></button>
      <button className="sb-icon" type="button" onClick={onDuplicate} disabled={playing || count >= 50} aria-label="Duplicate scene" title="Duplicate scene"><Copy size={16} /></button>
      <button className="sb-icon sb-delete" type="button" onClick={onDelete} disabled={playing} aria-label="Delete scene" title="Delete scene"><Trash2 size={16} /></button>
    </div></div>
    {playing && <div className="sb-edit-paused"><span>Pause playback to edit this scene.</span><button type="button" onClick={onPause}><Pause size={13} />Pause to edit</button></div>}
    <fieldset className="sb-fieldset" disabled={playing}>
      <label className="sb-field" htmlFor={`${id}-title`}>Scene title<input id={`${id}-title`} type="text" maxLength={120} value={scene.title} onChange={event => onPatch({ title: event.target.value })} placeholder={`Scene ${index + 1}`} /></label>
      <button type="button" className="sb-preview-scene" aria-label="Preview this scene" onClick={onPreview} disabled={!!disabledReason}><Play size={14} />Preview this scene<span>Show its finished view</span></button>
      <label className="sb-field">Presenter notes<textarea className="notes-editor" rows={2} maxLength={2000} value={scene.notes ?? ""} onChange={event => onPatch({ notes: event.target.value })}/></label>
      <Section title="Timing" icon={<RotateCcw size={15} />} summary={`${scene.duration}s · ${scene.transition ? `${scene.transition}s entrance` : 'Cut'}`} initialOpen>
        <TimingField id={`${id}-duration`} label="Duration" value={scene.duration} min={0.5} max={120} step={0.5} presets={[3, 5, 10]} onCommit={value => onPatch({ duration: value, transition: Math.min(scene.transition, value) })} />
        <TimingField id={`${id}-transition`} label="Transition" value={scene.transition} min={0} max={Math.min(10, scene.duration)} step={0.1} presets={[0, 0.3, 0.7, 1.2]} onCommit={value => onPatch({ transition: value })} />
        <label className="sb-field" htmlFor={`${id}-easing`}>Camera and entrance movement<select id={`${id}-easing`} value={scene.easing} onChange={event => onPatch({ easing: event.target.value as StoryScene['easing'] })}><option value="ease-in-out">Smooth start and finish</option><option value="ease-out">Quick start, gentle finish</option><option value="linear">Steady pace</option></select></label>
        <p className="sb-note">Duration includes the entrance. Play shows the transition; Preview shows the finished scene.</p>
      </Section>
      {!!missing.keys.length && <div className="sb-missing" role="status"><strong>{missing.keys.length} missing {missing.keys.length === 1 ? 'target' : 'targets'}</strong><p>These IDs are no longer in the rendered source. Keep them to restore later, or remove their scene references.</p><details><summary>Review missing IDs</summary><ul>{missing.keys.slice(0, 12).map(key => <li key={key}>{key}</li>)}</ul>{missing.keys.length > 12 && <small>And {missing.keys.length - 12} more.</small>}</details><button type="button" onClick={onCleanMissing} disabled={!!disabledReason}>Remove missing targets</button></div>}
      <fieldset className="sb-fieldset" disabled={!!disabledReason}>
        <Section title="Visible elements" icon={<Layers size={15} />} summary={scene.visible === null ? 'Full diagram' : `${scene.visible.length} chosen`} initialOpen>
          <p className="sb-note sb-note-first">Choose what appears in this scene. Other scene controls only affect elements that are visible.</p>
          <div className="sb-choices" role="group" aria-label="Scene visibility"><button type="button" aria-pressed={scene.visible === null} onClick={() => onPatch({ visible: null })}>Full diagram</button><button type="button" aria-pressed={scene.visible !== null} onClick={() => onPatch({ visible: scene.visible ?? [] })}>Choose elements</button></div>
          {scene.visible !== null && <ElementPicker elements={elements} selected={scene.visible} onChange={visible => onPatch({ visible })} label="Visible elements" canvasSelection={selectedElement} />}
          <label className="sb-field sb-field-spaced" htmlFor={`${id}-reveal`}>Entrance order<select id={`${id}-reveal`} value={scene.reveal} onChange={event => onPatch({ reveal: event.target.value as StoryScene['reveal'] })}><option value="together">Reveal together</option><option value="sequence">Reveal one by one</option></select></label>
          {scene.visible?.length === 0 && <p className="sb-note sb-warning">This scene is empty. Choose an element above or show the full diagram.</p>}
        </Section>
        <Section title="Camera" icon={<Camera size={15} />} summary={scene.camera.mode === 'fit' ? 'Full view' : `${scene.camera.keys.length} targets`}>
          <p className="sb-note sb-note-first">Framing changes the view without hiding elements. Choose a node or group to move the camera toward it.</p>
          <div className="sb-choices" role="group" aria-label="Scene camera"><button type="button" aria-pressed={scene.camera.mode === 'fit'} onClick={() => onPatch({ camera: { ...scene.camera, mode: 'fit' } })}>Fit diagram</button><button type="button" aria-pressed={scene.camera.mode === 'elements'} onClick={() => onPatch({ camera: { ...scene.camera, mode: 'elements', keys: scene.camera.keys.length ? scene.camera.keys : selectedElement ? [selectedElement.key] : [] } })}>Focus region</button></div>
          {scene.camera.mode === 'elements' && <><ElementPicker elements={elements} selected={scene.camera.keys} onChange={keys => onPatch({ camera: { ...scene.camera, keys } })} label="Camera targets" canvasSelection={selectedElement} expandGroups={false} /><label className="sb-range-field">Space around the focus <output>{scene.camera.padding}px</output><input type="range" min="8" max="240" step="4" value={scene.camera.padding} onChange={event => onPatch({ camera: { ...scene.camera, padding: Number(event.target.value) } })} /></label>{!scene.camera.keys.some(key => available.has(key)) && <p className="sb-note sb-warning">Choose a camera target. Until then, the full diagram is shown.</p>}</>}
        </Section>
        <Section title="Spotlight" icon={<Focus size={15} />} summary={scene.highlight.length ? `${scene.highlight.length} bright` : 'Off'}>
          <p className="sb-note sb-note-first">Keep these visible elements bright and dim the others. Spotlight does not hide anything or move the camera.</p>
          <ElementPicker elements={elements} selected={scene.highlight} onChange={highlight => onPatch({ highlight })} label="Spotlight elements" canvasSelection={selectedElement} />
          {!!invisibleHighlights && <p className="sb-note sb-warning">{invisibleHighlights} spotlight {invisibleHighlights === 1 ? 'target is' : 'targets are'} hidden. <button type="button" className="sb-inline-action" onClick={() => revealChosen(scene.highlight)}>Make them visible</button></p>}
        </Section>
        <Section title="Connector flow" icon={<Route size={15} />} summary={scene.flow.length ? `${scene.flow.length} paths` : 'Off'}>
          <p className="sb-note sb-note-first">Animate directional flow along these visible connectors. Flow stays still while paused and is hidden with reduced motion.</p>
          <ElementPicker elements={edges} selected={scene.flow} onChange={flow => onPatch({ flow })} label="Flow connectors" canvasSelection={selectedElement} expandGroups={false} />
          {!!invisibleFlow && <p className="sb-note sb-warning">{invisibleFlow} chosen {invisibleFlow === 1 ? 'connector is' : 'connectors are'} hidden. <button type="button" className="sb-inline-action" onClick={() => revealChosen(scene.flow)}>Make them visible</button></p>}
        </Section>
      </fieldset>
      {targetNotice && <p className="sb-note sb-warning" role="status">{targetNotice}</p>}
    </fieldset>
    <p className="sb-footer-note">Scenes stay with the project. Export HTML for a portable presentation with these same controls and motion preferences.</p>
  </div>;
});

type UndoAction = { kind: 'delete'; scene: StoryScene; index: number } | { kind: 'targets'; sceneId: string; targets: MissingStoryTargets };

export default function Storyboard({ storyboard, elements, selectedKey, selectedSceneId, onSelectScene, onChange, playback, onPlayback, disabledReason, onShowCanvas }: StoryboardProps) {
  const empty = useMemo(createEmptyStoryboard, []);
  const story = storyboard ?? empty;
  const activeIndex = Math.max(0, story.scenes.findIndex(scene => scene.id === selectedSceneId));
  const scene = story.scenes[activeIndex];
  const selectedElement = useMemo(() => elements.find(element => element.key === selectedKey), [elements, selectedKey]);
  const available = useMemo(() => new Set(elements.map(element => element.key)), [elements]);
  const duration = useMemo(() => storyboardDuration(story), [story]);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const pendingPreview = useRef<string | null>(null);
  const actions = useRef({ onSelectScene, onChange, onPlayback, onShowCanvas, playback, disabledReason });
  actions.current = { onSelectScene, onChange, onPlayback, onShowCanvas, playback, disabledReason };
  const previewedSceneId = playback ? story.scenes[playback.sceneIndex]?.id : undefined;
  // Follow navigation and scrubbing, not each playback frame or field keystroke.
  useEffect(() => {
    if (previewedSceneId && !pendingPreview.current) actions.current.onSelectScene(previewedSceneId);
  }, [previewedSceneId]);
  useEffect(() => {
    const index = story.scenes.findIndex(item => item.id === pendingPreview.current);
    if (index >= 0 && !disabledReason) { pendingPreview.current = null; actions.current.onPlayback('preview', index); }
  }, [story, disabledReason]);
  const publish = useCallback((next: StoryboardState, previewId?: string) => {
    if (previewId) pendingPreview.current = previewId;
    actions.current.onChange(next);
  }, []);
  const patchScene = useCallback((patch: Partial<StoryScene>) => {
    if (!scene) return;
    publish({ ...story, scenes: story.scenes.map(item => item.id === scene.id ? { ...item, ...patch } : item) }, actions.current.playback ? scene.id : undefined);
  }, [scene, story, publish]);
  const select = useCallback((index: number, showCanvas = false) => {
    const target = story.scenes[index]; if (!target) return;
    actions.current.onSelectScene(target.id);
    if (!actions.current.disabledReason) { actions.current.onPlayback('preview', index); if (showCanvas) actions.current.onShowCanvas?.(); }
  }, [story]);
  const add = useCallback(() => {
    if (story.scenes.length >= 50) return;
    const next = createScene(story.scenes.length, story.scenes[story.scenes.length - 1]);
    publish({ ...story, scenes: [...story.scenes, next] }, next.id); actions.current.onSelectScene(next.id);
  }, [story, publish]);
  function addFromSelection() {
    if (!selectedElement || disabledReason || story.scenes.length >= 50) return;
    const members = new Set(expandStorySelection(selectedElement.key, elements));
    const keys = new Set(members);
    const flow: string[] = [];
    for (const edge of elements) {
      if (edge.kind !== 'edge' || !(members.has(edge.key) || members.has(edge.from ?? '') || members.has(edge.to ?? ''))) continue;
      keys.add(edge.key);
      if (edge.from) keys.add(edge.from);
      if (edge.to) keys.add(edge.to);
      flow.push(edge.key);
    }
    const visible = [...keys].slice(0, 1500);
    const included = new Set(visible);
    const next: StoryScene = { ...createScene(story.scenes.length), title: selectedElement.label.slice(0, 120),
      visible, highlight: [selectedElement.key], flow: flow.filter(key => included.has(key)), camera: { mode: 'elements', keys: visible, padding: 40 } };
    publish({ ...story, scenes: [...story.scenes, next] }, next.id);
    actions.current.onSelectScene(next.id);
  }
  const duplicate = useCallback(() => {
    if (!scene || story.scenes.length >= 50) return;
    const next = duplicateScene(scene); const scenes = [...story.scenes]; scenes.splice(activeIndex + 1, 0, next);
    publish({ ...story, scenes }, next.id); actions.current.onSelectScene(next.id);
  }, [scene, story, activeIndex, publish]);
  const remove = useCallback(() => {
    if (!scene) return;
    setUndo({ kind: 'delete', scene, index: activeIndex });
    const scenes = story.scenes.filter(item => item.id !== scene.id);
    const next = scenes[Math.min(activeIndex, scenes.length - 1)];
    actions.current.onPlayback('stop'); publish({ ...story, scenes }, next?.id); actions.current.onSelectScene(next?.id ?? null);
  }, [scene, story, activeIndex, publish]);
  const move = useCallback((offset: number) => {
    const destination = activeIndex + offset;
    if (!scene || destination < 0 || destination >= story.scenes.length) return;
    const scenes = [...story.scenes]; scenes.splice(activeIndex, 1); scenes.splice(destination, 0, scene);
    publish({ ...story, scenes }, scene.id);
  }, [scene, story, activeIndex, publish]);
  const cleanMissing = useCallback(() => {
    if (!scene || actions.current.disabledReason) return;
    const targets = missingStoryTargets(scene, available); if (!targets.keys.length) return;
    setUndo({ kind: 'targets', sceneId: scene.id, targets });
    publish({ ...story, scenes: story.scenes.map(item => item.id === scene.id ? removeMissingStoryTargets(item, available) : item) }, scene.id);
  }, [scene, story, available, publish]);
  const restore = () => {
    if (!undo) return;
    if (undo.kind === 'delete') {
      if (story.scenes.some(item => item.id === undo.scene.id)) { setUndo(null); return; }
      if (story.scenes.length >= 50) return;
      const scenes = [...story.scenes]; scenes.splice(Math.min(undo.index, scenes.length), 0, undo.scene);
      publish({ ...story, scenes }, undo.scene.id); actions.current.onSelectScene(undo.scene.id);
    } else {
      publish({ ...story, scenes: story.scenes.map(item => item.id === undo.sceneId ? restoreMissingStoryTargets(item, undo.targets) : item) }, undo.sceneId);
      actions.current.onSelectScene(undo.sceneId);
    }
    setUndo(null);
  };
  const previewActive = useCallback(() => select(activeIndex, true), [select, activeIndex]);
  const pause = useCallback(() => actions.current.onPlayback('pause'), []);
  const currentIndex = playback?.sceneIndex ?? 0;
  const current = playback ? story.scenes[playback.sceneIndex] : undefined;
  const controlsDisabled = !story.scenes.length || !!disabledReason;
  return <section className="sb-storyboard" aria-label="Presentation storyboard">
    <header className="sb-heading"><div><Film size={17} /><strong>Storyboard</strong><span>{story.scenes.length}/50</span></div>{!!story.scenes.length && <button type="button" className="sb-add" onClick={add} disabled={story.scenes.length >= 50 || playback?.playing} aria-label="Add scene"><Plus size={15} />Add scene</button>}</header>
    {selectedElement && <button type="button" className="button secondary" disabled={!!disabledReason || story.scenes.length >= 50 || playback?.playing}
      onClick={addFromSelection}><Focus size={15}/>Scene from selected neighborhood</button>}
    {disabledReason && <p className="sb-disabled-note" role="status">{disabledReason} Scene names and timing can still be edited.</p>}
    {!!story.scenes.length && <div className="sb-playback">
      <div className="sb-now"><span>{playback?.playing ? 'PLAYING' : playback?.preview ? 'PREVIEW' : playback ? 'PAUSED' : 'DIAGRAM VIEW'}</span><strong>{current?.title || (current ? `Scene ${currentIndex + 1}` : 'Choose a scene to preview')}</strong></div>
      <div className="sb-transport" role="group" aria-label="Storyboard playback">
        <button type="button" className="sb-icon" aria-label="Restart storyboard" title="Play from the beginning" disabled={controlsDisabled} onClick={() => onPlayback('restart')}><RotateCcw size={16} /></button>
        <button type="button" className="sb-icon" aria-label="Previous scene" title="Previous scene" disabled={controlsDisabled || currentIndex <= 0} onClick={() => onPlayback('previous')}><SkipBack size={16} /></button>
        <button type="button" className="sb-play" aria-label={playback?.playing ? 'Pause storyboard' : 'Play storyboard'} disabled={controlsDisabled} onClick={() => onPlayback(playback?.playing ? 'pause' : 'play')}>{playback?.playing ? <Pause size={16} /> : <Play size={16} />}<span>{playback?.playing ? 'Pause' : 'Play'}</span></button>
        <button type="button" className="sb-icon" aria-label="Next scene" title="Next scene" disabled={controlsDisabled || currentIndex >= story.scenes.length - 1} onClick={() => onPlayback('next')}><SkipForward size={16} /></button>
        <button type="button" className="sb-icon" aria-label="End storyboard preview" title="Return to the full diagram" disabled={!playback} onClick={() => onPlayback('stop')}><Square size={15} /></button>
      </div>
      <div className="sb-time"><span>{playback?.preview ? `Scene ${currentIndex + 1}` : timeLabel(playback?.time || 0)}<small> / {timeLabel(duration)}</small></span><label><input type="checkbox" checked={story.loop} onChange={event => onChange({ ...story, loop: event.target.checked })} />Loop</label></div>
      <input className="sb-scrubber" type="range" min="0" max={duration || 1} step="0.05" value={playback?.time || 0} disabled={controlsDisabled} onChange={event => onPlayback('seek', Number(event.target.value))} aria-label="Storyboard playhead" aria-valuetext={playback?.preview ? `Preview of scene ${currentIndex + 1}` : `${timeLabel(playback?.time || 0)} of ${timeLabel(duration)}`} />
      <div className="sb-time-track" aria-label="Scene sequence">{story.scenes.map((item, index) => <button key={item.id} type="button" style={{ flexGrow: item.duration }} className={playback?.sceneIndex === index ? 'is-playing' : item.id === scene?.id ? 'is-selected' : ''} title={`${item.title}: ${item.duration} seconds`} aria-label={`Preview ${item.title || `scene ${index + 1}`}`} disabled={!!disabledReason} onClick={() => select(index)}>{index + 1}</button>)}</div>
    </div>}
    <div className="sb-scroll">
      {undo && <div className="sb-undo" role="status"><span>{undo.kind === 'delete' ? `Removed “${undo.scene.title || 'Untitled scene'}”.` : 'Removed missing targets.'}</span><button type="button" onClick={restore} disabled={undo.kind === 'delete' && story.scenes.length >= 50}><Undo2 size={14} />Undo</button><button type="button" className="sb-icon" aria-label="Dismiss undo notice" onClick={() => setUndo(null)}><X size={14} /></button></div>}
      {!scene ? <div className="sb-empty"><span className="sb-empty-mark"><Film size={26} /></span><h3>Tell the story in steps.</h3><p>Start with a full view, then duplicate it to reveal more, focus the camera, or follow a connector.</p><button className="sb-primary" type="button" onClick={add}><Plus size={16} />Create first scene</button><span>Your diagram source stays unchanged.</span></div> : <>
        <div className="sb-scenes" role="group" aria-label="Scenes">{story.scenes.map((item, index) => <button type="button" key={item.id} className={`sb-scene ${item.id === scene.id ? 'is-active' : ''}`} aria-pressed={item.id === scene.id} onClick={() => select(index)}>
          <span className="sb-scene-number">{String(index + 1).padStart(2, '0')}</span><span className="sb-scene-copy"><strong>{item.title || `Scene ${index + 1}`}</strong><small>{item.visible === null ? 'Full diagram' : `${item.visible.length} visible`}{item.camera.mode === 'elements' ? ' · Focused camera' : ''}</small></span><span className="sb-scene-duration">{item.duration}s</span>
        </button>)}</div>
        <SceneEditor scene={scene} index={activeIndex} count={story.scenes.length} elements={elements} selectedElement={selectedElement} playing={!!playback?.playing} disabledReason={disabledReason} onPatch={patchScene} onMove={move} onDuplicate={duplicate} onDelete={remove} onPreview={previewActive} onPause={pause} onCleanMissing={cleanMissing} />
      </>}
    </div>
  </section>;
}
