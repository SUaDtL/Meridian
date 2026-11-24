import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Minus, Plus, Maximize, Move, MousePointer2, RotateCcw, Focus, X, Code2, CircleAlert } from 'lucide-react';
import type { RenderResult, StudioDocument } from '../types';
import { buildExportFrame } from '../lib/export';
import { getTheme } from '../lib/themes';
import { createStoryboardPlayer } from '../lib/storyboard';
import type { StoryboardController, StoryPlaybackState } from '../types/storyboard';

type Point = { x: number; y: number };
type TrackedPointer = Point & { type: string };
type DragSnapshot = {
  x: number; y: number; px: number; py: number;
  moved: boolean; pointerId: number; type: string; nodeKey: string | null;
};
type PinchSnapshot = {
  ids: [number, number]; distance: number; zoom: number; anchor: Point;
};
const clampZoom = (value: number) => Math.min(5, Math.max(.08, value));

function elementKey(target: EventTarget | null): string | null {
  const element = target instanceof Element ? target.closest('[data-element-key], [data-element-owner]') : null;
  return element?.getAttribute('data-element-key') || element?.getAttribute('data-element-owner') || null;
}

function headingField(target: EventTarget | null): 'title' | 'subtitle' | null {
  const field = target instanceof Element ? target.closest('[data-frame-label]')?.getAttribute('data-frame-label') : null;
  return field === 'title' || field === 'subtitle' ? field : null;
}

interface Props {
  result: RenderResult | null;
  document: StudioDocument;
  selectedKey: string | null;
  onRename?: (key: string) => void;
  targetTable?: import("../lib/authoring/project-render").RenderTargetTable | null;
  onSelect: (key: string | null) => void;
  replayKey: number;
  present: boolean;
  motionPaused: boolean;
  fitRequest: number;
  selectionRequest?: number;
  storyPreview?: boolean;
  reducedMotion?: boolean;
  onStoryController?: (controller: StoryboardController | null) => void;
  onStoryPlayback?: (state: StoryPlaybackState) => void;
  onEditHeading?: (field: 'title' | 'subtitle') => void;
  loading?: boolean;
  error?: string;
}

