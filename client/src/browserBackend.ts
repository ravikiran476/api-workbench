import { isTextualContentType } from '../../shared/content';
import { importPostman } from '../../shared/postman';
import type { Backend } from './api';
import type { Collection, Environment, ProxyRequest, ProxyResponse, Workspace } from '../../shared/types';
import { ApiClientError } from './errors';

// Browser-only backend used by the hosted demo: the workspace lives in localStorage and
// requests go straight from the browser, so the target API must allow CORS.

const STORAGE_KEY = 'apiwb-workspace';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Headers browsers refuse to let scripts set (Fetch spec "forbidden request headers"). */
const FORBIDDEN_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

const isForbiddenHeader = (name: string) => {
  const n = name.toLowerCase();
  return FORBIDDEN_HEADERS.has(n) || n.startsWith('proxy-') || n.startsWith('sec-');
};

function load(): Workspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const w = JSON.parse(raw) as Partial<Workspace>;
      if (Array.isArray(w.collections) && Array.isArray(w.environments)) return w as Workspace;
    }
  } catch {
    // unreadable storage → start empty
  }
  return { collections: [], environments: [] };
}

/** Load → mutate → save, mirroring the server's update semantics. */
function update<T>(mutate: (w: Workspace) => T): T {
  const w = load();
  const result = mutate(w);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  } catch {
    throw new ApiClientError('Could not save to browser storage (it may be full or disabled).', 0, 'STORAGE');
  }
  return result;
}

function requireName(name: string): string {
  const n = name.trim();
  if (!n) throw new ApiClientError('Name is required', 400, 'VALIDATION');
  return n;
}

function indexOrThrow<T extends { id: string }>(items: T[], id: string, what: string): number {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) throw new ApiClientError(`${what} not found`, 404, 'NOT_FOUND');
  return i;
}

const now = () => new Date().toISOString();

export const browserBackend: Backend = {
  workspace: async () => load(),

  createCollection: async (name) =>
    update((w) => {
      const c: Collection = { id: crypto.randomUUID(), name: requireName(name), requests: [], updatedAt: now() };
      w.collections.push(c);
      return c;
    }),

  saveCollection: async (input) =>
    update((w) => {
      const i = indexOrThrow(w.collections, input.id, 'Collection');
      const c: Collection = { ...input, name: requireName(input.name), updatedAt: now() };
      w.collections[i] = c;
      return c;
    }),

  deleteCollection: async (id) =>
    update((w) => {
      w.collections.splice(indexOrThrow(w.collections, id, 'Collection'), 1);
    }),

  importPostman: async (json) => {
    const result = importPostman(json);
    update((w) => {
      w.collections.push(result.collection);
      if (result.environment) w.environments.push(result.environment);
    });
    return result;
  },

  createEnvironment: async (name) =>
    update((w) => {
      const env: Environment = { id: crypto.randomUUID(), name: requireName(name), variables: [] };
      w.environments.push(env);
      return env;
    }),

  saveEnvironment: async (input) =>
    update((w) => {
      const env = { ...input, name: requireName(input.name) };
      w.environments[indexOrThrow(w.environments, input.id, 'Environment')] = env;
      return env;
    }),

  deleteEnvironment: async (id) =>
    update((w) => {
      w.environments.splice(indexOrThrow(w.environments, id, 'Environment'), 1);
    }),

  send: sendFromBrowser,
};

async function sendFromBrowser(req: ProxyRequest, signal?: AbortSignal): Promise<ProxyResponse> {
  let target: URL;
  try {
    target = new URL(req.url);
  } catch {
    throw new ApiClientError(`Invalid URL: ${req.url}`, 400, 'INVALID_URL');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new ApiClientError(`Unsupported protocol "${target.protocol}" — only http and https are allowed`, 400, 'UNSUPPORTED_PROTOCOL');
  }

  const warnings: string[] = [];
  const headers = new Headers();
  for (const [rawName, value] of req.headers) {
    const name = rawName.trim();
    if (!name) continue;
    if (isForbiddenHeader(name)) {
      warnings.push(`Browsers don't allow setting "${name}"; it was not sent (run API Workbench locally to send it)`);
      continue;
    }
    try {
      headers.append(name, value);
    } catch {
      warnings.push(`Header "${name}" has an invalid name or value and was not sent`);
    }
  }

  let body = req.body;
  if (body !== undefined && (req.method === 'GET' || req.method === 'HEAD')) {
    if (body !== '') warnings.push(`A body cannot be sent with ${req.method}; it was omitted`);
    body = undefined;
  }

  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const started = performance.now();
  let res: Response;
  let bytes: Uint8Array;
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (timeout.aborted) throw new ApiClientError(`Request timed out after ${timeoutMs} ms`, 0, 'TIMEOUT');
    const mixed = globalThis.location?.protocol === 'https:' && target.protocol === 'http:' && !isLocalHost(target.hostname);
    throw new ApiClientError(
      mixed
        ? 'The browser blocked this http:// request from an https:// page (mixed content). Use https:// or run API Workbench locally.'
        : `The browser could not complete the request (${(e as Error).message}). The API probably doesn't allow cross-origin (CORS) requests, or the host is unreachable.`,
      0,
      'BROWSER_FETCH_FAILED',
    );
  }
  const durationMs = Math.round(performance.now() - started);

  const contentType = res.headers.get('content-type') ?? '';
  const textual = isTextualContentType(contentType) || (!contentType && isUtf8(bytes));
  return {
    status: res.status,
    statusText: res.statusText,
    url: res.url,
    redirected: res.redirected,
    headers: [...res.headers.entries()],
    contentType,
    body: textual ? new TextDecoder().decode(bytes) : toBase64(bytes),
    bodyEncoding: textual ? 'utf8' : 'base64',
    size: bytes.length,
    durationMs,
    warnings,
  };
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
