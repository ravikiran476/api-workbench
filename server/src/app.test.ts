import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiRequest, Collection, ImportResult, ProxyResponse } from '../../shared/types';
import { createApp } from './app';
import { exportPostman, importPostman } from './postman';
import { WorkspaceStore } from './store';

// ── Target server the proxy talks to ──
let target: Server;
let targetUrl: string;
let closedPortUrl: string;

beforeAll(async () => {
  const t = express();
  t.use(express.text({ type: '*/*' }));
  t.all('/echo', (req, res) => {
    res.json({ method: req.method, headers: req.headers, query: req.query, body: typeof req.body === 'string' ? req.body : '' });
  });
  t.get('/slow', (_req, res) => {
    setTimeout(() => res.send('late'), 500);
  });
  t.get('/binary', (_req, res) => {
    res.type('application/octet-stream').send(Buffer.from([0, 1, 2, 255]));
  });
  t.get('/redirect', (_req, res) => res.redirect('/echo'));
  t.get('/missing', (_req, res) => res.status(404).json({ error: 'nope' }));
  target = await listen(t);
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;

  const tmp = await listen(express());
  closedPortUrl = `http://127.0.0.1:${(tmp.address() as AddressInfo).port}`;
  await new Promise((r) => tmp.close(r));
});

afterAll(() => new Promise((r) => target.close(r)));

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
}

// ── App under test ──
let dir: string;
let store: WorkspaceStore;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'apiwb-'));
  store = new WorkspaceStore(path.join(dir, 'workspace.json'));
  await store.load();
  app = createApp({ store });
  return () => rm(dir, { recursive: true, force: true });
});

const sampleRequest = (overrides: Partial<ApiRequest> = {}): ApiRequest => ({
  id: 'r1',
  name: 'Get users',
  method: 'GET',
  url: 'https://api.example.com/users?page=2',
  params: [
    { id: 'p1', key: 'page', value: '2', enabled: true },
    { id: 'p2', key: 'debug', value: 'true', enabled: false },
  ],
  headers: [{ id: 'h1', key: 'Accept', value: 'application/json', enabled: true }],
  auth: { type: 'bearer', token: '{{token}}' },
  body: { mode: 'none' },
  ...overrides,
});

describe('collections', () => {
  it('creates, updates, persists and deletes', async () => {
    const created = await request(app).post('/api/collections').send({ name: 'Users API' }).expect(201);
    const c = created.body as Collection;
    expect(c).toMatchObject({ name: 'Users API', requests: [] });

    const updated = await request(app)
      .put(`/api/collections/${c.id}`)
      .send({ ...c, requests: [sampleRequest()] })
      .expect(200);
    expect(updated.body.requests).toHaveLength(1);

    // A fresh store reading the same file sees the change.
    const reloaded = new WorkspaceStore(path.join(dir, 'workspace.json'));
    await reloaded.load();
    expect(reloaded.get().collections[0].requests[0].name).toBe('Get users');

    await request(app).delete(`/api/collections/${c.id}`).expect(204);
    await request(app).delete(`/api/collections/${c.id}`).expect(404);
  });

  it('validates input and does not persist failed updates', async () => {
    const res = await request(app).post('/api/collections').send({ name: '   ' }).expect(400);
    expect(res.body.code).toBe('VALIDATION');

    const c = (await request(app).post('/api/collections').send({ name: 'A' })).body as Collection;
    await request(app)
      .put(`/api/collections/${c.id}`)
      .send({ ...c, requests: [{ ...sampleRequest(), method: 'FETCH' }] })
      .expect(400);
    await request(app).put('/api/collections/other').send(c).expect(400);
    expect(store.get().collections[0].requests).toEqual([]);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app).post('/api/collections').set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(res.body.code).toBe('MALFORMED_JSON');
  });
});

describe('environments', () => {
  it('supports CRUD', async () => {
    const env = (await request(app).post('/api/environments').send({ name: 'Local' }).expect(201)).body;
    expect(env.variables).toEqual([]);
    const vars = [{ id: 'v1', key: 'baseUrl', value: 'http://localhost:3000', enabled: true }];
    await request(app).put(`/api/environments/${env.id}`).send({ ...env, variables: vars }).expect(200);
    expect(store.get().environments[0].variables).toEqual(vars);
    await request(app).delete(`/api/environments/${env.id}`).expect(204);
  });
});

describe('proxy', () => {
  const send = (body: object) => request(app).post('/api/proxy').send(body);

  it('forwards method, headers and body and reports timing', async () => {
    const res = await send({
      method: 'POST',
      url: `${targetUrl}/echo?x=1`,
      headers: [['Content-Type', 'application/json'], ['X-Trace', 'abc']],
      body: '{"hello":"world"}',
    }).expect(200);
    const r = res.body as ProxyResponse;
    expect(r.status).toBe(200);
    expect(r.bodyEncoding).toBe('utf8');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.size).toBe(Buffer.byteLength(r.body));
    const echoed = JSON.parse(r.body);
    expect(echoed).toMatchObject({ method: 'POST', query: { x: '1' }, body: '{"hello":"world"}' });
    expect(echoed.headers['x-trace']).toBe('abc');
  });

  it('passes through non-2xx responses as data', async () => {
    const r = (await send({ method: 'GET', url: `${targetUrl}/missing` }).expect(200)).body as ProxyResponse;
    expect(r.status).toBe(404);
  });

  it('follows redirects', async () => {
    const r = (await send({ method: 'GET', url: `${targetUrl}/redirect` })).body as ProxyResponse;
    expect(r).toMatchObject({ status: 200, redirected: true, url: `${targetUrl}/echo` });
  });

  it('drops GET bodies and connection-managed headers with warnings', async () => {
    const r = (await send({ method: 'GET', url: `${targetUrl}/echo`, headers: [['Connection', 'close']], body: 'x' })).body as ProxyResponse;
    expect(r.status).toBe(200);
    expect(r.warnings).toHaveLength(2);
  });

  it('returns binary bodies as base64', async () => {
    const r = (await send({ method: 'GET', url: `${targetUrl}/binary` })).body as ProxyResponse;
    expect(r.bodyEncoding).toBe('base64');
    expect(Buffer.from(r.body, 'base64')).toEqual(Buffer.from([0, 1, 2, 255]));
  });

  it('maps timeouts and connection errors', async () => {
    const timeout = await send({ method: 'GET', url: `${targetUrl}/slow`, timeoutMs: 100 }).expect(504);
    expect(timeout.body.code).toBe('TIMEOUT');
    const refused = await send({ method: 'GET', url: closedPortUrl }).expect(502);
    expect(refused.body).toMatchObject({ code: 'ECONNREFUSED', error: 'Connection refused' });
  });

  it('rejects non-http URLs', async () => {
    const res = await send({ method: 'GET', url: 'file:///etc/passwd' }).expect(400);
    expect(res.body.code).toBe('UNSUPPORTED_PROTOCOL');
  });
});