function DiagramStage({result, document: doc, selectedKey, onSelect, onRename, targetTable, replayKey, present, motionPaused, fitRequest, selectionRequest = 0, storyPreview = false, reducedMotion = false, onStoryController, onStoryPlayback, onEditHeading, loading = false, error = ''}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const drawing = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x: 0, y: 0});
  const [tool, setTool] = useState<'select'|'pan'>('select');
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragSnapshot | null>(null);
  const pointers = useRef(new Map<number, TrackedPointer>());
  const pinch = useRef<PinchSnapshot | null>(null);
  const camera = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const cameraFrame = useRef<number | null>(null);
  const gestureBounds = useRef<DOMRect | null>(null);
  const hadPinch = useRef(false);
  const suppressClickUntil = useRef(0);
  const storyController = useRef<StoryboardController | null>(null);
  const previousPlayback = useRef<{ documentId: string; state: StoryPlaybackState } | null>(null);
  const callbacks = useRef({ onStoryController, onStoryPlayback });
  callbacks.current = { onStoryController, onStoryPlayback };
  const selectionTargets = useRef<Array<{ node: SVGElement; key: string; primary: boolean }>>([]);
  const elementIndex = useMemo(() => new Map(result?.elements?.map(element => [element.key, element]) ?? []), [result?.elements]);
  const canEditHeading = Boolean(onEditHeading) && !present && !storyPreview;
  // Pointer events can arrive before React commits the preceding render.
  // Keep the gesture's camera synchronous while React paints the same values.
  const updateCamera = useCallback((nextZoom: number, nextPan: Point) => {
    camera.current = { zoom: nextZoom, pan: nextPan };
    // A high-rate trackpad or pointer stream needs at most one React update per
    // animation frame. Gesture calculations always read the synchronous camera.
    if (cameraFrame.current === null) cameraFrame.current = requestAnimationFrame(() => {
      cameraFrame.current = null;
      setZoom(camera.current.zoom); setPan(camera.current.pan);
    });
  }, []);
  useEffect(() => () => {
    if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
    cameraFrame.current = null;
  }, []);
  const isFitted = useRef(true);
  const editingCamera = useRef<{ documentId: string; zoom: number; pan: Point; fitted: boolean } | null>(null);
  const previousView = useRef({ documentId: doc.id, present: false, fitRequest: -1, source: doc.source });
  const theme = getTheme(doc.settings.theme);
  const frame = useMemo(() => result ? buildExportFrame(result, doc, { animated: true, includeFrame: true }) : { svg: '', width: 900, height: 700 },
    [result, doc.title, doc.subtitle, doc.settings.theme, doc.settings.font, doc.settings.padding, doc.settings.frame, doc.settings.showTitle, doc.settings.showBrand, doc.settings.background, doc.settings.ambient]);
  const { svg } = frame;
  const dimensions = frame;
  const markup = useMemo(() => ({ __html: svg }), [svg]);

  useEffect(() => {
    if (!storyPreview || !doc.storyboard?.scenes.length) {
      previousPlayback.current = null;
      return;
    }
    const root = drawing.current?.querySelector<SVGSVGElement>('[data-meridian-export]');
    if (!root) return;
    setFocused(false);
    root.querySelectorAll('.studio-selected,.studio-dimmed,.studio-edge-dimmed').forEach(element=>element.classList.remove('studio-selected','studio-dimmed','studio-edge-dimmed'));
    const resume = previousPlayback.current?.documentId === doc.id ? previousPlayback.current.state : null;
    const controller = createStoryboardPlayer(root, doc.storyboard, {
      targetTable: targetTable ?? undefined,
      initialTime: resume?.time,
      initialPreview: resume?.preview ? resume.sceneIndex : undefined,
      reducedMotion,
      accent: theme.accent,
      onUpdate: state => callbacks.current.onStoryPlayback?.(state),
    });
    storyController.current = controller;
    callbacks.current.onStoryController?.(controller);
    if (resume?.playing) controller.play();
    return () => {
      previousPlayback.current = { documentId: doc.id, state: controller.getState() };
      controller.destroy();
      storyController.current = null;
      callbacks.current.onStoryController?.(null);
    };
  }, [svg, storyPreview, doc.storyboard, doc.id, replayKey, theme.accent]);

  useEffect(() => { storyController.current?.setReducedMotion(reducedMotion); }, [reducedMotion]);

  const fit = useCallback(() => {
    const el = viewport.current;
    if(!el) return;
    const margin = window.innerWidth < 800 ? 24 : 62;
    updateCamera(Math.max(.08,Math.min(2, (el.clientWidth-margin)/dimensions.width, (el.clientHeight-margin-36)/dimensions.height)), {x:0,y:0});
    isFitted.current = true;
  }, [dimensions.width, dimensions.height, updateCamera]);

  useEffect(() => {
    const previous = previousView.current;
    if (previous.documentId !== doc.id) {
      editingCamera.current = null;
      fit();
    } else if (present && !previous.present) {
      editingCamera.current = { documentId: doc.id, ...camera.current, fitted: isFitted.current };
      fit();
    } else if (!present && previous.present) {
      const saved = editingCamera.current;
      editingCamera.current = null;
      if (saved?.documentId === doc.id && !saved.fitted) {
        updateCamera(saved.zoom, saved.pan);
        isFitted.current = false;
      } else fit();
    } else if (fitRequest !== previous.fitRequest || doc.source !== previous.source || isFitted.current) {
      fit();
    }
    previousView.current = { documentId: doc.id, present, fitRequest, source: doc.source };
  }, [fit, fitRequest, present, doc.id, doc.source, updateCamera]);
  useEffect(() => {
    const el = viewport.current; if(!el) return;
    const observer = new ResizeObserver(() => { gestureBounds.current = null; if(isFitted.current) fit(); });
    const invalidateBounds = () => { gestureBounds.current = null; };
    observer.observe(el); window.addEventListener('scroll', invalidateBounds, true);
    return () => { observer.disconnect(); window.removeEventListener('scroll', invalidateBounds, true); };
  }, [fit]);

  const viewStack = useRef<{ zoom: number; pan: Point; fitted: boolean }[]>([]);
  const [canGoBack, setCanGoBack] = useState(false);
  const focusSelection = useCallback((neighbors = false) => {
    const el = viewport.current;
    const chosen = selectedKey && elementIndex.get(selectedKey);
    if (!el || !chosen || !("diagramScale" in frame)) return;
    const ids = new Set([chosen.key]);
    if (neighbors) for (const item of elementIndex.values()) {
      if (item.from === chosen.key || item.to === chosen.key || item.key === chosen.key) {
        ids.add(item.key);
        if (item.from) ids.add(item.from);
        if (item.to) ids.add(item.to);
      }
    }
    const boxes = [...ids].flatMap(key => elementIndex.get(key)?.bounds ?? []);
    if (!boxes.length) return;
    const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
    const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height));
    const k = frame.diagramScale;
    const next = clampZoom(Math.min(1.5 / k, (el.clientWidth - 60) / Math.max(1,(right-left)*k), (el.clientHeight - 110) / Math.max(1,(bottom-top)*k)));
    if (!(next > 0)) return;
    const centerX = frame.diagramOrigin.x + (left + right)*k/2 - frame.width/2;
    const centerY = frame.diagramOrigin.y + (top + bottom)*k/2 - frame.height/2;
    viewStack.current = [...viewStack.current.slice(-9), { ...camera.current, fitted: isFitted.current }];
    setCanGoBack(true); isFitted.current = false;
    updateCamera(next, { x: -centerX*next, y: -centerY*next });
  }, [frame, elementIndex, selectedKey, updateCamera]);
  const handledSelection = useRef(0);
  useEffect(() => {
    if (selectionRequest === handledSelection.current) return;
    handledSelection.current = selectionRequest;
    focusSelection();
  }, [selectionRequest, focusSelection]);
  useEffect(() => { viewStack.current = []; setCanGoBack(false); }, [doc.id, doc.source]);
  function backToView() {
    const saved = viewStack.current.pop();
    if (!saved) return;
    if (saved.fitted) fit(); else { isFitted.current = false; updateCamera(saved.zoom, saved.pan); }
    setCanGoBack(viewStack.current.length > 0);
  }

  const zoomTo = useCallback((next:number) => { updateCamera(clampZoom(next), camera.current.pan); isFitted.current = false; }, [updateCamera]);
  useEffect(() => {
    const el = viewport.current; if(!el) return;
    const wheel = (e:WheelEvent) => {
      if((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? .008 : .0015));
      const { zoom: currentZoom, pan: currentPan } = camera.current;
      const next = clampZoom(currentZoom * factor);
      const box = el.getBoundingClientRect();
      const dx = e.clientX-box.left-box.width/2, dy = e.clientY-box.top-box.height/2;
      updateCamera(next, {x:dx-(dx-currentPan.x)*(next/currentZoom), y:dy-(dy-currentPan.y)*(next/currentZoom)});
      isFitted.current = false;
    };
    el.addEventListener('wheel',wheel,{passive:false}); return () => el.removeEventListener('wheel',wheel);
  }, [updateCamera]);

  useEffect(() => {
    const el = drawing.current;
    // Exports are atomic images; the live stage contains editable headings and
    // selectable nodes. A named group keeps those controls in the accessibility
    // tree without changing the serialized export or its visual appearance.
    el?.querySelector('[data-meridian-export]')?.setAttribute('role', 'group');
    selectionTargets.current = el ? Array.from(el.querySelectorAll<SVGElement>('[data-element-key], [data-element-owner]'), node => ({
      node,
      key: node.getAttribute('data-element-key') || node.getAttribute('data-element-owner') || '',
      primary: node.hasAttribute('data-element-key'),
    })) : [];
    for (const { node, key, primary } of selectionTargets.current) if (primary) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `Select ${elementIndex.get(key)?.label || node.textContent?.trim() || key}`);
    }
  }, [svg, replayKey, elementIndex]);

  useEffect(() => {
    const active = new Set<string>();
    const visit = (key: string) => {
      if (active.has(key)) return;
      active.add(key);
      elementIndex.get(key)?.members?.forEach(visit);
    };
    if (selectedKey) visit(selectedKey);
    for (const { node, key, primary } of selectionTargets.current) {
      node.classList.toggle('studio-selected', !storyPreview && key === selectedKey && primary);
      node.classList.toggle('studio-dimmed', !storyPreview && focused && !!selectedKey && !!key && !active.has(key));
      if (primary) {
        node.setAttribute('tabindex', storyPreview ? '-1' : '0');
        node.setAttribute('aria-pressed', String(!storyPreview && key === selectedKey));
      }
    }
  }, [svg, selectedKey, focused, replayKey, elementIndex, storyPreview]);

  useEffect(() => {
    const seen = new Set<string>();
    drawing.current?.querySelectorAll<SVGElement>('[data-frame-label]').forEach(node => {
      const field = node.getAttribute('data-frame-label')!;
      node.style.cursor = canEditHeading ? 'text' : '';
      if (canEditHeading && !seen.has(field)) {
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
        node.setAttribute('aria-label', `Edit diagram ${field}`);
      } else {
        node.removeAttribute('role'); node.removeAttribute('tabindex'); node.removeAttribute('aria-label');
      }
      seen.add(field);
    });
  }, [svg, replayKey, canEditHeading]);
  useEffect(() => { if(!selectedKey) setFocused(false); },[selectedKey]);

  useEffect(() => {
    setDragging(false);
    const element = viewport.current;
    const activePointers = pointers.current;
    return () => {
      const ids = Array.from(activePointers.keys());
      activePointers.clear(); drag.current = null; pinch.current = null; hadPinch.current = false;
      for (const id of ids) {
        if (element?.hasPointerCapture(id)) element.releasePointerCapture(id);
      }
    };
  }, [doc.id]);

  const beginPinch = () => {
    const touches = Array.from(pointers.current.entries()).filter(([, pointer]) => pointer.type === 'touch');
    const element = viewport.current;
    if (touches.length < 2 || !element) return false;
    const [[firstId, first], [secondId, second]] = touches;
    const box = gestureBounds.current ?? (gestureBounds.current = element.getBoundingClientRect());
    const midpoint = { x: (first.x + second.x) / 2 - box.left - box.width / 2, y: (first.y + second.y) / 2 - box.top - box.height / 2 };
    const current = camera.current;
    pinch.current = {
      ids: [firstId, secondId],
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      zoom: current.zoom,
      anchor: { x: (midpoint.x - current.pan.x) / current.zoom, y: (midpoint.y - current.pan.y) / current.zoom },
    };
    drag.current = null; hadPinch.current = true;
    suppressClickUntil.current = Date.now() + 500;
    isFitted.current = false; setDragging(true);
    return true;
  };

  const pointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('button') || (canEditHeading && headingField(e.target))) return;
    if (!pointers.current.size) { hadPinch.current = false; suppressClickUntil.current = 0; gestureBounds.current = e.currentTarget.getBoundingClientRect(); }
    const nodeKey = elementKey(e.target);
    // Mouse clicks still reach the SVG's existing node-selection handler.
    // Touches are tracked even on nodes so either finger can begin there.
    if (e.pointerType !== 'touch' && tool === 'select' && nodeKey) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') e.preventDefault();
    if (pinch.current || beginPinch()) return;
    const current = camera.current;
    drag.current = { x: e.clientX, y: e.clientY, px: current.pan.x, py: current.pan.y, moved: false, pointerId: e.pointerId, type: e.pointerType, nodeKey: tool === 'select' ? nodeKey : null };
  };

  const pointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const pointer = pointers.current.get(e.pointerId);
    if (!pointer) return;
    pointers.current.set(e.pointerId, { ...pointer, x: e.clientX, y: e.clientY });
    const gesture = pinch.current;
    if (gesture) {
      if (!gesture.ids.includes(e.pointerId)) return;
      const first = pointers.current.get(gesture.ids[0]);
      const second = pointers.current.get(gesture.ids[1]);
      const element = viewport.current;
      if (!first || !second || !element) return;
      e.preventDefault();
      const box = gestureBounds.current ?? (gestureBounds.current = element.getBoundingClientRect());
      const midpoint = { x: (first.x + second.x) / 2 - box.left - box.width / 2, y: (first.y + second.y) / 2 - box.top - box.height / 2 };
      const nextZoom = clampZoom(gesture.zoom * Math.hypot(second.x - first.x, second.y - first.y) / gesture.distance);
      // Keep the original diagram point under the moving midpoint, including
      // when the zoom limit is reached. Parallel finger motion also pans.
      updateCamera(nextZoom, { x: midpoint.x - gesture.anchor.x * nextZoom, y: midpoint.y - gesture.anchor.y * nextZoom });
      return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId) return;
    const dx = e.clientX - current.x, dy = e.clientY - current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      current.moved = true; setDragging(true); isFitted.current = false;
      suppressClickUntil.current = Date.now() + 500;
    }
    if (current.moved || current.type !== 'touch') {
      updateCamera(camera.current.zoom, { x: current.px + dx, y: current.py + dy });
    }
  };

  const finishPointer = (e: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const pointer = pointers.current.get(e.pointerId);
    if (!pointer) return;
    const endedDrag = drag.current?.pointerId === e.pointerId ? drag.current : null;
    const wasPinch = hadPinch.current;
    pointers.current.delete(e.pointerId);
    pinch.current = null;
    if (pointer.type === 'touch' || wasPinch || endedDrag?.moved) suppressClickUntil.current = Date.now() + 500;

    if (!beginPinch()) {
      const remaining = Array.from(pointers.current.entries())[0];
      if (remaining) {
        const [id, point] = remaining;
        const current = camera.current;
        // Rebase the remaining finger at the current camera to avoid a jump
        // when a two-finger gesture becomes a one-finger pan.
        drag.current = { x: point.x, y: point.y, px: current.pan.x, py: current.pan.y, moved: true, pointerId: id, type: point.type, nodeKey: null };
        setDragging(true);
      } else {
        drag.current = null; setDragging(false); hadPinch.current = false;
        if (!cancelled && !wasPinch && endedDrag && !endedDrag.moved) onSelect(endedDrag.nodeKey);
      }
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return <div className={`diagram-viewport ${dragging?'is-dragging':''} ${tool==='pan'?'pan-tool':''} ${motionPaused?'motion-paused':''}`}
    ref={viewport} data-testid="diagram-viewport" aria-busy={loading || undefined} style={{'--canvas-color':theme.canvas,'--canvas-accent':theme.accent} as CSSProperties}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(e) => finishPointer(e)} onPointerCancel={(e) => finishPointer(e, true)} onLostPointerCapture={(e) => finishPointer(e, true)}
    onDoubleClick={(e)=> {if (Date.now() < suppressClickUntil.current) { e.preventDefault(); return; } if(!elementKey(e.target) && !headingField(e.target) && !(e.target as Element).closest('button')) fit();}}>
    <div className="canvas-corner-label"><span className="corner-square" />{present?'PRESENTATION': 'CANVAS'}<span className="canvas-theme-name">{theme.name}</span></div>
    {!result ? <div className={`canvas-loading ${loading ? '' : 'canvas-empty'}`}>
      {loading ? <div className="loading-mark"><span/><span/><span/></div> : error ? <CircleAlert size={30}/> : <Code2 size={30}/>}
      <p>{loading ? 'Drawing your diagram' : error ? 'Check your Mermaid source' : doc.source.trim() ? 'Ready to render' : 'Your canvas is ready'}</p>
      <span>{loading ? 'Preparing the layout and your chosen style.' : error ? 'The source has a syntax issue. Fix it in the editor, then render again.' : doc.source.trim() ? 'Render your source to see it here.' : 'Write or paste Mermaid source, or choose an example to begin.'}</span>
    </div> :
      <div className="drawing-position" style={{width:dimensions.width,height:dimensions.height,transform:`translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}}>
        <div key={replayKey} ref={drawing} className={`drawing ${replayKey>0?'replay':''}`} data-testid="rendered-diagram" dangerouslySetInnerHTML={markup}
          onClick={(e) => {
            if (Date.now() < suppressClickUntil.current) { e.preventDefault(); e.stopPropagation(); return; }
            const field = headingField(e.target);
            if (field && canEditHeading) { e.stopPropagation(); onEditHeading?.(field); return; }
            if (storyPreview) return;
            const key = elementKey(e.target);
            if (key && tool === 'select') { e.stopPropagation(); onSelect(key); }
          }}
          onKeyDown={(e)=>{
            if (storyPreview || (e.key !== 'Enter' && e.key !== ' ')) return;
            const field = headingField(e.target);
            if (field && canEditHeading) { e.preventDefault(); e.stopPropagation(); onEditHeading?.(field); return; }
            const key = elementKey(e.target);
            if (key) { e.preventDefault(); onSelect(key); }
          }} />
      </div>}
    {!present && !storyPreview && selectedKey && <div className="selection-toolbar"><span>{elementIndex.get(selectedKey)?.label||selectedKey}</span>{onRename && elementIndex.get(selectedKey)?.kind === "node" && <button onClick={() => onRename(selectedKey)}>Rename</button>}<button onClick={() => focusSelection()}>Zoom to selection</button><button onClick={() => focusSelection(true)}>Neighbors</button><button className={focused?'active':''} onClick={()=>setFocused(!focused)} title="Spotlight this element" aria-pressed={focused}><Focus size={15}/>Spotlight</button><button className="icon-button" aria-label="Clear selected node" onClick={()=>onSelect(null)}><X size={15}/></button></div>}
    {!present && <div className="canvas-controls">
      {canGoBack && <button className="button quiet" onClick={backToView}>Previous view</button>}
      <div className="control-group tool-buttons"><button className={tool==='select'?'active':''} onClick={()=>setTool('select')} aria-label="Select diagram elements" aria-pressed={tool==='select'} title="Select diagram elements"><MousePointer2 size={17}/></button><button className={tool==='pan'?'active':''} onClick={()=>setTool('pan')} aria-label="Pan canvas" aria-pressed={tool==='pan'} title="Pan canvas"><Move size={17}/></button></div>
      <div className="control-group"><button onClick={()=>zoomTo(zoom/1.2)} aria-label="Zoom out"><Minus size={17}/></button><button className="zoom-value" onClick={()=>zoomTo(1)} aria-label={`Zoom ${Math.round(zoom*100)} percent. Reset to 100 percent`} title="Reset zoom to 100%">{Math.round(zoom*100)}%</button><button onClick={()=>zoomTo(zoom*1.2)} aria-label="Zoom in"><Plus size={17}/></button><span className="control-separator"/><button onClick={fit} aria-label="Fit diagram to view" title="Fit to view"><Maximize size={17}/></button></div>
    </div>}
    {!present && <div className="canvas-hint"><RotateCcw size={12}/><span>Drag to pan · Pinch or scroll to zoom · Double-click to fit</span></div>}
  </div>;
}

export default memo(DiagramStage);
