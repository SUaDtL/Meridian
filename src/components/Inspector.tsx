import { useEffect, useId, useMemo, useState } from 'react';
import { Check, MousePointer2, Palette, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import { getTheme, THEMES } from '../lib/themes';
import type { RenderResult, StudioDocument, StudioSettings } from '../types';
import type { DesignState, RenderElement } from '../types/design';
import { applyDesignPreset, createDesign, DESIGN_PRESETS, suggestedLayout } from '../lib/design';
import ElementInspector from './ElementInspector';
import { InspectorChoice as Choice, InspectorDisclosure as Disclosure, InspectorRange as Range, InspectorSelect as Select, InspectorSwitch as Switch } from './InspectorControls';
import '../inspector.css';

export interface InspectorProps {
  document: StudioDocument;
  result?: RenderResult | null;
  selectedElement?: RenderElement | null;
  onDesign?: (design: DesignState) => void;
  onSelectElement?: (key: string | null) => void;
  onSettings: (patch: Partial<StudioSettings>) => void;
  onDocument: (patch: Partial<Pick<StudioDocument, 'settings' | 'design' | 'nodeAccents'>>) => void;
  onEditHeading?: () => void;
  selectedNode: { key: string; label: string } | null;
  onAccent: (color: string | null) => void;
  onClearSelection: () => void;
  onReplay: () => void;
  reducedMotion: boolean;
}

export function Inspector({ document, result, selectedElement, onDesign, onSelectElement, onSettings, onDocument, onEditHeading, selectedNode, onAccent, onClearSelection, onReplay, reducedMotion }: InspectorProps) {
  const [scope, setScope] = useState<'diagram' | 'selected'>('diagram');
  const [filter, setFilter] = useState('');
  const pickerId = useId();
  const settings = document.settings, design = document.design ?? createDesign();
  const elements = result?.elements;
  const preset = DESIGN_PRESETS.find(item => item.id === design.preset);
  const flowchart = Boolean(result?.diagramType.startsWith('flowchart'));
  const hasConnectors = Boolean(elements?.some(item => item.kind === 'edge'));
  const matches = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return (elements ?? []).filter(item => !query || `${item.label} ${item.sourceId}`.toLocaleLowerCase().includes(query));
  }, [elements, filter]);
  const choices = selectedElement && !matches.some(item => item.key === selectedElement.key) ? [selectedElement, ...matches] : matches;
  useEffect(() => {
    setScope(selectedElement ? 'selected' : 'diagram');
  }, [selectedElement?.key]);
  useEffect(() => { setFilter(''); }, [document.id]);
  const resetSelected = () => {
    if (!selectedElement) return;
    const next = { ...design.elements }; delete next[selectedElement.key];
    const nodeAccents = { ...document.nodeAccents };
    if (selectedNode) delete nodeAccents[selectedNode.key];
    onDocument({ design: { ...design, elements: next }, nodeAccents });
  };

  return <div className="mi-inspector" role="group" aria-label="Diagram design">
    <div className="mi-tabs" role="group" aria-label="Style scope">
      <button type="button" aria-pressed={scope === 'diagram'} className={scope === 'diagram' ? 'is-active' : ''} onClick={() => setScope('diagram')}><Palette size={15} aria-hidden="true"/>Diagram</button>
      <button type="button" disabled={!selectedElement} aria-pressed={scope === 'selected'} className={scope === 'selected' ? 'is-active' : ''} onClick={() => setScope('selected')} title={selectedElement ? `Style ${selectedElement.label}` : 'Select a node, connector, or group on the canvas'}><MousePointer2 size={15} aria-hidden="true"/>Selected</button>
    </div>
    <div className="mi-inspector-scroll">
      {!!elements?.length && <section className="mi-element-picker" aria-label="Element selection">
        <label className="mi-label" htmlFor={pickerId}>Inspect an element</label>
        {elements.length > 12 && <input type="search" aria-label="Find an element" placeholder="Find by label or source ID" value={filter} onChange={event => setFilter(event.target.value)}/>}
        <select id={pickerId} value={selectedElement?.key ?? ''} onChange={event => {
          const key = event.target.value || null; onSelectElement?.(key); setScope(key ? 'selected' : 'diagram');
        }}><option value="">Select on canvas or choose here</option>{(['node', 'edge', 'group'] as const).map(kind => <optgroup key={kind} label={kind === 'edge' ? 'Connectors' : `${kind[0].toUpperCase()}${kind.slice(1)}s`}>{choices.filter(item => item.kind === kind).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>)}</select>
        {filter && <p className="mi-note">{matches.length} matching {matches.length === 1 ? 'element' : 'elements'}{choices.length > matches.length ? ' · current selection retained' : ''}</p>}
      </section>}

      {scope === 'selected' && selectedElement ? <ElementInspector key={selectedElement.key} document={document} element={selectedElement} selectedNode={selectedNode} onDesign={value => onDesign?.(value)} onAccent={onAccent} onReset={resetSelected} onClear={onClearSelection}/> : <>
        <Disclosure title="Design presets" hint={preset ? `${preset.name} · choose a coordinated style` : 'Choose a coordinated starting point'} className="mi-presets">
          <div className="mi-preset-list">{DESIGN_PRESETS.map(item => <button key={item.id} type="button" className={`mi-preset${design.preset === item.id ? ' is-active' : ''}`} aria-pressed={design.preset === item.id} onClick={() => onDocument(applyDesignPreset(document, item.id))}>
            <span className="mi-preset-swatch" style={{ background: getTheme(item.settings.theme ?? 'obsidian').canvas, color: getTheme(item.settings.theme ?? 'obsidian').accent }} aria-hidden="true"><span/><i/><span/></span><span><strong>{item.name}</strong><small>{item.description}</small></span>{design.preset === item.id && <Check size={13}/>}
          </button>)}</div>
          <p className="mi-note">Presets coordinate theme, layout, and effects. Your heading and individual element overrides stay in place.</p>
        </Disclosure>

        <section className="mi-section mi-theme-section" aria-labelledby="mi-theme-title"><h3 id="mi-theme-title">Theme</h3>
          <div className="mi-theme-grid">{THEMES.map(item => <button key={item.id} type="button" className={`mi-theme-card${settings.theme === item.id ? ' is-active' : ''}`} aria-pressed={settings.theme === item.id} title={item.description} onClick={() => onSettings({ theme: item.id })}>
            <span className="mi-theme-preview" style={{ backgroundColor: item.canvas }} aria-hidden="true"><span className="mi-theme-line" style={{ backgroundColor: item.edge }}/><span className="mi-theme-node mi-theme-node-first" style={{ background: `linear-gradient(135deg, ${item.node}, ${item.nodeEnd})`, borderColor: item.accent }}/><span className="mi-theme-node mi-theme-node-last" style={{ backgroundColor: item.node, borderColor: item.border }}/>{settings.theme === item.id && <span className="mi-theme-check" style={{ backgroundColor: item.accent, color: item.canvas }}><Check size={11} strokeWidth={3}/></span>}</span><span className="mi-theme-name">{item.name}</span>
          </button>)}</div>
          <Choice label="Typography" value={settings.font} options={[{ value: 'sans', label: 'Sans serif' }, { value: 'mono', label: 'Monospace' }]} onChange={font => onSettings({ font })}/>
        </section>

        <section className="mi-section" aria-labelledby="mi-motion-title"><div className="mi-section-heading"><h3 id="mi-motion-title"><Sparkles size={14} aria-hidden="true"/>Motion</h3><button className="mi-icon-button" type="button" aria-label="Replay diagram entrance" title="Replay entrance" onClick={onReplay}><RotateCcw size={14}/></button></div>
          <Choice label="Connection effect" value={settings.motion} disabled={!hasConnectors} options={[{ value: 'none', label: 'Still' }, { value: 'flow', label: 'Flow' }, { value: 'pulse', label: 'Pulse' }]} onChange={motion => onSettings({ motion })}/>
          {hasConnectors && settings.motion !== 'none' && <Range label="Speed" min={.25} max={3} step={.25} value={settings.speed} unit="×" onChange={speed => onSettings({ speed })}/>}
          {!hasConnectors && <p className="mi-note">Connection effects are available on flowchart connectors.</p>}
          {reducedMotion && <p className="mi-note">Reduced motion is enabled on this device. Animation stays paused.</p>}
        </section>

        <Disclosure title="Connections & layout" hint="Automatic layout, spacing, and routes">
          {flowchart ? <>
            <button type="button" className="mi-auto-layout" onClick={() => onDocument({ settings: { ...settings, ...suggestedLayout(elements ?? []) }, design: { ...design, preset: 'custom' } })}><Sparkles size={15}/>Refine layout</button>
            <p className="mi-note mi-layout-note">Routes around groups and adds breathing room to simple flows.</p>
            <Select label="Layout engine" value={settings.layout} onChange={layout => onSettings({ layout: layout as StudioSettings['layout'] })} options={[{ value: 'elk', label: 'ELK · automatic routing' }, { value: 'dagre', label: 'Dagre · adjustable layout' }]}/>
            <Choice label="Line shape" value={settings.curve} disabled={settings.layout === 'elk'} options={[{ value: 'basis', label: 'Smooth' }, { value: 'linear', label: 'Direct' }, { value: 'step', label: 'Step' }]} onChange={curve => onSettings({ curve })}/>
            <Choice label="Spacing" value={settings.spacing} disabled={settings.layout === 'elk'} options={[{ value: 'compact', label: 'Compact' }, { value: 'balanced', label: 'Balanced' }, { value: 'airy', label: 'Airy' }]} onChange={spacing => onSettings({ spacing })}/>
            {settings.layout === 'elk' && <p className="mi-note">ELK sets routes and spacing automatically. Choose Dagre to adjust them.</p>}
            <Range label="Line weight" min={.8} max={5} step={.1} value={settings.edgeWidth} unit="px" onChange={edgeWidth => onSettings({ edgeWidth })}/>
          </> : <p className="mi-note">This diagram uses its native layout. Theme, typography, canvas, and export controls still apply.</p>}
        </Disclosure>

        <Disclosure title="Surfaces & effects" hint="Node finish, shadow, and glow">
          <Choice label="Node finish" value={settings.finish} options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]} onChange={finish => onSettings({ finish })}/>
          <Switch label="Soft shadows" checked={settings.shadow} onChange={shadow => onSettings({ shadow })}/>
          <Switch label="Accent glow" checked={settings.glow} onChange={glow => onSettings({ glow })}/>
        </Disclosure>

        <Disclosure title="Canvas & frame" hint="Heading, background, and export proportions">
          {onEditHeading && <button type="button" className="mi-heading-link" onClick={onEditHeading}><Pencil size={15}/><span><strong>Edit heading</strong><small>{settings.showTitle ? document.title || 'Untitled diagram' : 'Heading hidden'}</small></span></button>}
          <Choice label="Background pattern" value={settings.background} options={[{ value: 'dots', label: 'Dots' }, { value: 'grid', label: 'Grid' }, { value: 'none', label: 'Clear' }]} onChange={background => onSettings({ background })}/>
          <Switch label="Ambient light" hint="A soft wash of the theme color." checked={settings.ambient} onChange={ambient => onSettings({ ambient })}/>
          <div className="mi-field"><span className="mi-label">Frame</span><div className="mi-frame-grid" role="group" aria-label="Frame aspect ratio">{([
            { value: 'auto', label: 'Auto', ratio: 'Fits diagram', shape: 'auto' }, { value: '16:9', label: 'Wide', ratio: '16:9', shape: 'wide' },
            { value: '4:3', label: 'Standard', ratio: '4:3', shape: 'standard' }, { value: '1:1', label: 'Square', ratio: '1:1', shape: 'square' },
          ] as const).map(item => <button key={item.value} type="button" className={`mi-frame-option${settings.frame === item.value ? ' is-active' : ''}`} aria-pressed={settings.frame === item.value} onClick={() => onSettings({ frame: item.value })}><span className={`mi-frame-shape mi-frame-shape-${item.shape}`} aria-hidden="true"/><span>{item.label}<small>{item.ratio}</small></span></button>)}</div></div>
          <Range label="Frame padding" min={16} max={120} step={4} value={settings.padding} unit="px" onChange={padding => onSettings({ padding })}/>
          <Switch label="Meridian signature" hint="A small credit below the diagram." checked={settings.showBrand} onChange={showBrand => onSettings({ showBrand })}/>
        </Disclosure>
        <div className="mi-inspector-footer"><MousePointer2 size={14} aria-hidden="true"/><span>Select a node, connector, or group on the canvas for individual styling.</span></div>
      </>}
    </div>
  </div>;
}

export default Inspector;
