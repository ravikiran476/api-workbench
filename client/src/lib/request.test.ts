import { describe, expect, it } from 'vitest';
import type { ApiRequest, KeyValue } from '../../../shared/types';
import { newRequest, paramsFromUrl, prepareRequest, toCurl, urlWithParams } from './request';

const kv = (key: string, value: string, enabled = true): KeyValue => ({ id: `${key}-id`, key, value, enabled });
const req = (o: Partial<ApiRequest>): ApiRequest => ({ ...newRequest(), ...o });

describe('URL ⇄ params sync', () => {
  it('parses query into params, keeping disabled ones and existing ids', () => {
    const current = [kv('a', '1'), kv('off', 'x', false)];
    const next = paramsFromUrl('https://x.io/p?a=2&b&c={{v}}#frag', current);
    expect(next.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['a', '2', true],
      ['b', '', true],
      ['c', '{{v}}', true],
      ['off', 'x', false],
    ]);
    expect(next[0].id).toBe('a-id');
  });

  it('rebuilds the URL from enabled params and preserves the fragment', () => {
    expect(urlWithParams('https://x.io/p?old=1#top', [kv('a', '1'), kv('b', ''), kv('c', '3', false)])).toBe('https://x.io/p?a=1&b#top');
    expect(urlWithParams('https://x.io/p?old=1', [])).toBe('https://x.io/p');
  });
});

describe('prepareRequest', () => {
  const env = [kv('baseUrl', 'https://api.dev'), kv('token', 'T0K'), kv('disabled', 'no', false)];

  it('substitutes variables and reports unresolved ones', () => {
    const { request, unresolved } = prepareRequest(
      req({ url: '{{baseUrl}}/users/{{ id }}', headers: [kv('X-Env', '{{disabled}}')] }),
      env,
    );
    expect(request.url).toBe('https://api.dev/users/{{ id }}');
    expect(unresolved.sort()).toEqual(['disabled', 'id']);
  });

  it('adds a default scheme', () => {
    expect(prepareRequest(req({ url: 'localhost:3000/x' }), []).request.url).toBe('http://localhost:3000/x');
    expect(prepareRequest(req({ url: 'api.dev/x' }), [], 'https').request.url).toBe('https://api.dev/x');
  });

  it('applies bearer auth without overriding an explicit Authorization header', () => {
    const r = prepareRequest(req({ url: 'http://x', auth: { type: 'bearer', token: '{{token}}' } }), env).request;
    expect(r.headers).toContainEqual(['Authorization', 'Bearer T0K']);
    const r2 = prepareRequest(req({ url: 'http://x', headers: [kv('authorization', 'Custom')], auth: { type: 'bearer', token: 't' } }), env).request;
    expect(r2.headers).toEqual([['authorization', 'Custom']]);
  });

  it('encodes basic auth as UTF-8', () => {
    const r = prepareRequest(req({ url: 'http://x', auth: { type: 'basic', username: 'josé', password: 'pä' } }), []).request;
    expect(r.headers).toContainEqual(['Authorization', 'Basic am9zw6k6cMOk']); // base64(UTF-8 "josé:pä")
  });

  it('puts API keys in the query string', () => {
    const r = prepareRequest(req({ url: 'http://x/a?b=1#h', auth: { type: 'apikey', key: 'api key', value: 'v&1', in: 'query' } }), []).request;
    expect(r.url).toBe('http://x/a?b=1&api%20key=v%261#h');
  });

  it('sets bodies and default content types', () => {
    const json = prepareRequest(req({ method: 'POST', url: 'http://x', body: { mode: 'json', text: '{"t":"{{token}}"}' } }), env).request;
    expect(json.body).toBe('{"t":"T0K"}');
    expect(json.headers).toContainEqual(['Content-Type', 'application/json']);

    const form = prepareRequest(
      req({ method: 'POST', url: 'http://x', body: { mode: 'urlencoded', fields: [kv('a b', '1&2'), kv('skip', 'x', false)] } }),
      [],
    ).request;
    expect(form.body).toBe('a+b=1%262');
    expect(form.headers).toContainEqual(['Content-Type', 'application/x-www-form-urlencoded']);
  });
});

describe('toCurl', () => {
  it('quotes safely for POSIX shells', () => {
    expect(toCurl({ method: 'POST', url: 'http://x', headers: [['A', "it's"]], body: '{}' })).toBe(
      `curl -X POST 'http://x' \\\n  -H 'A: it'\\''s' \\\n  --data-raw '{}'`,
    );
  });
});
