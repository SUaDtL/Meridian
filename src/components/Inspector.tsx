import { useEffect, useId, useState } from 'react';
import { Check, ChevronDown, Layers, MousePointer2, Palette, RotateCcw, Sparkles, X } from 'lucide-react';
import { getTheme, THEMES } from '../lib/themes';
import type { RenderResult, StudioDocument, StudioSettings } from '../types';
import type { DesignState, RenderElement } from '../types/design';
import { applyDesignPreset, createDesign, DESIGN_PRESETS, suggestedLayout } from '../lib/design';
import ElementInspector from './ElementInspector';
import '../inspector.css';

export interface InspectorProps {
  document: StudioDocument;
  result?: RenderResult | null;
  selectedElement?: RenderElement | null;
  onDesign?: (design: DesignState) => void;
  onSelectElement?: (key: string | null) => void;
  onSettings: (patch: Partial<StudioSettings>) => void;
  onDocument: (patch: Partial<Pick<StudioDocument, 'title' | 'subtitle'>>) => void;
  selectedNode: { key: string; label: string } | null;
  onAccent: (color: string | null) => void;
  onClearSelection: () => void;
  onReplay: () => void;
  reducedMotion: boolean;
}

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

function Choice<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mi-field">
      <span className="mi-label">{label}</span>
      <div className="mi-choices" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option.value} type="button" aria-pressed={value === option.value}
            className={`mi-choice${value === option.value ? ' is-active' : ''}`} disabled={disabled}
            onClick={() => onChange(option.value)} title={option.detail}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({ label, hint, checked, onChange }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mi-switch-row">
      <span className="mi-switch-copy"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <span className="mi-switch">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className="mi-switch-track" aria-hidden="true"><span /></span>
      </span>
    </label>
  );
}

function Range({ label, value, min, max, step, display, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="mi-field mi-range-field">
      <div className="mi-field-heading"><label htmlFor={id} className="mi-label">{label}</label><output htmlFor={id}>{display}</output></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  );
}

