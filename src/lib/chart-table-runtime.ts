/** Runs as a self-contained inline script in a disconnected chart export. */
export function chartTableRuntime() {
  const controls = document.querySelector<HTMLElement>('[data-table-controls]');
  const search = controls?.querySelector<HTMLInputElement>('[data-table-search]');
  const status = controls?.querySelector<HTMLElement>('[data-table-status]');
  if (!controls || !search || !status) return;
  const columns = Array.from(controls.querySelectorAll<HTMLInputElement>('[data-table-column]'));
  const pages = Array.from(document.querySelectorAll<HTMLDetailsElement>('[data-table-page]'));
  const tables = pages.map(page => {
    const cells = Array.from(page.querySelectorAll<HTMLTableRowElement>('tr')).map(row => Array.from(row.cells));
    const rows = Array.from(page.querySelectorAll<HTMLTableRowElement>('tbody tr')).map(row => ({
      row, label: row.cells[0]?.textContent ?? '', text: Array.from(row.cells, cell => cell.textContent?.toLowerCase() ?? ''),
    }));
    return { page, rows, cells };
  });
  let current = '';
  let rowStatus = '';

  function announce() {
    if (status) status.textContent = current + rowStatus;
  }

  function filter() {
    if (!search) return;
    const query = search.value.trim().toLowerCase();
    let matches = 0;
    let first = true;
    for (const { page, rows } of tables) {
      let initial = true;
      for (const item of rows) {
        const matched = !query || item.text.some(value => value.includes(query));
        item.row.hidden = !matched;
        item.row.tabIndex = matched && initial ? 0 : -1;
        if (matched) { matches++; initial = false; }
      }
      page.hidden = initial;
      page.open = !initial && first;
      if (!initial) first = false;
    }
    current = matches ? `${matches} matching ${matches === 1 ? 'row' : 'rows'}.` : 'No matching rows.';
    rowStatus = '';
    announce();
  }

  function showColumns() {
    const shown = columns.filter(column => column.checked).length;
    for (const { cells } of tables) {
      for (const line of cells) line.forEach((cell, index) => { cell.hidden = !columns[index]?.checked; });
    }
    columns.forEach(column => { column.disabled = shown === 1 && column.checked; });
  }

  search.addEventListener('input', filter);
  columns.forEach(column => column.addEventListener('change', showColumns));
  for (const { page, rows } of tables) {
    page.addEventListener('focusin', event => {
      const index = rows.findIndex(item => item.row === event.target);
      if (index < 0) return;
      for (const [position, item] of rows.entries()) item.row.tabIndex = position === index ? 0 : -1;
      rowStatus = ` Focused row ${Number(page.dataset.tablePage) + index + 1}, ${rows[index].label}.`;
      announce();
    });
    page.addEventListener('keydown', event => {
      const visible = rows.filter(item => !item.row.hidden);
      const index = visible.findIndex(item => item.row === event.target);
      if (index < 0 || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const offsets: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: visible.length - 1 };
      if (!Object.hasOwn(offsets, event.key)) return;
      event.preventDefault();
      visible[Math.max(0, Math.min(visible.length - 1, offsets[event.key]))].row.focus();
    });
  }
  controls.hidden = false;
  showColumns();
  filter();
}
