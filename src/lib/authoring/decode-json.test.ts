import { describe, expect, it } from 'vitest';
import { decodeJson, JsonInputError } from './decode-json';

describe('bounded JSON decoding', () => {
  it('preserves valid numbers, escapes, empty containers and legal scopes', () => {
    const source = ' { "first":{"id":1}, "other":{"id":"\\uD800"}, "value":[false,null,-1.25e-3,{},[]] }';
    expect(decodeJson(source)).toEqual(JSON.parse(source));
  });

  it.each([
    ['{"a":1,"\\u0061":2}', 'duplicate'],
    ['[{"\\u005f_proto__":0}]', 'forbidden'],
    ['{"a":[1,]}', 'syntax'],
    ['{"a":"\\p"}', 'syntax'],
    ['{} true', 'syntax'],
    ['1e400', 'number'],
    ['9007199254740993', 'number'],
    ['['.repeat(65) + '0' + ']'.repeat(65), 'depth'],
    ['[' + '0,'.repeat(50_000) + '0]', 'entries'],
  ])('rejects invalid or excessive input with %s', (source, code) => {
    const error = (() => {
      try {
        decodeJson(source);
      } catch (reason) {
        return reason;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(JsonInputError);
    expect(error).toMatchObject({ code });
  });
});
