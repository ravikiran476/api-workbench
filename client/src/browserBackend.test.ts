import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserBackend as b } from './browserBackend';

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('browser storage', () => {
  it('persists collections and environments in localStorage', async () => {
    const c = await b.createCollection('  Demo  ');
    expect(c.name).toBe('Demo');
    await b.saveCollection({ ...c, name: 'Renamed' });
    const env = await b.createEnvironment('Prod');
    expect(await b.workspace()).toMatchObject({ collections: [{ name: 'Renamed' }], environments: [{ name: 'Prod' }] });

    await b.deleteEnvironment(env.id);
    await b.deleteCollection(c.id);
    expect(await b.workspace()).toEqual({ collections: [], environments: [] });
    await expect(b.deleteCollection(c.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(b.createCollection(' ')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('imports Postman collections', async () => {
    const result = await b.importPostman({
      info: { name: 'P', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{ name: 'r', request: 'https://x.dev/a' }],
      variable: [{ key: 'k', value: 'v' }],
    });
    expect(result.collection.requests).toHaveLength(1);
    expect((await b.workspace()).environments).toHaveLength(1);
  });
});

describe('sending from the browser', () => {
  it('sends directly, dropping forbidden headers and GET bodies with warnings', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init?: RequestInit) =>
      new Response('{"ok":true}', { status: 201, statusText: 'Created', headers: { 'Content-Type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await b.send({ method: 'GET', url: 'https://api.dev/x', headers: [['Cookie', 'a=1'], ['X-Ok', '1']], body: 'nope' });
    expect(res).toMatchObject({ status: 201, statusText: 'Created', body: '{"ok":true}', bodyEncoding: 'utf8', size: 11 });
    expect(res.warnings).toHaveLength(2);

    const init = fetchMock.mock.calls[0][1]!;
    expect(new Headers(init.headers).get('x-ok')).toBe('1');
    expect(new Headers(init.headers).has('cookie')).toBe(false);
    expect(init.body).toBeUndefined();
  });

  it('returns binary bodies as base64', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([0, 255, 1]), { headers: { 'Content-Type': 'image/png' } }));
    const res = await b.send({ method: 'GET', url: 'https://api.dev/img', headers: [] });
    expect(res).toMatchObject({ bodyEncoding: 'base64', body: 'AP8B', size: 3 });
  });

  it('explains network/CORS failures and propagates cancellation', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(b.send({ method: 'GET', url: 'https://api.dev', headers: [] })).rejects.toMatchObject({ code: 'BROWSER_FETCH_FAILED' });

    const controller = new AbortController();
    vi.stubGlobal('fetch', (_u: URL, init: RequestInit) => new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
    const pending = b.send({ method: 'GET', url: 'https://api.dev', headers: [] }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects non-http URLs', async () => {
    await expect(b.send({ method: 'GET', url: 'ftp://x', headers: [] })).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL' });
  });
});
