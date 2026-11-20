export const virtualRoot = 'https://meridian-import.invalid';

export function decodeReferencePart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('A schema reference contains a malformed percent escape.');
  }
}

/** Normalize paths before URL can silently discard a traversal above the virtual root. */
export function resolveAddress(address: string, base: string) {
  if (/[\u0000-\u0020\u007f\\?]/u.test(address) || address.startsWith('//')) {
    throw new Error('Schema reference paths cannot contain spaces, queries, backslashes or network-relative URLs.');
  }
  const absolute = /^https?:\/\/[^/]+/i.exec(address);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(address) && !absolute) return null;
  const rawPath = absolute ? address.slice(absolute[0].length) : address;
  if (!absolute && !rawPath) return base;
  const origin = new URL(absolute?.[0] ?? base);
  if (origin.username || origin.password) throw new Error('Schema reference identifiers cannot contain credentials.');
  const segments = absolute || rawPath.startsWith('/') ? [] : origin.pathname.split('/').slice(1, -1);
  const path = rawPath.replace(/^\//, '').split('/');
  for (const [index, raw] of path.entries()) {
    const decoded = decodeReferencePart(raw);
    if (/[\u0000-\u0020\u007f/\\]/u.test(decoded)) throw new Error('A schema reference encodes a prohibited path character.');
    if (decoded === '..') {
      if (!segments.length) throw new Error('A schema reference traverses outside its logical root.');
      segments.pop();
      if (index === path.length - 1) segments.push('');
    } else if (decoded === '.') {
      if (index === path.length - 1) segments.push('');
    } else {
      segments.push(encodeURIComponent(decoded));
    }
  }
  return new URL(origin.origin + '/' + segments.join('/')).href;
}
