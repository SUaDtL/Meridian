import { Check, RotateCcw, X } from 'lucide-react';
import type { StudioDocument } from '../types';
import type { DesignState, ElementStyle, RenderElement } from '../types/design';
import { getTheme } from '../lib/themes';
import { createDesign } from '../lib/design';

interface Props {
  document: StudioDocument;
  element: RenderElement;
  selectedNode: { key: string; label: string } | null;
  onDesign: (design: DesignState) => void;
  onAccent: (color: string | null) => void;
  onClear: () => void;
}

export default function ElementInspector({ document, element, selectedNode, onDesign, onAccent, onClear }: Props) {
  const design = document.design ?? createDesign();
  const style = design.elements[element.key] ?? {};
  const settings = document.settings, theme = getTheme(settings.theme);
  const selectedAccent = selectedNode ? document.nodeAccents[selectedNode.key] : undefined;
  const supports = (capability: RenderElement['capabilities'][number]) => element.capabilities.includes(capability);
  const patch = (values: Partial<ElementStyle>) => {
    const next = { ...style, ...values };
    for (const key of Object.keys(next) as Array<keyof ElementStyle>) if (next[key] === undefined) delete next[key];
    onDesign({ ...design, elements: { ...design.elements, [element.key]: next } });
  };
  const reset = () => {
    const next = { ...design.elements }; delete next[element.key];
    onDesign({ ...design, elements: next });
    if (selectedNode) onAccent(null);
  };
  return <section className="mi-element-editor" aria-label="Selected element properties">
    <div className="mi-element-heading"><span className="mi-element-kind">{element.kind}</span><button type="button" className="mi-icon-button" aria-label="Clear element selection" onClick={onClear}><X size={14}/></button></div>
    <h3 className="mi-element-title">{element.label}</h3><code className="mi-element-id">{element.sourceId}</code>
    <p className="mi-note">Overrides belong to this project. Your Mermaid source stays unchanged.</p>
    <button className="mi-text-button" type="button" onClick={reset} disabled={!Object.keys(style).length && !selectedAccent}><RotateCcw size={12}/>Reset element styling</button>
    <section className="mi-section"><h3>Color</h3><div className="mi-color-grid">
      {supports('fill') && <label className="mi-color-field"><span>Fill</span><input aria-label="Element fill" type="color" value={style.fill ?? (element.kind === 'group' ? theme.cluster : theme.node)} onChange={event => patch({ fill: event.target.value })}/></label>}
      {supports('stroke') && <label className="mi-color-field"><span>{element.kind === 'edge' ? 'Line' : 'Border'}</span><input aria-label="Element stroke" type="color" value={style.stroke ?? (element.kind === 'edge' ? theme.edge : theme.border)} onChange={event => patch({ stroke: event.target.value })}/></label>}
      {supports('text') && <label className="mi-color-field"><span>Text</span><input aria-label="Element text color" type="color" value={style.color ?? theme.text} onChange={event => patch({ color: event.target.value })}/></label>}
    </div>
    {selectedNode && <><span className="mi-label">Node accent</span><div className="mi-accent-palette" role="group" aria-label="Node accent color">{theme.palette.map(color => <button key={color} type="button" className={`mi-accent${selectedAccent === color ? ' is-active' : ''}`} style={{ backgroundColor: color }} aria-label={`Set node accent to ${color}`} aria-pressed={selectedAccent === color} title={color} onClick={() => onAccent(color)}>{selectedAccent === color && <Check size={12}/>}</button>)}<label className="mi-custom-accent" title="Choose a custom node accent"><span aria-hidden="true">+</span><input type="color" aria-label="Custom node accent" value={selectedAccent ?? theme.accent} onChange={event => onAccent(event.target.value)}/></label></div><button type="button" className="mi-text-button" onClick={() => onAccent(null)} disabled={!selectedAccent}><RotateCcw size={12}/>Reset node color</button></>}
    </section>
    {supports('typography') && <section className="mi-section"><h3>Typography</h3>
      <div className="mi-field"><label className="mi-label" htmlFor="element-font">Font</label><select id="element-font" value={style.font ?? ''} onChange={event => patch({ font: event.target.value ? event.target.value as ElementStyle['font'] : undefined })}><option value="">From diagram</option><option value="sans">Sans serif</option><option value="mono">Monospace</option><option value="serif">Serif</option></select></div>
      <div className="mi-field mi-range-field"><div className="mi-field-heading"><label className="mi-label" htmlFor="element-font-size">Element font size</label><output htmlFor="element-font-size">{style.fontSize ?? 16} px</output></div><input id="element-font-size" type="range" min={10} max={40} step={1} value={style.fontSize ?? 16} onChange={event => patch({ fontSize: Number(event.target.value) })}/></div>
      <div className="mi-field"><label className="mi-label" htmlFor="element-font-weight">Font weight</label><select id="element-font-weight" value={style.fontWeight ?? ''} onChange={event => patch({ fontWeight: event.target.value ? event.target.value as ElementStyle['fontWeight'] : undefined })}><option value="">From source</option><option value="normal">Regular</option><option value="bold">Bold</option></select></div>
    </section>}
    {supports('shape') && <section className="mi-section"><h3>Shape</h3><div className="mi-field"><label className="mi-label" htmlFor="element-shape">Node shape</label><select id="element-shape" value={style.shape ?? ''} onChange={event => patch({ shape: event.target.value ? event.target.value as ElementStyle['shape'] : undefined })}><option value="">From source</option><option value="rect">Rectangle</option><option value="rounded">Rounded rectangle</option><option value="stadium">Pill</option><option value="diamond">Decision</option><option value="circle">Circle</option><option value="cylinder">Database</option><option value="hexagon">Hexagon</option></select></div><p className="mi-note">The diagram lays out again around the new shape and label size.</p></section>}
    {supports('stroke') && <section className="mi-section"><h3>{element.kind === 'edge' ? 'Connector' : 'Border'}</h3>
      <div className="mi-field mi-range-field"><div className="mi-field-heading"><label className="mi-label" htmlFor="element-line-weight">Element line weight</label><output htmlFor="element-line-weight">{style.strokeWidth ?? settings.edgeWidth} px</output></div><input id="element-line-weight" type="range" min={.5} max={6} step={.5} value={style.strokeWidth ?? settings.edgeWidth} onChange={event => patch({ strokeWidth: Number(event.target.value) })}/></div>
      <div className="mi-field"><label className="mi-label" htmlFor="element-line-style">Element line style</label><select id="element-line-style" value={style.lineStyle ?? ''} onChange={event => patch({ lineStyle: event.target.value ? event.target.value as ElementStyle['lineStyle'] : undefined })}><option value="">From source</option><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></div>
      {supports('arrowhead') && <div className="mi-field"><label className="mi-label" htmlFor="element-arrowhead">Arrowheads</label><select id="element-arrowhead" value={style.arrowhead ?? 'source'} onChange={event => patch({ arrowhead: event.target.value as ElementStyle['arrowhead'] })}><option value="source">From source</option><option value="none">None</option><option value="arrow">End arrow</option><option value="both">Both ends</option><option value="circle">End circle</option><option value="diamond">End diamond</option></select></div>}
      {element.kind === 'edge' && <><div className="mi-field"><label className="mi-label" htmlFor="element-routing">Route shape</label><select id="element-routing" disabled={!supports('routing')} value={style.routing ?? ''} onChange={event => patch({ routing: event.target.value ? event.target.value as ElementStyle['routing'] : undefined })}><option value="">From diagram</option><option value="smooth">Smooth</option><option value="direct">Direct</option><option value="orthogonal">Right angles</option></select></div>{!supports('routing') && <p className="mi-note">ELK routes around nodes automatically. Choose Dagre in Look to set individual route shapes.</p>}</>}
    </section>}
    <section className="mi-section"><h3>Emphasis</h3><div className="mi-field"><label className="mi-label" htmlFor="element-emphasis">Element emphasis</label><select id="element-emphasis" value={style.emphasis ?? 'normal'} onChange={event => patch({ emphasis: event.target.value as ElementStyle['emphasis'] })}><option value="normal">Normal</option><option value="muted">Muted</option><option value="highlight">Highlight</option></select></div>
      {supports('effects') && <><label className="mi-switch-row"><span className="mi-switch-copy">Element shadow</span><span className="mi-switch"><input type="checkbox" checked={style.shadow ?? settings.shadow} onChange={event => patch({ shadow: event.target.checked })}/><span className="mi-switch-track" aria-hidden="true"><span/></span></span></label><label className="mi-switch-row"><span className="mi-switch-copy">Element glow</span><span className="mi-switch"><input type="checkbox" checked={style.glow ?? settings.glow} onChange={event => patch({ glow: event.target.checked })}/><span className="mi-switch-track" aria-hidden="true"><span/></span></span></label></>}
    </section>
    {!supports('typography') && <p className="mi-note">This element supports color and effects. Shape and measured typography editing are available for standard flowchart IDs.</p>}
  </section>;
}
