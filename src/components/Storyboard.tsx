import { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, Check, ChevronDown, Copy, Film, Focus, Layers, MousePointer2, Pause, Play, Plus, RotateCcw, Route, SkipBack, SkipForward, Square, Trash2 } from 'lucide-react';
import type { RenderElement } from '../types/design';
import type { StoryboardState, StoryPlaybackAction, StoryPlaybackState, StoryScene } from '../types/storyboard';
import { createEmptyStoryboard, createScene, duplicateScene, expandStorySelection, sceneStartTime, storyboardDuration } from '../lib/storyboard';
import '../storyboard.css';

export interface StoryboardProps {
  storyboard?: StoryboardState;
  elements: RenderElement[];
  selectedKey: string | null;
  selectedSceneId: string | null;
  onSelectScene: (id: string | null) => void;
  onChange: (storyboard: StoryboardState) => void;
  playback: StoryPlaybackState | null;
  onPlayback: (action: StoryPlaybackAction, time?: number) => void;
}

function timeLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function ElementPicker({ elements, selected, onChange, label, emptyMessage, canvasSelection }: {
  elements: RenderElement[];
  selected: string[];
  onChange: (keys: string[]) => void;
  label: string;
  emptyMessage: string;
  canvasSelection: RenderElement | undefined;
}) {
  const [filter, setFilter] = useState('');
  const selectedSet = new Set(selected);
  const matches = elements.filter(element => `${element.label} ${element.sourceId}`.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (element: RenderElement, enabled: boolean) => {
    const keys = expandStorySelection(element.key, elements);
    onChange(enabled ? [...new Set([...selected, ...keys])] : selected.filter(key => !keys.includes(key)));
  };
  const availableSelection = canvasSelection && elements.find(element => element.key === canvasSelection.key);
  return <div className="sb-element-picker" role="group" aria-label={label}>
    <div className="sb-picker-tools">
      <span>{selected.length} selected</span>
      <button type="button" onClick={() => onChange(elements.map(element => element.key))} disabled={!elements.length}>All</button>
      <button type="button" onClick={() => onChange([])} disabled={!selected.length}>None</button>
    </div>
    {availableSelection && <button className="sb-canvas-selection" type="button" onClick={() => toggle(availableSelection, !selectedSet.has(availableSelection.key))}>
      {selectedSet.has(availableSelection.key) ? <Check size={13} /> : <Plus size={13} />}<span>{selectedSet.has(availableSelection.key) ? 'Remove' : 'Add'} canvas selection</span>
    </button>}
    {elements.length > 7 && <input type="search" aria-label={`Filter ${label.toLowerCase()}`} placeholder="Find an element…" value={filter} onChange={event => setFilter(event.target.value)} />}
    <div className="sb-element-list">
      {matches.length ? matches.map(element => <label key={element.key} className="sb-element-row">
        <input type="checkbox" checked={selectedSet.has(element.key)} onChange={event => toggle(element, event.target.checked)} />
        <span className={`sb-element-kind sb-kind-${element.kind}`} aria-hidden="true">{element.kind === 'edge' ? <Route size={12} /> : element.kind === 'group' ? <Layers size={12} /> : <Square size={11} />}</span>
        <span title={element.label}>{element.label || element.sourceId}</span>
      </label>) : <p className="sb-note">{filter ? 'No matching elements.' : emptyMessage}</p>}
    </div>
    {selected.some(key => !elements.some(element => element.key === key)) && <p className="sb-note sb-warning">Some saved targets are absent from this diagram. They remain saved if you restore the source.</p>}
  </div>;
}

export default function Storyboard({ storyboard, elements, selectedKey, selectedSceneId, onSelectScene, onChange, playback, onPlayback }: StoryboardProps) {
  const story = storyboard ?? createEmptyStoryboard();
  const activeIndex = Math.max(0, story.scenes.findIndex(scene => scene.id === selectedSceneId));
  const scene = story.scenes[activeIndex];
  const selectedElement = elements.find(element => element.key === selectedKey);
  const edges = useMemo(() => elements.filter(element => element.kind === 'edge'), [elements]);
  const duration = storyboardDuration(story);
  const id = useId();
  const patchScene = (patch: Partial<StoryScene>) => {
    if (!scene) return;
    onChange({ ...story, scenes: story.scenes.map(item => item.id === scene.id ? { ...item, ...patch } : item) });
  };
  const add = () => {
    if (story.scenes.length >= 50) return;
    const next = createScene(story.scenes.length, story.scenes[story.scenes.length - 1]);
    onChange({ ...story, scenes: [...story.scenes, next] }); onSelectScene(next.id);
  };
  const duplicate = () => {
    if (!scene || story.scenes.length >= 50) return;
    const next = duplicateScene(scene);
    const scenes = [...story.scenes]; scenes.splice(activeIndex + 1, 0, next);
    onChange({ ...story, scenes }); onSelectScene(next.id);
  };
  const remove = () => {
    if (!scene) return;
    const scenes = story.scenes.filter(item => item.id !== scene.id);
    onPlayback('stop'); onChange({ ...story, scenes }); onSelectScene(scenes[Math.min(activeIndex, scenes.length - 1)]?.id ?? null);
  };
  const move = (offset: number) => {
    const destination = activeIndex + offset;
    if (!scene || destination < 0 || destination >= story.scenes.length) return;
    const scenes = [...story.scenes]; scenes.splice(activeIndex, 1); scenes.splice(destination, 0, scene);
    onChange({ ...story, scenes });
  };
  const preview = (index: number) => {
    const target = story.scenes[index]; if (!target) return;
    onSelectScene(target.id);
    // A scene preview lands after its entrance, while Play demonstrates the transition.
    onPlayback('seek', Math.min(sceneStartTime(story, index) + Math.max(target.transition, target.reveal === 'sequence' ? target.duration * 0.75 : 0), sceneStartTime(story, index) + target.duration - 0.01));
  };
  const addCanvasSelection = () => {
    if (!scene || !selectedElement) return;
    const selection = expandStorySelection(selectedElement.key, elements);
    patchScene({ visible: [...new Set([...(scene.visible || []), ...selection])] });
  };
  return <section className="sb-storyboard" aria-label="Presentation storyboard">
    <header className="sb-heading"><div><Film size={16} /><strong>Storyboard</strong><span>{story.scenes.length}/50</span></div><button type="button" className="sb-icon" onClick={add} disabled={story.scenes.length >= 50} aria-label="Add scene" title="Add scene"><Plus size={17} /></button></header>
    <div className="sb-playback">
      <div className="sb-transport" role="group" aria-label="Storyboard playback">
        <button type="button" className="sb-icon" aria-label="Restart storyboard" title="Restart" disabled={!story.scenes.length} onClick={() => onPlayback('restart')}><RotateCcw size={15} /></button>
        <button type="button" className="sb-icon" aria-label="Previous scene" title="Previous scene" disabled={!story.scenes.length} onClick={() => onPlayback('previous')}><SkipBack size={15} /></button>
        <button type="button" className="sb-play" aria-label={playback?.playing ? 'Pause storyboard' : 'Play storyboard'} disabled={!story.scenes.length} onClick={() => onPlayback(playback?.playing ? 'pause' : 'play')}>{playback?.playing ? <Pause size={16} /> : <Play size={16} />}<span>{playback?.playing ? 'Pause' : 'Play'}</span></button>
        <button type="button" className="sb-icon" aria-label="Next scene" title="Next scene" disabled={!story.scenes.length} onClick={() => onPlayback('next')}><SkipForward size={15} /></button>
        <button type="button" className="sb-icon" aria-label="End storyboard preview" title="Return to full diagram" disabled={!playback} onClick={() => onPlayback('stop')}><Square size={14} /></button>
      </div>
      <div className="sb-time"><span>{timeLabel(playback?.time || 0)}<small> / {timeLabel(duration)}</small></span><label><input type="checkbox" checked={story.loop} onChange={event => onChange({ ...story, loop: event.target.checked })} />Loop</label></div>
      <input className="sb-scrubber" type="range" min="0" max={duration || 1} step="0.05" value={playback?.time || 0} disabled={!story.scenes.length} onChange={event => onPlayback('seek', Number(event.target.value))} aria-label="Storyboard playhead" aria-valuetext={`${timeLabel(playback?.time || 0)} of ${timeLabel(duration)}`} />
      {!!story.scenes.length && <div className="sb-time-track" aria-label="Scene sequence">{story.scenes.map((item, index) => <button key={item.id} type="button" style={{ flexGrow: item.duration }} className={playback?.sceneIndex === index ? 'is-playing' : item.id === scene?.id ? 'is-selected' : ''} title={`${item.title}: ${item.duration} seconds`} aria-label={`Preview ${item.title}`} onClick={() => preview(index)}>{index + 1}</button>)}</div>}
    </div>
    <div className="sb-scroll">
      {!scene ? <div className="sb-empty"><span className="sb-empty-mark"><Film size={25} /></span><h3>Give your diagram a story.</h3><p>Build a sequence of views. Reveal the important parts, follow a connection, and guide the camera as you explain.</p><button className="sb-primary" type="button" onClick={add}><Plus size={15} />Create first scene</button><span>One diagram. As many as 50 scenes.</span></div> : <>
        <div className="sb-scenes" role="group" aria-label="Scenes">
          {story.scenes.map((item, index) => <button type="button" key={item.id} className={`sb-scene ${item.id === scene.id ? 'is-active' : ''}`} aria-pressed={item.id === scene.id} onClick={() => { onSelectScene(item.id); if (playback) preview(index); }}>
            <span className="sb-scene-number">{String(index + 1).padStart(2, '0')}</span><span className="sb-scene-copy"><strong>{item.title || `Scene ${index + 1}`}</strong><small>{item.visible === null ? 'Full diagram' : `${item.visible.length} elements`}{item.camera.mode === 'elements' ? ' · Focused view' : ''}</small></span><span className="sb-scene-duration">{item.duration}s</span>
          </button>)}
        </div>
        <button className="sb-add-scene" type="button" onClick={add} disabled={story.scenes.length >= 50}><Plus size={14} />Add scene</button>
        <div className="sb-edit-heading"><span>EDIT SCENE {activeIndex + 1}</span><div>
          <button className="sb-icon" type="button" onClick={() => move(-1)} disabled={activeIndex === 0} aria-label="Move scene earlier" title="Move earlier"><ArrowUp size={14} /></button>
          <button className="sb-icon" type="button" onClick={() => move(1)} disabled={activeIndex >= story.scenes.length - 1} aria-label="Move scene later" title="Move later"><ArrowDown size={14} /></button>
          <button className="sb-icon" type="button" onClick={duplicate} disabled={story.scenes.length >= 50} aria-label="Duplicate scene" title="Duplicate scene"><Copy size={14} /></button>
          <button className="sb-icon sb-delete" type="button" onClick={remove} aria-label="Delete scene" title="Delete scene"><Trash2 size={14} /></button>
        </div></div>
        <label className="sb-field" htmlFor={`${id}-title`}>Scene title<input id={`${id}-title`} type="text" maxLength={120} value={scene.title} onChange={event => patchScene({ title: event.target.value })} placeholder={`Scene ${activeIndex + 1}`} /></label>
        <div className="sb-two-fields">
          <label className="sb-field" htmlFor={`${id}-duration`}>Duration <small>seconds</small><input id={`${id}-duration`} type="number" min="0.5" max="120" step="0.5" value={scene.duration} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) patchScene({ duration: Math.max(0.5, Math.min(120, value)), transition: Math.min(scene.transition, Math.max(0.5, value)) }); }} /></label>
          <label className="sb-field" htmlFor={`${id}-transition`}>Transition <small>seconds</small><input id={`${id}-transition`} type="number" min="0" max={Math.min(10, scene.duration)} step="0.1" value={scene.transition} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) patchScene({ transition: Math.max(0, Math.min(10, scene.duration, value)) }); }} /></label>
        </div>
        <label className="sb-field" htmlFor={`${id}-easing`}>Movement<select id={`${id}-easing`} value={scene.easing} onChange={event => patchScene({ easing: event.target.value as StoryScene['easing'] })}><option value="ease-in-out">Smooth start and finish</option><option value="ease-out">Quick start, gentle finish</option><option value="linear">Steady pace</option></select></label>
        <button type="button" className="sb-preview-scene" onClick={() => preview(activeIndex)}><Play size={13} />Preview this scene</button>

        <details className="sb-details" open><summary><Layers size={14} /><span>Reveal elements</span><ChevronDown size={14} /></summary><div className="sb-details-body">
          <div className="sb-choices" role="group" aria-label="Scene visibility"><button type="button" aria-pressed={scene.visible === null} onClick={() => patchScene({ visible: null })}>Full diagram</button><button type="button" aria-pressed={scene.visible !== null} onClick={() => patchScene({ visible: scene.visible ?? [] })}>Choose elements</button></div>
          {scene.visible !== null && <>
            {selectedElement && <button type="button" className="sb-canvas-selection" onClick={addCanvasSelection}><MousePointer2 size={13} />Add selected {selectedElement.kind}</button>}
            <ElementPicker elements={elements} selected={scene.visible} onChange={visible => patchScene({ visible })} label="Visible elements" emptyMessage="Render a supported diagram to choose its elements." canvasSelection={undefined} />
          </>}
          <label className="sb-field sb-field-spaced" htmlFor={`${id}-reveal`}>Entrance order<select id={`${id}-reveal`} value={scene.reveal} onChange={event => patchScene({ reveal: event.target.value as StoryScene['reveal'] })}><option value="together">Reveal together</option><option value="sequence">Reveal one by one</option></select></label>
          <p className="sb-note">Duplicate a scene, then add elements to build a progressive reveal. Existing elements remain visible between scenes.</p>
        </div></details>
        <details className="sb-details"><summary><Camera size={14} /><span>Camera</span><small>{scene.camera.mode === 'fit' ? 'Full view' : `${scene.camera.keys.length} targets`}</small><ChevronDown size={14} /></summary><div className="sb-details-body">
          <div className="sb-choices" role="group" aria-label="Scene camera"><button type="button" aria-pressed={scene.camera.mode === 'fit'} onClick={() => patchScene({ camera: { ...scene.camera, mode: 'fit' } })}>Fit diagram</button><button type="button" aria-pressed={scene.camera.mode === 'elements'} onClick={() => patchScene({ camera: { ...scene.camera, mode: 'elements', keys: scene.camera.keys.length ? scene.camera.keys : selectedKey ? [selectedKey] : [] } })}>Focus region</button></div>
          {scene.camera.mode === 'elements' && <><ElementPicker elements={elements} selected={scene.camera.keys} onChange={keys => patchScene({ camera: { ...scene.camera, keys } })} label="Camera targets" emptyMessage="Choose a diagram with selectable elements." canvasSelection={selectedElement} /><label className="sb-range-field">Breathing room <output>{scene.camera.padding}px</output><input type="range" min="8" max="240" step="4" value={scene.camera.padding} onChange={event => patchScene({ camera: { ...scene.camera, padding: Number(event.target.value) } })} /></label></>}
          <p className="sb-note">The camera moves between scene regions using the transition time above. Missing targets fall back to the full diagram.</p>
        </div></details>
        <details className="sb-details"><summary><Focus size={14} /><span>Spotlight</span><small>{scene.highlight.length || 'None'}</small><ChevronDown size={14} /></summary><div className="sb-details-body"><p className="sb-note sb-note-first">Keep selected elements bright while the rest of the visible diagram recedes.</p><ElementPicker elements={elements} selected={scene.highlight} onChange={highlight => patchScene({ highlight })} label="Spotlight elements" emptyMessage="Render a diagram to choose a spotlight." canvasSelection={selectedElement} /></div></details>
        <details className="sb-details"><summary><Route size={14} /><span>Animate a path</span><small>{scene.flow.length || 'None'}</small><ChevronDown size={14} /></summary><div className="sb-details-body"><p className="sb-note sb-note-first">Choose connectors to show directional flow in this scene. Hidden connectors stay hidden.</p><ElementPicker elements={edges} selected={scene.flow} onChange={flow => patchScene({ flow })} label="Flow connectors" emptyMessage="Flow animation requires selectable path-based connectors." canvasSelection={selectedElement} /></div></details>
        <p className="sb-footer-note">Scenes travel with your project JSON and HTML presentation. Reduced-motion preferences disable camera animation and moving flow.</p>
      </>}
    </div>
  </section>;
}