export function Inspector({ document, result, selectedElement, onDesign, onSelectElement, onSettings, onDocument, selectedNode, onAccent, onClearSelection, onReplay, reducedMotion }: InspectorProps) {
  const [section, setSection] = useState<'look' | 'stage' | 'element'>('look');
  const settings = document.settings;
  const theme = getTheme(settings.theme);
  const titleId = useId();
  const subtitleId = useId();
  const accentId = useId();
  const layoutId = useId();
  const selectedAccent = selectedNode ? document.nodeAccents[selectedNode.key] : undefined;
  const design = document.design ?? createDesign();
  const elements = result?.elements ?? [];
  const preset = DESIGN_PRESETS.find(item => item.id === design.preset);
  useEffect(() => {
    if (selectedElement) setSection('element');
    else setSection(current => current === 'element' ? 'look' : current);
  }, [selectedElement?.key]);

  return (
    <div className="mi-inspector" role="group" aria-label="Diagram design">
      <div className="mi-tabs" role="group" aria-label="Design section">
        {selectedElement && <button type="button" aria-pressed={section === 'element'} className={section === 'element' ? 'is-active' : ''} onClick={() => setSection('element')}><MousePointer2 size={15} aria-hidden="true" />Element</button>}
        <button type="button" aria-pressed={section === 'look'} className={section === 'look' ? 'is-active' : ''} onClick={() => setSection('look')}><Palette size={15} aria-hidden="true" />Look</button>
        <button type="button" aria-pressed={section === 'stage'} className={section === 'stage' ? 'is-active' : ''} onClick={() => setSection('stage')}><Layers size={15} aria-hidden="true" />Stage</button>
      </div>

      <div className="mi-inspector-scroll">
        {selectedNode && !selectedElement && (
          <section className="mi-node-card" aria-label="Selected node">
            <div className="mi-node-heading"><span><MousePointer2 size={13} aria-hidden="true" />Selected node</span><button type="button" className="mi-icon-button" aria-label="Clear node selection" onClick={onClearSelection}><X size={14} /></button></div>
            <strong className="mi-node-label">{selectedNode.label || selectedNode.key}</strong>
            <div className="mi-accent-palette" role="group" aria-label="Node accent color">
              {theme.palette.map((color) => (
                <button key={color} type="button" className={`mi-accent${selectedAccent === color ? ' is-active' : ''}`}
                  style={{ backgroundColor: color }} aria-label={`Set node accent to ${color}`} aria-pressed={selectedAccent === color}
                  title={color} onClick={() => onAccent(color)}>{selectedAccent === color && <Check size={12} strokeWidth={3} />}</button>
              ))}
              <label className="mi-custom-accent" htmlFor={accentId} title="Choose a custom node accent"><span aria-hidden="true">+</span><input id={accentId} type="color" aria-label="Custom node accent" value={selectedAccent ?? theme.accent} onChange={(event) => onAccent(event.target.value)} /></label>
            </div>
            <button type="button" className="mi-text-button" onClick={() => onAccent(null)} disabled={!selectedAccent}><RotateCcw size={12} aria-hidden="true" />Reset node color</button>
          </section>
        )}

        {section === 'element' && selectedElement ? <ElementInspector document={document} element={selectedElement} selectedNode={selectedNode} onDesign={value => onDesign?.(value)} onAccent={onAccent} onClear={onClearSelection}/> : section === 'look' ? (
          <>
            <section className="mi-section mi-presets" aria-label="Design presets">
              <div className="mi-section-heading"><h3>Design preset</h3><span className="mi-preset-status">{preset ? preset.name : 'Custom'}</span></div>
              <div className="mi-preset-list">{DESIGN_PRESETS.map(item => <button key={item.id} type="button" className={`mi-preset${design.preset === item.id ? ' is-active' : ''}`} aria-pressed={design.preset === item.id} onClick={() => { const next = applyDesignPreset(document, item.id); onSettings(next.settings); onDesign?.(next.design); }}><span className="mi-preset-swatch" style={{ background: getTheme(item.settings.theme ?? 'obsidian').canvas, color: getTheme(item.settings.theme ?? 'obsidian').accent }} aria-hidden="true"><span/><i/><span/></span><span><strong>{item.name}</strong><small>{item.description}</small></span>{design.preset === item.id && <Check size={13}/>}</button>)}</div>
              <p className="mi-note">Presets change the overall look. Individual element overrides stay in place.</p>
            </section>
            {elements.length > 0 && <section className="mi-section"><h3>Diagram elements</h3><div className="mi-field"><label className="mi-label" htmlFor="inspect-element">Inspect an element</label><select id="inspect-element" value={selectedElement?.key ?? ''} onChange={event => { const key = event.target.value || null; onSelectElement?.(key); setSection(key ? 'element' : 'look'); }}><option value="">Select on canvas or here</option>{(['node', 'edge', 'group'] as const).map(kind => <optgroup key={kind} label={`${kind[0].toUpperCase() + kind.slice(1)}s`}>{elements.filter(item => item.kind === kind).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>)}</select></div><button type="button" className="mi-auto-layout" onClick={() => { onSettings(suggestedLayout(elements)); onDesign?.({ ...design, preset: 'custom' }); }}><Sparkles size={14}/>Refine layout</button><p className="mi-note">Uses layered routing for groups or larger graphs, and more breathing room for smaller flows.</p></section>}
            <section className="mi-section mi-theme-section" aria-labelledby="mi-theme-title">
              <h3 id="mi-theme-title">Theme</h3>
              <div className="mi-theme-grid">
                {THEMES.map((item) => (
                  <button key={item.id} type="button" className={`mi-theme-card${settings.theme === item.id ? ' is-active' : ''}`}
                    aria-pressed={settings.theme === item.id} title={item.description} onClick={() => onSettings({ theme: item.id })}>
                    <span className="mi-theme-preview" style={{ backgroundColor: item.canvas }} aria-hidden="true">
                      <span className="mi-theme-line" style={{ backgroundColor: item.edge }} />
                      <span className="mi-theme-node mi-theme-node-first" style={{ background: `linear-gradient(135deg, ${item.node}, ${item.nodeEnd})`, borderColor: item.accent }} />
                      <span className="mi-theme-node mi-theme-node-last" style={{ backgroundColor: item.node, borderColor: item.border }} />
                      {settings.theme === item.id && <span className="mi-theme-check" style={{ backgroundColor: item.accent, color: item.canvas }}><Check size={11} strokeWidth={3} /></span>}
                    </span>
                    <span className="mi-theme-name">{item.name}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="mi-section" aria-labelledby="mi-surface-title">
              <h3 id="mi-surface-title">Surface</h3>
              <Choice label="Node finish" value={settings.finish} options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]} onChange={(finish) => onSettings({ finish })} />
              <Switch label="Soft shadows" checked={settings.shadow} onChange={(shadow) => onSettings({ shadow })} />
              <Switch label="Accent glow" checked={settings.glow} onChange={(glow) => onSettings({ glow })} />
            </section>

            <section className="mi-section" aria-labelledby="mi-motion-title">
              <div className="mi-section-heading"><h3 id="mi-motion-title"><Sparkles size={14} aria-hidden="true" />Motion</h3><button className="mi-icon-button" type="button" aria-label="Replay diagram entrance" title="Replay entrance" onClick={onReplay}><RotateCcw size={14} /></button></div>
              <Choice label="Connection effect" value={settings.motion} options={[{ value: 'none', label: 'Still' }, { value: 'flow', label: 'Flow' }, { value: 'pulse', label: 'Pulse' }]} onChange={(motion) => onSettings({ motion })} />
              {settings.motion !== 'none' && <Range label="Speed" min={0.25} max={3} step={0.25} value={settings.speed} display={`${settings.speed}×`} onChange={(speed) => onSettings({ speed })} />}
              {reducedMotion && <p className="mi-note">Reduced motion is enabled on this device.</p>}
            </section>

            <details className="mi-details">
              <summary><span>Connections & layout</span><ChevronDown size={14} aria-hidden="true" /></summary>
              <div className="mi-details-content">
                <div className="mi-field"><label htmlFor={layoutId} className="mi-label">Layout engine</label><select id={layoutId} value={settings.layout} onChange={(event) => onSettings({ layout: event.target.value as StudioSettings['layout'] })}><option value="elk">ELK · layered</option><option value="dagre">Dagre · classic</option></select></div>
                <Choice label="Line shape" value={settings.curve} disabled={settings.layout === 'elk'} options={[{ value: 'basis', label: 'Smooth' }, { value: 'linear', label: 'Direct' }, { value: 'step', label: 'Step' }]} onChange={(curve) => onSettings({ curve })} />
                <Choice label="Spacing" value={settings.spacing} disabled={settings.layout === 'elk'} options={[{ value: 'compact', label: 'Compact' }, { value: 'balanced', label: 'Balanced' }, { value: 'airy', label: 'Airy' }]} onChange={(spacing) => onSettings({ spacing })} />
                {settings.layout === 'elk' && <p className="mi-note">ELK sets its own routes and spacing. Choose Dagre to adjust them.</p>}
                <Range label="Line weight" min={0.8} max={5} step={0.2} value={settings.edgeWidth} display={`${settings.edgeWidth.toFixed(1)} px`} onChange={(edgeWidth) => onSettings({ edgeWidth })} />
                <p className="mi-note">Some diagram types keep their own layout and connector styles.</p>
              </div>
            </details>
          </>
        ) : (
          <>
            <section className="mi-section" aria-labelledby="mi-canvas-title">
              <h3 id="mi-canvas-title">Canvas</h3>
              <Choice label="Background pattern" value={settings.background} options={[{ value: 'dots', label: 'Dots' }, { value: 'grid', label: 'Grid' }, { value: 'none', label: 'Clear' }]} onChange={(background) => onSettings({ background })} />
              <Switch label="Ambient light" hint="A quiet wash of your theme color." checked={settings.ambient} onChange={(ambient) => onSettings({ ambient })} />
              <Choice label="Typography" value={settings.font} options={[{ value: 'sans', label: 'Sans serif' }, { value: 'mono', label: 'Monospace' }]} onChange={(font) => onSettings({ font })} />
            </section>

            <section className="mi-section" aria-labelledby="mi-frame-title">
              <h3 id="mi-frame-title">Frame</h3>
              <div className="mi-frame-grid" role="group" aria-label="Frame aspect ratio">
                {([
                  { value: 'auto', label: 'Auto', ratio: 'Fits diagram', shape: 'auto' },
                  { value: '16:9', label: 'Wide', ratio: '16:9', shape: 'wide' },
                  { value: '4:3', label: 'Standard', ratio: '4:3', shape: 'standard' },
                  { value: '1:1', label: 'Square', ratio: '1:1', shape: 'square' },
                ] as const).map((item) => (
                  <button key={item.value} type="button" className={`mi-frame-option${settings.frame === item.value ? ' is-active' : ''}`} aria-pressed={settings.frame === item.value} onClick={() => onSettings({ frame: item.value })}>
                    <span className={`mi-frame-shape mi-frame-shape-${item.shape}`} aria-hidden="true" /><span>{item.label}<small>{item.ratio}</small></span>
                  </button>
                ))}
              </div>
              <Range label="Frame padding" min={16} max={120} step={4} value={settings.padding} display={`${settings.padding} px`} onChange={(padding) => onSettings({ padding })} />
            </section>

            <section className="mi-section" aria-labelledby="mi-caption-title">
              <h3 id="mi-caption-title">Caption</h3>
              <Switch label="Show title & subtitle" checked={settings.showTitle} onChange={(showTitle) => onSettings({ showTitle })} />
              <div className="mi-field"><label htmlFor={titleId} className="mi-label">Title</label><input id={titleId} type="text" value={document.title} maxLength={120} onChange={(event) => onDocument({ title: event.target.value })} placeholder="Give your diagram a name" /></div>
              <div className="mi-field"><label htmlFor={subtitleId} className="mi-label">Subtitle <span className="mi-optional">optional</span></label><textarea id={subtitleId} rows={3} value={document.subtitle} maxLength={200} onChange={(event) => onDocument({ subtitle: event.target.value })} placeholder="A little context for your audience" /></div>
              <Switch label="Meridian signature" hint="A small credit below the diagram." checked={settings.showBrand} onChange={(showBrand) => onSettings({ showBrand })} />
            </section>
          </>
        )}
        <div className="mi-inspector-footer"><MousePointer2 size={12} aria-hidden="true" /><span>Select a node, connector, or group to style it.</span></div>
      </div>
    </div>
  );
}

export default Inspector;
