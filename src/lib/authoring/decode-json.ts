const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const maxDepth = 64;
const maxEntries = 50_000;

export class JsonInputError extends Error {
  constructor(readonly code: 'syntax' | 'depth' | 'entries' | 'duplicate' | 'forbidden' | 'number') {
    super({
      syntax: 'This is not valid JSON.',
      depth: 'The JSON is nested too deeply.',
      entries: 'The JSON contains too many values.',
      duplicate: 'The JSON contains a repeated object key.',
      forbidden: 'The JSON contains a reserved object key.',
      number: 'The JSON contains a number outside the supported range.',
    }[code]);
    this.name = 'JsonInputError';
  }
}

/** Check object keys and bounds before JSON.parse can discard repeated keys. */
export function decodeJson(text: string, entryLimit = maxEntries, numericTokens: 'number' | 'text' = 'number'): unknown {
  const scalar = /(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/y;
  let offset = 0;
  let entries = 0;
  let copyFrom = 0;
  const preserved: string[] = [];
  const syntax = () => new JsonInputError('syntax');
  const skipWhitespace = () => {
    while (text[offset] === ' ' || text[offset] === '\t' || text[offset] === '\n' || text[offset] === '\r') offset++;
  };
  const readString = () => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') offset++;
      else if (char === '"') return text.slice(start, offset);
    }
    throw syntax();
  };

  function visit(depth: number) {
    if (depth > maxDepth) throw new JsonInputError('depth');
    if (++entries > entryLimit) throw new JsonInputError('entries');
    skipWhitespace();
    const start = text[offset];
    if (start === '"') {
      readString();
      return;
    }
    if (start === '{' || start === '[') {
      const object = start === '{';
      const close = object ? '}' : ']';
      const keys = new Set<string>();
      offset++;
      skipWhitespace();
      if (text[offset] === close) {
        offset++;
        return;
      }
      for (;;) {
        if (object) {
          if (text[offset] !== '"') throw syntax();
          let key: string;
          try {
            key = JSON.parse(readString()) as string;
          } catch {
            throw syntax();
          }
          if (forbidden.has(key)) throw new JsonInputError('forbidden');
          if (keys.has(key)) throw new JsonInputError('duplicate');
          keys.add(key);
          skipWhitespace();
          if (text[offset++] !== ':') throw syntax();
        }
        visit(depth + 1);
        skipWhitespace();
        if (text[offset] === close) {
          offset++;
          return;
        }
        if (text[offset++] !== ',') throw syntax();
        skipWhitespace();
      }
    }
    scalar.lastIndex = offset;
    const token = scalar.exec(text)?.[0];
    if (!token) throw syntax();
    if (start === '-' || (start >= '0' && start <= '9')) {
      if (numericTokens === 'text') {
        preserved.push(text.slice(copyFrom, offset), `"${token}"`);
        copyFrom = scalar.lastIndex;
      } else {
        const value = Number(token);
        if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
          throw new JsonInputError('number');
        }
      }
    }
    offset = scalar.lastIndex;
  }

  visit(0);
  skipWhitespace();
  if (offset !== text.length) throw syntax();
  try {
    const input = preserved.length ? preserved.join('') + text.slice(copyFrom) : text;
    return JSON.parse(input) as unknown;
  } catch {
    throw syntax();
  }
}
