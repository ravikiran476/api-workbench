import type {
  ApiErrorBody,
  Collection,
  Environment,
  ImportResult,
  ProxyRequest,
  ProxyResponse,
  Workspace,
} from '../../shared/types';

export class ApiClientError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

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

export const api = {
  workspace: () => call<Workspace>('/workspace'),

  createCollection: (name: string) => call<Collection>('/collections', json('POST', { name })),
  saveCollection: (c: Collection) => call<Collection>(`/collections/${id(c.id)}`, json('PUT', c)),
  deleteCollection: (collectionId: string) => call<void>(`/collections/${id(collectionId)}`, { method: 'DELETE' }),
  exportPostmanUrl: (collectionId: string) => `/api/collections/${id(collectionId)}/export/postman`,
  importPostman: (collection: unknown) => call<ImportResult>('/import/postman', json('POST', collection)),

  createEnvironment: (name: string) => call<Environment>('/environments', json('POST', { name })),
  saveEnvironment: (env: Environment) => call<Environment>(`/environments/${id(env.id)}`, json('PUT', env)),
  deleteEnvironment: (envId: string) => call<void>(`/environments/${id(envId)}`, { method: 'DELETE' }),

  send: (req: ProxyRequest, signal?: AbortSignal) => call<ProxyResponse>('/proxy', json('POST', req, signal)),
};
