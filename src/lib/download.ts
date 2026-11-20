/** Shared download lifecycle for project files and visual exports. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Leave the object URL alive long enough for slower mobile download handlers.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function safeFilename(title: string): string {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100).replace(/-+$/, '') || 'meridian-diagram';
}