describe('local-only guard', () => {
  it('rejects foreign Host and Origin headers', async () => {
    await request(app).get('/api/health').set('Host', 'evil.example.com').expect(403);
    await request(app).get('/api/health').set('Origin', 'https://evil.example.com').expect(403);
    await request(app).get('/api/health').set('Origin', 'http://localhost:5173').expect(200);
  });
});

// ── Postman ──
const postmanFixture = {
  info: { name: 'Pets', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [{ key: 'baseUrl', value: 'https://pets.example.com' }],
  item: [
    {
      name: 'Pets',
      item: [
        {
          name: 'List pets',
          request: {
            method: 'GET',
            header: [{ key: 'Accept', value: 'application/json' }, { key: 'X-Old', value: '1', disabled: true }],
            url: {
              raw: '{{baseUrl}}/pets?limit=10',
              host: ['{{baseUrl}}'],
              path: ['pets'],
              query: [{ key: 'limit', value: '10' }, { key: 'offset', value: '0', disabled: true }],
            },
          },
        },
        {
          name: 'Create pet',
          request: {
            method: 'POST',
            auth: { type: 'noauth' },
            url: '{{baseUrl}}/pets',
            body: { mode: 'raw', raw: '{"name":"Rex"}', options: { raw: { language: 'json' } } },
          },
        },
      ],
    },
    {
      name: 'Upload',
      request: {
        method: 'POST',
        auth: { type: 'oauth2', oauth2: [] },
        url: '{{baseUrl}}/upload',
        body: { mode: 'formdata', formdata: [{ key: 'title', value: 'x', type: 'text' }, { key: 'file', src: 'a.png', type: 'file' }] },
      },
    },
  ],
};

describe('postman', () => {
  it('imports folders, auth inheritance, params, bodies and variables', () => {
    const { collection, environment, warnings } = importPostman(postmanFixture);
    expect(collection.name).toBe('Pets');
    expect(collection.requests.map((r) => r.name)).toEqual(['Pets / List pets', 'Pets / Create pet', 'Upload']);

    const [list, create, upload] = collection.requests;
    expect(list.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(list.params.map((p) => [p.key, p.enabled])).toEqual([['limit', true], ['offset', false]]);
    expect(list.headers.map((h) => h.enabled)).toEqual([true, false]);
    expect(create.auth).toEqual({ type: 'none' });
    expect(create.body).toEqual({ mode: 'json', text: '{"name":"Rex"}' });
    expect(upload.body).toMatchObject({ mode: 'urlencoded', fields: [{ key: 'title', value: 'x' }] });

    expect(environment?.variables[0]).toMatchObject({ key: 'baseUrl', value: 'https://pets.example.com' });
    expect(warnings).toHaveLength(2); // oauth2 + formdata
  });

  it('round-trips through export', () => {
    const original: Collection = {
      id: 'c1',
      name: 'Round trip',
      updatedAt: '',
      requests: [
        sampleRequest(),
        sampleRequest({
          id: 'r2',
          name: 'Login',
          method: 'POST',
          url: 'http://localhost:8080/login',
          params: [],
          auth: { type: 'basic', username: 'ada', password: 's3cret' },
          body: { mode: 'urlencoded', fields: [{ id: 'f', key: 'remember', value: '1', enabled: true }] },
        }),
        sampleRequest({ id: 'r3', name: 'Key', params: [], url: '{{baseUrl}}/k', auth: { type: 'apikey', key: 'X-Key', value: 'v', in: 'query' }, body: { mode: 'text', text: 'hi' } }),
      ],
    };
    const exported = exportPostman(original);
    expect(exported.item).toHaveLength(3);
    const reimported = importPostman(JSON.parse(JSON.stringify(exported)));

    const strip = (r: ApiRequest) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'id' ? undefined : v)));
    expect(reimported.collection.requests.map(strip)).toEqual(original.requests.map(strip));
  });

  it('exposes import/export over HTTP', async () => {
    const res = await request(app).post('/api/import/postman').send(postmanFixture).expect(201);
    const { collection } = res.body as ImportResult;
    expect(store.get().collections).toHaveLength(1);
    expect(store.get().environments).toHaveLength(1);

    const exp = await request(app).get(`/api/collections/${collection.id}/export/postman`).expect(200);
    expect(exp.headers['content-disposition']).toContain('Pets.postman_collection.json');
    expect(exp.body.info.schema).toContain('v2.1.0');

    await request(app).post('/api/import/postman').send({ hello: 'world' }).expect(400);
  });
});
