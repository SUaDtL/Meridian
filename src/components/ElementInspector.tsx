import { Check, RotateCcw, X } from 'lucide-react';
import type { StudioDocument } from '../types';
import type { DesignState, ElementStyle, RenderElement } from '../types/design';
import { getTheme } from '../lib/themes';
import { colorToHex, createDesign, patchElementStyle, suggestedNodeFills } from '../lib/design';
import { InspectorColor, InspectorDisclosure, InspectorRange, InspectorSelect, InspectorSwitch } from './InspectorControls';

interface Props {
  document: StudioDocument;
  element: RenderElement;
  selectedNode: { key: string; label: string } | null;
  onDesign: (design: DesignState) => void;
  onAccent: (color: string | null) => void;
  onReset: () => void;
  onClear: () => void;
}

const fontName = (family: string | undefined, fallback: string) => family?.split(',')[0].trim().replace(/^["']|["']$/g, '') || fallback;

export default function ElementInspector({ document, element, selectedNode, onDesign, onAccent, onReset, onClear }: Props) {
  const design = document.design ?? createDesign();
  const style = design.elements[element.key] ?? {};
  const settings = document.settings, theme = getTheme(settings.theme), appearance = element.appearance;
  const selectedAccent = selectedNode ? document.nodeAccents[selectedNode.key] : undefined;
  const supports = (capability: RenderElement['capabilities'][number]) => element.capabilities.includes(capability);
  const patch = (values: Partial<ElementStyle>) => {
    const next = patchElementStyle(design, element.key, values);
    if (next !== design) onDesign(next);
  };
  const reset = (property: keyof ElementStyle) => style[property] === undefined ? undefined : () => patch({ [property]: undefined });
  const customCount = Object.keys(style).length + (selectedAccent ? 1 : 0);
  const isEdge = element.kind === 'edge';
  const fill = style.fill ?? appearance?.fill ?? (element.kind === 'group' ? theme.cluster : theme.node);
  const stroke = style.stroke ?? appearance?.stroke ?? (isEdge ? theme.edge : theme.border);
  const color = style.color ?? appearance?.color ?? theme.text;
  const inheritedFont = fontName(appearance?.fontFamily, settings.font === 'mono' ? 'Monospace' : 'Sans serif');
  const weight = Number(appearance?.fontWeight);
  const inheritedWeight = weight >= 700 ? 'Bold' : weight >= 600 ? 'Semibold' : 'Regular';
  const inheritedLine = appearance?.lineStyle ?? 'solid';

  return <section className="mi-element-editor" aria-label="Selected element properties">
    <div className="mi-element-heading"><span className="mi-element-kind">{isEdge ? 'Connector' : element.kind}</span><button type="button" className="mi-icon-button" aria-label="Clear element selection" onClick={onClear}><X size={15}/></button></div>
    <h3 className="mi-element-title">{element.label}</h3>
    <p className="mi-note mi-selection-note">{customCount ? `${customCount} custom ${customCount === 1 ? 'property' : 'properties'}` : 'Using source and diagram styles'} · Source stays unchanged.</p>

    {supports('shape') && <section className="mi-section mi-element-shape"><InspectorSelect label="Node shape" value={style.shape ?? ''} onChange={value => patch({ shape: value ? value as ElementStyle['shape'] : undefined })} onReset={reset('shape')} options={[
      { value: '', label: 'Inherited from source' }, { value: 'rect', label: 'Rectangle' }, { value: 'rounded', label: 'Rounded rectangle' },
      { value: 'stadium', label: 'Pill' }, { value: 'diamond', label: 'Decision' }, { value: 'circle', label: 'Circle' },
      { value: 'cylinder', label: 'Database' }, { value: 'hexagon', label: 'Hexagon' },
    ]}/></section>}

    <section className="mi-section mi-element-colors"><h3>Colors</h3>
      {supports('fill') && <InspectorColor label="Fill" accessibleLabel="Element fill" value={fill} inherited={style.fill === undefined} inheritedKind={appearance?.fillKind} onChange={value => patch({ fill: value })} onReset={reset('fill')}/>}
      {supports('stroke') && <InspectorColor label={isEdge ? 'Line' : 'Border'} accessibleLabel="Element stroke" value={stroke} inherited={style.stroke === undefined} onChange={value => patch({ stroke: value })} onReset={reset('stroke')}/>}
      {supports('text') && <InspectorColor label="Text" accessibleLabel="Element text color" value={color} inherited={style.color === undefined} onChange={value => patch({ color: value })} onReset={reset('color')}/>}
      {supports('fill') && <div className="mi-fill-palette" role="group" aria-label="Quick fill colors"><span>Quick fill</span>{suggestedNodeFills(theme).map(value => <button key={value} type="button" className="mi-fill-swatch" style={{ backgroundColor: value }} aria-label={`Set fill to ${value}`} aria-pressed={colorToHex(fill) === colorToHex(value)} title={value} onClick={() => patch({ fill: value })}>{colorToHex(fill) === colorToHex(value) && <Check size={12}/>}</button>)}</div>}
      {selectedAccent && <div className="mi-coordinated-color"><span>Coordinated node color is active.</span><button type="button" className="mi-text-button" onClick={() => onAccent(null)}><RotateCcw size={12}/>Reset node color</button></div>}
    </section>

    {supports('typography') && <InspectorDisclosure title="Typography" hint="Font, size, and weight" defaultOpen={Boolean(style.font || style.fontSize || style.fontWeight)}>
      <InspectorSelect label="Font" value={style.font ?? ''} onChange={value => patch({ font: value ? value as ElementStyle['font'] : undefined })} onReset={reset('font')} options={[
        { value: '', label: `Inherited · ${inheritedFont}` }, { value: 'sans', label: 'Sans serif' }, { value: 'mono', label: 'Monospace' }, { value: 'serif', label: 'Serif' },
      ]}/>
      <InspectorRange label="Element font size" min={10} max={40} step={.1} value={style.fontSize ?? appearance?.fontSize ?? (isEdge ? 13 : element.kind === 'group' ? 14 : 16)} unit="px" inherited={style.fontSize === undefined} onChange={value => patch({ fontSize: value })} onReset={reset('fontSize')}/>
      <InspectorSelect label="Font weight" value={style.fontWeight ?? ''} onChange={value => patch({ fontWeight: value ? value as ElementStyle['fontWeight'] : undefined })} onReset={reset('fontWeight')} options={[
        { value: '', label: `Inherited · ${inheritedWeight}` }, { value: 'normal', label: 'Regular' }, { value: 'bold', label: 'Bold' },
      ]}/>
      <p className="mi-note">The layout adjusts to fit the new label size.</p>
    </InspectorDisclosure>}

    {supports('stroke') && <InspectorDisclosure title={isEdge ? 'Connector' : 'Border'} hint={isEdge ? 'Arrowheads, weight, and route' : 'Weight and line style'} defaultOpen={isEdge || style.strokeWidth !== undefined || style.lineStyle !== undefined}>
      {supports('arrowhead') && <InspectorSelect label="Arrowheads" value={style.arrowhead ?? 'source'} onChange={value => patch({ arrowhead: value as ElementStyle['arrowhead'] })} onReset={reset('arrowhead')} options={[
        { value: 'source', label: 'Inherited from source' }, { value: 'none', label: 'None' }, { value: 'arrow', label: 'End arrow' },
        { value: 'both', label: 'Both ends' }, { value: 'circle', label: 'End circle' }, { value: 'diamond', label: 'End diamond' },
      ]}/>}
      <InspectorRange label="Element line weight" min={.5} max={6} step={.1} value={style.strokeWidth ?? appearance?.strokeWidth ?? (isEdge ? settings.edgeWidth : 1)} unit="px" inherited={style.strokeWidth === undefined} onChange={value => patch({ strokeWidth: value })} onReset={reset('strokeWidth')}/>
      <InspectorSelect label="Element line style" value={style.lineStyle ?? ''} onChange={value => patch({ lineStyle: value ? value as ElementStyle['lineStyle'] : undefined })} onReset={reset('lineStyle')} options={[
        { value: '', label: `Inherited · ${inheritedLine[0].toUpperCase()}${inheritedLine.slice(1)}` }, { value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' },
      ]}/>
      {isEdge && <InspectorSelect label="Route shape" value={style.routing ?? ''} disabled={!supports('routing')} onChange={value => patch({ routing: value ? value as ElementStyle['routing'] : undefined })} onReset={reset('routing')} hint={!supports('routing') ? 'ELK routes around nodes automatically. Choose Dagre in Diagram → Connections & layout to set a route.' : undefined} options={[
        { value: '', label: 'Inherited from diagram' }, { value: 'smooth', label: 'Smooth' }, { value: 'direct', label: 'Direct' }, { value: 'orthogonal', label: 'Right angles' },
      ]}/>}
    </InspectorDisclosure>}

    <InspectorDisclosure title="Emphasis & effects" hint="Highlight, mute, shadow, and glow" defaultOpen={Boolean(style.emphasis || style.shadow !== undefined || style.glow !== undefined)}>
      <InspectorSelect label="Element emphasis" value={style.emphasis ?? 'normal'} onChange={value => patch({ emphasis: value as ElementStyle['emphasis'] })} onReset={reset('emphasis')} options={[
        { value: 'normal', label: 'Normal' }, { value: 'muted', label: 'Muted' }, { value: 'highlight', label: 'Highlight' },
      ]}/>
      {supports('effects') && <>
        <InspectorSwitch label="Element shadow" checked={style.shadow ?? (element.kind === 'node' && settings.shadow)} inherited={style.shadow === undefined} onChange={value => patch({ shadow: value })} onReset={reset('shadow')}/>
        <InspectorSwitch label="Element glow" checked={style.glow ?? (style.emphasis === 'highlight' || (element.kind === 'node' && settings.glow))} inherited={style.glow === undefined} onChange={value => patch({ glow: value })} onReset={reset('glow')}/>
      </>}
    </InspectorDisclosure>

    {isEdge && !supports('text') && <p className="mi-note">Add a connector label in the source to style its text.</p>}
    {!isEdge && !supports('typography') && <p className="mi-note">This diagram uses native shapes and typography. Colors and effects remain editable.</p>}
    <div className="mi-element-actions"><button className="mi-text-button" type="button" onClick={onReset} disabled={!customCount}><RotateCcw size={13}/>Reset element styling</button><span>Restores source and diagram styles.</span></div>
    <InspectorDisclosure title="Element information" hint="Source identity and group membership">
      <span className="mi-label">Source ID</span><code className="mi-element-id">{element.sourceId}</code>
      {element.kind === 'group' && <p className="mi-note">{element.members?.length ?? 0} contained elements. Group styles apply to its boundary and label.</p>}
      {element.parentKey && <p className="mi-note">Inside {element.parentKey.slice(6)}.</p>}
    </InspectorDisclosure>
  </section>;
}
