export type WorkspaceCommand = {
  id: string;
  title: string;
  category: string;
  synonyms?: readonly string[];
  shortcut?: string;
  unavailable?: string;
  run: () => void;
};

const recentKey = 'meridian:recent-commands';
const recentLimit = 10;
export const commandResultLimit = 50;

export function searchCommands(commands: readonly WorkspaceCommand[], query: string, recent: readonly string[]) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    const positions = new Map(recent.map((id, index) => [id, index]));
    return [...commands].sort((a, b) => (positions.get(a.id) ?? recent.length) - (positions.get(b.id) ?? recent.length)
      || compareCommand(a, b));
  }
  return commands.flatMap(command => {
    const terms = [command.title, ...(command.synonyms ?? [])].map(term => term.toLowerCase());
    const rank = terms.some(term => term.startsWith(normalized)) ? 0
      : terms.some(term => term.split(/\s+/).some(word => word.startsWith(normalized))) ? 1
      : terms.some(term => term.includes(normalized)) ? 2 : -1;
    return rank < 0 ? [] : [{ command, rank }];
  }).sort((a, b) => a.rank - b.rank || compareCommand(a.command, b.command)).map(item => item.command);
}

function compareCommand(a: WorkspaceCommand, b: WorkspaceCommand) {
  return a.category.localeCompare(b.category, 'en') || a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id, 'en');
}

export function recentCommands(): string[] {
  try {
    const raw = localStorage.getItem(recentKey);
    if (!raw || raw.length > 1_024) return [];
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) ? [...new Set(ids.filter(id => typeof id === 'string' && /^[a-z0-9-]{1,64}$/.test(id)))].slice(0, recentLimit) : [];
  } catch {
    return [];
  }
}

export function rememberCommand(id: string) {
  try {
    localStorage.setItem(recentKey, JSON.stringify([id, ...recentCommands().filter(recent => recent !== id)].slice(0, recentLimit)));
  } catch {
    // Search still works when browser storage is unavailable.
  }
}
