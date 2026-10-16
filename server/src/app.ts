import { randomUUID } from 'node:crypto';
import path from 'node:path';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody, Collection, Environment } from '../../shared/types';
import { HttpError } from './errors';
import { exportPostman, importPostman } from './postman';
import { executeRequest } from './proxy';
import {
  CollectionInputSchema,
  CreateEnvironmentSchema,
  CreateNamedSchema,
  EnvironmentSchema,
  ProxyRequestSchema,
} from './schemas';
import type { WorkspaceStore } from './store';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostnameOf(hostHeader: string): string {
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1);
  return hostHeader.split(':')[0].toLowerCase();
}

/**
 * The proxy can reach anything this machine can, so the API must only be usable from a page
 * served on localhost. Checking Host blocks DNS rebinding; checking Origin blocks other websites
 * open in the user's browser from driving the proxy.
 */
const localOnly: RequestHandler = (req, res, next) => {
  if (!LOOPBACK_HOSTS.has(hostnameOf(req.headers.host ?? ''))) {
    res.status(403).json({ error: 'API Workbench only accepts requests addressed to localhost', code: 'FORBIDDEN_HOST' } satisfies ApiErrorBody);
    return;
  }
  const origin = req.headers.origin;
  if (origin) {
    let allowed = false;
    try {
      allowed = LOOPBACK_HOSTS.has(new URL(origin).hostname);
    } catch {
      // malformed origin → not allowed
    }
    if (!allowed) {
      res.status(403).json({ error: `Cross-origin requests from ${origin} are not allowed`, code: 'FORBIDDEN_ORIGIN' } satisfies ApiErrorBody);
      return;
    }
  }
  next();
};

const now = () => new Date().toISOString();

function notFound(what: string): never {
  throw new HttpError(404, `${what} not found`, 'NOT_FOUND');
}

export function createApp({ store, clientDist }: { store: WorkspaceStore; clientDist?: string }) {
  const app = express();
  app.disable('x-powered-by');

  const api = express.Router();
  api.use(localOnly);
  api.use(express.json({ limit: '25mb' }));

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  api.get('/workspace', (_req, res) => {
    res.json(store.get());
  });

  // ── Collections ──
  api.post('/collections', async (req, res) => {
    const { name } = CreateNamedSchema.parse(req.body);
    const created = await store.update((ws) => {
      const c: Collection = { id: randomUUID(), name, requests: [], updatedAt: now() };
      ws.collections.push(c);
      return c;
    });
    res.status(201).json(created);
  });

  api.put('/collections/:id', async (req, res) => {
    const input = CollectionInputSchema.parse(req.body);
    if (input.id !== req.params.id) throw new HttpError(400, 'Collection id in body does not match the URL', 'ID_MISMATCH');
    const saved = await store.update((ws) => {
      const i = ws.collections.findIndex((c) => c.id === input.id);
      if (i < 0) notFound('Collection');
      const c: Collection = { ...input, updatedAt: now() };
      ws.collections[i] = c;
      return c;
    });
    res.json(saved);
  });

  api.delete('/collections/:id', async (req, res) => {
    await store.update((ws) => {
      const i = ws.collections.findIndex((c) => c.id === req.params.id);
      if (i < 0) notFound('Collection');
      ws.collections.splice(i, 1);
    });
    res.status(204).end();
  });

  api.get('/collections/:id/export/postman', (req, res) => {
    const collection = store.get().collections.find((c) => c.id === req.params.id) ?? notFound('Collection');
    const filename = collection.name.replace(/[^\w.-]+/g, '_') || 'collection';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.postman_collection.json"`);
    res.json(exportPostman(collection));
  });

  api.post('/import/postman', async (req, res) => {
    const result = importPostman(req.body);
    await store.update((ws) => {
      ws.collections.push(result.collection);
      if (result.environment) ws.environments.push(result.environment);
    });
    res.status(201).json(result);
  });

  // ── Environments ──
  api.post('/environments', async (req, res) => {
    const input = CreateEnvironmentSchema.parse(req.body);
    const created = await store.update((ws) => {
      const env: Environment = { id: randomUUID(), ...input };
      ws.environments.push(env);
      return env;
    });
    res.status(201).json(created);
  });

  api.put('/environments/:id', async (req, res) => {
    const input = EnvironmentSchema.parse(req.body);
    if (input.id !== req.params.id) throw new HttpError(400, 'Environment id in body does not match the URL', 'ID_MISMATCH');
    const saved = await store.update((ws) => {
      const i = ws.environments.findIndex((e) => e.id === input.id);
      if (i < 0) notFound('Environment');
      ws.environments[i] = input;
      return input;
    });
    res.json(saved);
  });

  api.delete('/environments/:id', async (req, res) => {
    await store.update((ws) => {
      const i = ws.environments.findIndex((e) => e.id === req.params.id);
      if (i < 0) notFound('Environment');
      ws.environments.splice(i, 1);
    });
    res.status(204).end();
  });

  // ── Proxy ──
  api.post('/proxy', async (req, res) => {
    res.json(await executeRequest(ProxyRequestSchema.parse(req.body)));
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' } satisfies ApiErrorBody);
  });

  app.use('/api', api);

  // Serve the built client (production) with SPA fallback.
  if (clientDist) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let status = 500;
  let body: ApiErrorBody;
  if (err instanceof ZodError) {
    status = 400;
    const first = err.issues[0];
    body = {
      error: first ? `Invalid request: ${first.path.join('.') || 'body'} — ${first.message}` : 'Invalid request',
      code: 'VALIDATION',
      details: err.issues,
    };
  } else if (err instanceof HttpError) {
    status = err.status;
    body = { error: err.message, code: err.code };
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    body = { error: 'Request body is too large', code: 'PAYLOAD_TOO_LARGE' };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { error: 'Malformed JSON in request body', code: 'MALFORMED_JSON' };
  } else {
    console.error(err);
    body = { error: 'Internal server error', code: 'INTERNAL' };
  }
  res.status(status).json(body);
};
