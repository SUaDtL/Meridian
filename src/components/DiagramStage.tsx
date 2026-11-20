import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Minus, Plus, Maximize, Move, MousePointer2, RotateCcw, Focus, X } from 'lucide-react';
import type { RenderResult, StudioDocument } from '../types';
import { buildExportSvg } from '../lib/export';
import { getTheme } from '../lib/themes';

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


interface Props {
  result: RenderResult | null;
  document: StudioDocument;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  replayKey: number;
  present: boolean;
  motionPaused: boolean;
  fitRequest: number;
}

export default function DiagramStage({result, document: doc, selectedKey, onSelect, replayKey, present, motionPaused, fitRequest}: Props) {
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
  const hadPinch = useRef(false);
  const suppressClickUntil = useRef(0);
  // Pointer events can arrive before React commits the preceding render.
  // Keep the gesture's camera synchronous while React paints the same values.
  const updateCamera = useCallback((nextZoom: number, nextPan: Point) => {
    camera.current = { zoom: nextZoom, pan: nextPan };
    setZoom(nextZoom); setPan(nextPan);
  }, []);
  const isFitted = useRef(true);
  const theme = getTheme(doc.settings.theme);
  const svg = useMemo(() => result ? buildExportSvg(result, doc, {animated:true, includeFrame:true}) : '', [result, doc]);
  const dimensions = useMemo(() => {
    if(!svg) return {width:900,height:700};
    const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    return {width:Number(el.getAttribute('width'))||900, height:Number(el.getAttribute('height'))||700};
  }, [svg]);

  const fit = useCallback(() => {
    const el = viewport.current;
    if(!el) return;
    const margin = window.innerWidth < 800 ? 24 : 62;
    updateCamera(Math.max(.08,Math.min(2, (el.clientWidth-margin)/dimensions.width, (el.clientHeight-margin-36)/dimensions.height)), {x:0,y:0});
    isFitted.current = true;
  }, [dimensions.width, dimensions.height, updateCamera]);

  useEffect(() => { fit(); }, [fit, fitRequest, present, doc.id]);
  useEffect(() => {
    const el = viewport.current; if(!el) return;
    const observer = new ResizeObserver(() => { if(isFitted.current) fit(); }); observer.observe(el); return () => observer.disconnect();
  }, [fit]);

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
    if (!el) return;
    const active = new Set<string>();
    const visit = (key: string) => {
      if (active.has(key)) return;
      active.add(key);
      result?.elements?.find(item => item.key === key)?.members?.forEach(visit);
    };
    if (selectedKey) visit(selectedKey);
    el.querySelectorAll<SVGElement>('[data-element-key], [data-element-owner]').forEach(node => {
      const key = node.getAttribute('data-element-key') || node.getAttribute('data-element-owner');
      node.classList.toggle('studio-selected', key === selectedKey && node.hasAttribute('data-element-key'));
      node.classList.toggle('studio-dimmed', focused && !!selectedKey && !!key && !active.has(key));
      if (node.hasAttribute('data-element-key')) {
        node.setAttribute('tabindex', '0');
        node.setAttribute('role', 'button');
        node.setAttribute('aria-label', `Select ${result?.elements?.find(item => item.key === key)?.label || node.textContent?.trim() || key}`);
        node.setAttribute('aria-pressed', String(key === selectedKey));
      }
    });
  }, [svg, selectedKey, focused, replayKey, result]);
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
    const box = element.getBoundingClientRect();
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
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    if (!pointers.current.size) { hadPinch.current = false; suppressClickUntil.current = 0; }
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
      const box = element.getBoundingClientRect();
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
    ref={viewport} data-testid="diagram-viewport" style={{'--canvas-color':theme.canvas,'--canvas-accent':theme.accent} as CSSProperties}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(e) => finishPointer(e)} onPointerCancel={(e) => finishPointer(e, true)} onLostPointerCapture={(e) => finishPointer(e, true)}
    onDoubleClick={(e)=> {if (Date.now() < suppressClickUntil.current) { e.preventDefault(); return; } if(!elementKey(e.target) && !(e.target as Element).closest('button')) fit();}}>
    <div className="canvas-corner-label"><span className="corner-square" />{present?'PRESENTATION': 'CANVAS'}<span className="canvas-theme-name">{theme.name}</span></div>
    {!result ? <div className="canvas-loading"><div className="loading-mark"><span/><span/><span/></div><p>Setting the stage</p><span>Your diagram will appear here.</span></div> :
      <div className="drawing-position" style={{width:dimensions.width,height:dimensions.height,transform:`translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`}}>
        <div key={replayKey} ref={drawing} className={`drawing ${replayKey>0?'replay':''}`} data-testid="rendered-diagram" dangerouslySetInnerHTML={{__html:svg}}
          onClick={(e) => {if (Date.now() < suppressClickUntil.current) { e.preventDefault(); e.stopPropagation(); return; } const key=elementKey(e.target); if(key&&tool==='select'){e.stopPropagation();onSelect(key);}}}
          onKeyDown={(e)=>{ if(e.key==='Enter'||e.key===' '){const key=elementKey(e.target);if(key){e.preventDefault();onSelect(key);}} }} />
      </div>}
    {selectedKey && <div className="selection-toolbar"><span>{result?.elements?.find(element=>element.key===selectedKey)?.label||selectedKey}</span><button className={focused?'active':''} onClick={()=>setFocused(!focused)} title="Spotlight this element" aria-pressed={focused}><Focus size={15}/>Spotlight</button><button className="icon-button" aria-label="Clear selected node" onClick={()=>onSelect(null)}><X size={15}/></button></div>}
    <div className="canvas-controls">
      <div className="control-group tool-buttons"><button className={tool==='select'?'active':''} onClick={()=>setTool('select')} aria-label="Select diagram elements" aria-pressed={tool==='select'} title="Select diagram elements"><MousePointer2 size={17}/></button><button className={tool==='pan'?'active':''} onClick={()=>setTool('pan')} aria-label="Pan canvas" aria-pressed={tool==='pan'} title="Pan canvas"><Move size={17}/></button></div>
      <div className="control-group"><button onClick={()=>zoomTo(zoom/1.2)} aria-label="Zoom out"><Minus size={17}/></button><button className="zoom-value" onClick={()=>zoomTo(1)} title="Actual size">{Math.round(zoom*100)}%</button><button onClick={()=>zoomTo(zoom*1.2)} aria-label="Zoom in"><Plus size={17}/></button><span className="control-separator"/><button onClick={fit} aria-label="Fit diagram to view" title="Fit to view"><Maximize size={17}/></button></div>
    </div>
    <div className="canvas-hint"><RotateCcw size={12}/><span>Drag to pan · Pinch or scroll to zoom · Double-click to fit</span></div>
  </div>;
}
