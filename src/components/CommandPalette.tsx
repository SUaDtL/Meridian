import { useEffect, useId, useState, type KeyboardEvent } from "react";
import Modal from "./Modal";
import { commandResultLimit, recentCommands, rememberCommand, searchCommands, type WorkspaceCommand } from "../lib/authoring/command-search";

export default function CommandPalette({ commands, onClose }: { commands: readonly WorkspaceCommand[]; onClose: () => void }) {
  const listId = useId();
  const [recent] = useState(recentCommands);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const results = searchCommands(commands, query, recent);
  const visible = results.slice(0, commandResultLimit);
  const active = visible[index];

  function optionId(command: WorkspaceCommand) { return `${listId}-${command.id}`; }

  useEffect(() => {
    if (active) document.getElementById(`${listId}-${active.id}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  function invoke(command: WorkspaceCommand | undefined) {
    if (!command || command.unavailable) return;
    rememberCommand(command.id);
    onClose();
    command.run();
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      invoke(active);
    }
    if (visible.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const next = index + (event.key === "ArrowDown" ? 1 : -1);
      setIndex((next + visible.length) % visible.length);
    }
  }

  return (
    <Modal title="Commands" onClose={onClose} initialFocus="[name='command-search']">
      <div className="heading-form command-palette">
        <label>Search commands
          <input name="command-search" role="combobox" type="text" autoComplete="off" maxLength={128}
            aria-autocomplete="list" aria-controls={listId} aria-expanded="true" aria-activedescendant={active && optionId(active)}
            value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={navigate} />
        </label>
        <ul id={listId} role="listbox" aria-label="Matching commands">
          {visible.map((command, position) => (
            <li id={optionId(command)} key={command.id} role="option" aria-selected={position === index}
              aria-disabled={command.unavailable ? true : undefined} onMouseDown={event => event.preventDefault()}
              onClick={() => { setIndex(position); invoke(command); }}>
              <strong>{command.title}</strong>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
              <small>{command.unavailable || command.category}</small>
            </li>
          ))}
        </ul>
        {results.length > commandResultLimit && <p>Showing 50 commands. Refine your search to see a narrower list.</p>}
        {!results.length && <p>No commands match. Try a command such as Undo or Export.</p>}
      </div>
    </Modal>
  );
}
