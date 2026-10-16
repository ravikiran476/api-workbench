import type {
  ApiErrorBody,
  Collection,
  Environment,
  ImportResult,
  ProxyRequest,
  ProxyResponse,
  Workspace,
} from '../../shared/types';
import { browserBackend } from './browserBackend';
import { ApiClientError } from './errors';

export { ApiClientError };

/** Storage + sending. Implemented by the Express server, or entirely in the browser (Vercel demo). */
export interface Backend {
  workspace(): Promise<Workspace>;
  createCollection(name: string): Promise<Collection>;
  saveCollection(c: Collection): Promise<Collection>;
  deleteCollection(collectionId: string): Promise<void>;
  importPostman(collection: unknown): Promise<ImportResult>;
  createEnvironment(name: string): Promise<Environment>;
  saveEnvironment(env: Environment): Promise<Environment>;
  deleteEnvironment(envId: string): Promise<void>;
  send(req: ProxyRequest, signal?: AbortSignal): Promise<ProxyResponse>;
}

/** True for the browser-only build (`vite build --mode standalone`). */
export const STANDALONE = import.meta.env.VITE_STANDALONE === 'true';

/** Scheme assumed for URLs typed without one. The hosted (https) demo can't call http:// APIs. */
export const DEFAULT_SCHEME = STANDALONE ? 'https' : 'http';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiClientError('Cannot reach the API Workbench server. Is it running?', 0, 'SERVER_UNREACHABLE');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & Partial<ApiErrorBody>;
  if (!res.ok) throw new ApiClientError(data.error ?? `${res.status} ${res.statusText}`, res.status, data.code);
  return data;
}

const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({
  method,
  body: JSON.stringify(body),
  signal,
});
const id = encodeURIComponent;

const serverBackend: Backend = {
  workspace: () => call<Workspace>('/workspace'),

  createCollection: (name) => call<Collection>('/collections', json('POST', { name })),
  saveCollection: (c) => call<Collection>(`/collections/${id(c.id)}`, json('PUT', c)),
  deleteCollection: (collectionId) => call<void>(`/collections/${id(collectionId)}`, { method: 'DELETE' }),
  importPostman: (collection) => call<ImportResult>('/import/postman', json('POST', collection)),

  createEnvironment: (name) => call<Environment>('/environments', json('POST', { name })),
  saveEnvironment: (env) => call<Environment>(`/environments/${id(env.id)}`, json('PUT', env)),
  deleteEnvironment: (envId) => call<void>(`/environments/${id(envId)}`, { method: 'DELETE' }),

  send: (req, signal) => call<ProxyResponse>('/proxy', json('POST', req, signal)),
};

export const api: Backend = STANDALONE ? browserBackend : serverBackend;
