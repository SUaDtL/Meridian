import { maxProcessConnections, type ProcessConnection, type ProcessConnections } from "../lib/authoring/process-connections";
import type { ProcessStep } from "../lib/authoring/process-steps";

export default function ProcessConnectionTable({ steps, connections, disabled, onChange }: {
  steps: readonly ProcessStep[];
  connections: ProcessConnections;
  disabled: boolean;
  onChange: (connections: ProcessConnections) => void;
}) {
  function editEdge(id: string, change: Partial<ProcessConnection>) {
    onChange({ ...connections, edges: connections.edges.map(edge => edge.id === id ? { ...edge, review: 'accepted', ...change } : edge) });
  }

  function removeEdge(id: string) {
    onChange({ ...connections, edges: connections.edges.filter(edge => edge.id !== id) });
  }

  function addEdge() {
    const [from, to] = steps;
    if (!from || !to || connections.edges.length >= maxProcessConnections) return;
    const edge: ProcessConnection = {
      id: `connection-${crypto.randomUUID()}`, from: from.line, to: to.line, label: '', review: 'needs-review',
    };
    onChange({ ...connections, edges: [...connections.edges, edge] });
  }

  return (
    <fieldset disabled={disabled} className="guided-process-fieldset">
      <legend>Explicit connections</legend>
      <p>Unchanged connections are retained. Review the decision branches. Use the same destination to join branches, or mark the last step of each branch as an end.</p>
      <ol className="guided-process-connections">
        {connections.edges.map((edge, index) => (
          <li key={edge.id}>
            <fieldset className="heading-form guided-process-fieldset">
              <legend>Connection {index + 1}</legend>
              {edge.review === 'needs-review' && <strong>Review connection</strong>}
              <label>From <select value={edge.from} onChange={event => editEdge(edge.id, { from: Number(event.target.value) })}>
                {steps.map(step => <option key={step.line} value={step.line}>{step.label} · line {step.line}</option>)}
              </select></label>
              <label>To <select value={edge.to} onChange={event => editEdge(edge.id, { to: Number(event.target.value) })}>
                {steps.map(step => <option key={step.line} value={step.line}>{step.label} · line {step.line}</option>)}
              </select></label>
              <label>Connection label <input value={edge.label} maxLength={400} onChange={event => editEdge(edge.id, { label: event.target.value })} /></label>
              <div className="dialog-actions">
                {edge.review === 'needs-review' && <button type="button" className="button" onClick={() => editEdge(edge.id, { review: 'accepted' })}>Keep connection</button>}
                <button type="button" className="button quiet" onClick={() => removeEdge(edge.id)}>Remove connection</button>
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <button type="button" className="button" disabled={steps.length < 2 || connections.edges.length >= maxProcessConnections} onClick={addEdge}>Add connection</button>
    </fieldset>
  );
}
