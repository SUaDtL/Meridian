import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { colorToHex } from '../lib/design';

export interface InspectorOption<T extends string = string> { value: T; label: string; detail?: string; }

export function ResetProperty({ label, onReset }: { label: string; onReset?: () => void }) {
  return onReset ? <button type="button" className="mi-property-reset" onClick={onReset} aria-label={`Reset ${label.toLowerCase()} to inherited`} title="Use the source and diagram style"><RotateCcw size={12}/><span>Reset</span></button> : null;
}

export function InspectorDisclosure({ title, hint, children, defaultOpen = false, className = '' }: {
  title: string; hint?: string; children: ReactNode; defaultOpen?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <details className={`mi-details ${className}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span><strong>{title}</strong>{hint && <small>{hint}</small>}</span><ChevronDown size={15} aria-hidden="true"/></summary>
    <div className="mi-details-content">{children}</div>
  </details>;
}

export function InspectorChoice<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string; value: T; options: InspectorOption<T>[]; onChange: (value: T) => void; disabled?: boolean;
}) {
  return <div className="mi-field"><span className="mi-label">{label}</span><div className="mi-choices" role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} className={`mi-choice${value === option.value ? ' is-active' : ''}`} disabled={disabled} onClick={() => onChange(option.value)} title={option.detail}>{option.label}</button>)}
  </div></div>;
}

export function InspectorSelect({ label, value, options, onChange, disabled = false, onReset, hint }: {
  label: string; value: string; options: InspectorOption[]; onChange: (value: string) => void; disabled?: boolean; onReset?: () => void; hint?: string;
}) {
  const id = useId(), hintId = `${id}-hint`;
  return <div className="mi-field"><div className="mi-field-heading"><label className="mi-label" htmlFor={id}>{label}</label><ResetProperty label={label} onReset={onReset}/></div>
    <select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} aria-describedby={hint ? hintId : undefined}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    {hint && <p id={hintId} className="mi-note">{hint}</p>}
  </div>;
}

export function InspectorSwitch({ label, hint, checked, onChange, onReset, inherited }: {
  label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void; onReset?: () => void; inherited?: boolean;
}) {
  const id = useId();
  return <div className="mi-switch-field"><label className="mi-switch-row" htmlFor={id}>
    <span className="mi-switch-copy"><span>{label}</span>{hint && <small>{hint}</small>}{inherited && <small>Inherited</small>}</span>
    <span className="mi-switch"><input id={id} type="checkbox" aria-label={label} checked={checked} onChange={event => onChange(event.target.checked)}/><span className="mi-switch-track" aria-hidden="true"><span/></span></span>
  </label><ResetProperty label={label} onReset={onReset}/></div>;
}

const round = (value: number) => Number(value.toFixed(3));

export function InspectorRange({ label, value, min, max, step, unit = '', onChange, onReset, inherited }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void; onReset?: () => void; inherited?: boolean;
}) {
  const id = useId(), valueId = `${id}-value`;
  const [draft, setDraft] = useState(String(round(value)));
  const editing = useRef(false), skipCommit = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(round(value))); }, [value]);
  const commit = () => {
    if (!draft.trim() || !Number.isFinite(Number(draft))) { setDraft(String(round(value))); return; }
    const next = round(Math.max(min, Math.min(max, Number(draft))));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return <div className="mi-field mi-range-field">
    <div className="mi-field-heading"><label className="mi-label" htmlFor={id}>{label}</label><ResetProperty label={label} onReset={onReset}/></div>
    <div className="mi-range-control"><input id={id} type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))} onChange={event => onChange(Number(event.target.value))}/>
      <span className="mi-number-unit"><input id={valueId} type="number" inputMode="decimal" aria-label={`${label} value`} min={min} max={max} step={step} value={draft} onFocus={() => { editing.current = true; }} onChange={event => {
        setDraft(event.target.value);
        const number = Number(event.target.value);
        if (event.target.value.trim() && Number.isFinite(number) && number >= min && number <= max) onChange(round(number));
      }} onBlur={() => {
        editing.current = false;
        if (skipCommit.current) { skipCommit.current = false; return; }
        commit();
      }} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.stopPropagation(); skipCommit.current = true; setDraft(String(round(value))); event.currentTarget.blur(); }
      }}/><span>{unit}</span></span>
    </div>{inherited && <span className="mi-inherited">Inherited · {round(value)}{unit ? ` ${unit}` : ''}</span>}
  </div>;
}

export function InspectorColor({ label, accessibleLabel, value, onChange, onReset, inherited, inheritedKind }: {
  label: string; accessibleLabel: string; value: string; onChange: (value: string) => void; onReset?: () => void; inherited: boolean; inheritedKind?: 'solid' | 'gradient' | 'none';
}) {
  const id = useId(), errorId = `${id}-error`;
  const [draft, setDraft] = useState(value), [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  const commit = () => {
    const normalized = colorToHex(draft.startsWith('#') ? draft : `#${draft}`);
    if (!normalized) { setInvalid(true); return; }
    setDraft(normalized); setInvalid(false);
    if (normalized !== value) onChange(normalized);
  };
  return <div className="mi-color-property"><div className="mi-field-heading"><label className="mi-label" htmlFor={id}>{label}</label><ResetProperty label={label} onReset={onReset}/></div>
    <div className="mi-color-control"><input id={id} type="color" aria-label={accessibleLabel} value={value} onChange={event => { setDraft(event.target.value); setInvalid(false); onChange(event.target.value); }}/>
      <input type="text" aria-label={`${label} hex color`} spellCheck={false} maxLength={7} value={draft} onChange={event => { setDraft(event.target.value); setInvalid(false); }} onBlur={commit} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        if (event.key === 'Escape') { event.stopPropagation(); setDraft(value); setInvalid(false); }
      }} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}/>
      <span className={`mi-value-origin${inherited ? '' : ' is-custom'}`}>{inherited ? inheritedKind === 'gradient' ? 'Gradient' : inheritedKind === 'none' ? 'No fill' : 'Inherited' : 'Custom'}</span>
    </div>{invalid && <p className="mi-field-error" id={errorId}>Enter a hex color, such as #2a7861.</p>}
  </div>;
}
