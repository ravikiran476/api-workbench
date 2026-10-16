import {
  HTTP_METHODS,
  type ApiRequest,
  type Auth,
  type Collection,
  type Environment,
  type HttpMethod,
  type ImportResult,
  type KeyValue,
  type RequestBody,
} from './types';
import { parseQuery, splitUrl } from './url';

// Postman Collection Format v2.0 / v2.1: https://schema.postman.com/
// Runs in both Node and the browser (used directly by the client's browser-only mode).

/** Thrown when the input isn't a Postman collection we can import. */
export class PostmanFormatError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const randomUUID = () => crypto.randomUUID();

export const POSTMAN_SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : fallback;
const kv = (key: string, value: string, enabled = true): KeyValue => ({ id: randomUUID(), key, value, enabled });

function toKeyValues(list: unknown): KeyValue[] {
  return (Array.isArray(list) ? list : []).filter(isObj).map((i) => kv(str(i.key), str(i.value), i.disabled !== true));
}

/** Postman stores auth params as [{key, value}] (v2.1) or as a plain object (v2.0). */
function authParams(v: unknown): Record<string, string> {
  if (Array.isArray(v)) return Object.fromEntries(v.filter(isObj).map((p) => [str(p.key), str(p.value)]));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, str(val)]));
  return {};
}

// ───────────────────────────── Import ─────────────────────────────

export function importPostman(input: unknown): ImportResult {
  if (!isObj(input) || !isObj(input.info) || !Array.isArray(input.item)) {
    throw new PostmanFormatError('Not a Postman collection: expected "info" and "item" fields', 'INVALID_POSTMAN');
  }
  const schema = str(input.info.schema);
  if (schema && !/\/v2\.[01]\.\d+\//.test(schema)) {
    throw new PostmanFormatError(`Unsupported Postman schema (${schema}). Re-export the collection as v2.1.`, 'UNSUPPORTED_POSTMAN_VERSION');
  }

  const name = str(input.info.name, 'Imported collection');
  const warnings: string[] = [];
  const requests: ApiRequest[] = [];

  // Folders are flattened into "Folder / Request" names; auth is inherited down the tree.
  const walk = (items: unknown[], path: string[], inherited: Auth) => {
    for (const item of items.filter(isObj)) {
      const itemName = str(item.name, 'Untitled');
      if (Array.isArray(item.item)) {
        walk(item.item, [...path, itemName], convertAuth(item.auth, itemName, warnings) ?? inherited);
      } else if (item.request !== undefined) {
        const fullName = [...path, itemName].join(' / ');
        requests.push(convertRequest(item.request, fullName, inherited, warnings));
      }
    }
  };
  walk(input.item, [], convertAuth(input.auth, 'Collection', warnings) ?? { type: 'none' });

  const variables = toKeyValues(input.variable);
  const environment: Environment | undefined = variables.length
    ? { id: randomUUID(), name: `${name} variables`, variables }
    : undefined;

  return {
    collection: { id: randomUUID(), name, requests, updatedAt: new Date().toISOString() },
    environment,
    warnings,
  };
}

function convertRequest(raw: unknown, name: string, inheritedAuth: Auth, warnings: string[]): ApiRequest {
  const r: Json = typeof raw === 'string' ? { url: raw } : isObj(raw) ? raw : {};

  let method = str(r.method, 'GET').toUpperCase() as HttpMethod;
  if (!HTTP_METHODS.includes(method)) {
    warnings.push(`${name}: method ${method} is not supported; imported as GET`);
    method = 'GET';
  }

  let url = '';
  let params: KeyValue[];
  if (isObj(r.url)) {
    url = str(r.url.raw) || buildRawUrl(r.url);
    params = Array.isArray(r.url.query) ? toKeyValues(r.url.query) : queryToParams(url);
  } else {
    url = str(r.url);
    params = queryToParams(url);
  }

  return {
    id: randomUUID(),
    name,
    method,
    url,
    params,
    headers: toKeyValues(r.header),
    auth: convertAuth(r.auth, name, warnings) ?? inheritedAuth,
    body: convertBody(r.body, name, warnings),
  };
}

function queryToParams(url: string): KeyValue[] {
  return parseQuery(splitUrl(url).query).map((p) => kv(p.key, p.value));
}

function buildRawUrl(u: Json): string {
  const host = Array.isArray(u.host) ? u.host.map((h) => str(h)).join('.') : str(u.host);
  const path = Array.isArray(u.path) ? u.path.map((p) => (isObj(p) ? str(p.value) : str(p))).join('/') : str(u.path);
  const protocol = str(u.protocol);
  const port = str(u.port);
  return `${protocol ? `${protocol}://` : ''}${host}${port ? `:${port}` : ''}${path ? `/${path.replace(/^\//, '')}` : ''}`;
}

/** Returns null when the item doesn't define auth (meaning: inherit from parent). */
function convertAuth(raw: unknown, context: string, warnings: string[]): Auth | null {
  if (!isObj(raw)) return null;
  const type = str(raw.type);
  const p = authParams(raw[type]);
  switch (type) {
    case 'noauth':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: p.token ?? '' };
    case 'basic':
      return { type: 'basic', username: p.username ?? '', password: p.password ?? '' };
    case 'apikey':
      return { type: 'apikey', key: p.key ?? '', value: p.value ?? '', in: p.in === 'query' ? 'query' : 'header' };
    default:
      warnings.push(`${context}: "${type}" auth is not supported; imported without auth`);
      return { type: 'none' };
  }
}

function convertBody(raw: unknown, context: string, warnings: string[]): RequestBody {
  if (!isObj(raw)) return { mode: 'none' };
  switch (str(raw.mode)) {
    case 'raw': {
      const text = str(raw.raw);
      if (!text) return { mode: 'none' };
      const options = isObj(raw.options) && isObj(raw.options.raw) ? raw.options.raw : {};
      return str(options.language) === 'json' || looksLikeJson(text) ? { mode: 'json', text } : { mode: 'text', text };
    }
    case 'urlencoded':
      return { mode: 'urlencoded', fields: toKeyValues(raw.urlencoded) };
    case 'formdata': {
      const items = (Array.isArray(raw.formdata) ? raw.formdata : []).filter(isObj);
      const files = items.filter((i) => i.type === 'file');
      warnings.push(
        `${context}: form-data imported as x-www-form-urlencoded` + (files.length ? `; ${files.length} file field(s) skipped` : ''),
      );
      return { mode: 'urlencoded', fields: toKeyValues(items.filter((i) => i.type !== 'file')) };
    }
    case 'graphql': {
      const g = isObj(raw.graphql) ? raw.graphql : {};
      let variables: unknown = {};
      try {
        variables = JSON.parse(str(g.variables) || '{}');
      } catch {
        // keep empty variables
      }
      warnings.push(`${context}: GraphQL body imported as JSON`);
      return { mode: 'json', text: JSON.stringify({ query: str(g.query), variables }, null, 2) };
    }
    case 'file':
      warnings.push(`${context}: binary file body is not supported and was skipped`);
      return { mode: 'none' };
    default:
      return { mode: 'none' };
  }
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────────── Export ─────────────────────────────

const exportKv = (items: KeyValue[]) =>
  items.map((i) => ({ key: i.key, value: i.value, ...(i.enabled ? {} : { disabled: true }) }));

export function exportPostman(collection: Collection): Json {
  return {
    info: { _postman_id: collection.id, name: collection.name, schema: POSTMAN_SCHEMA_V21 },
    item: collection.requests.map((r) => ({
      name: r.name,
      request: {
        method: r.method,
        header: exportKv(r.headers),
        url: exportUrl(r),
        ...(r.body.mode !== 'none' && { body: exportBody(r.body) }),
        auth: exportAuth(r.auth),
      },
    })),
  };
}

function exportUrl(r: ApiRequest): Json {
  const { base } = splitUrl(r.url);
  const m = /^([a-z][\w+.-]*):\/\/([^/]*)(.*)$/i.exec(base);
  const [protocol, hostPort, path] = m ? [m[1], m[2], m[3]] : ['', base.split('/')[0], base.slice(base.split('/')[0].length)];
  const portMatch = /^(.*):(\d+)$/.exec(hostPort);
  const hostname = portMatch ? portMatch[1] : hostPort;
  return {
    raw: r.url,
    ...(protocol && { protocol }),
    host: hostname ? hostname.split('.') : [],
    ...(portMatch && { port: portMatch[2] }),
    path: path.split('/').filter((s, i) => i > 0 || s !== ''),
    ...(r.params.length && { query: exportKv(r.params) }),
  };
}

function exportBody(body: RequestBody): Json {
  switch (body.mode) {
    case 'json':
      return { mode: 'raw', raw: body.text, options: { raw: { language: 'json' } } };
    case 'text':
      return { mode: 'raw', raw: body.text, options: { raw: { language: 'text' } } };
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: exportKv(body.fields) };
    case 'none':
      return {};
  }
}

function exportAuth(auth: Auth): Json {
  const params = (o: Record<string, string>) => Object.entries(o).map(([key, value]) => ({ key, value, type: 'string' }));
  switch (auth.type) {
    case 'none':
      return { type: 'noauth' };
    case 'bearer':
      return { type: 'bearer', bearer: params({ token: auth.token }) };
    case 'basic':
      return { type: 'basic', basic: params({ username: auth.username, password: auth.password }) };
    case 'apikey':
      return { type: 'apikey', apikey: params({ key: auth.key, value: auth.value, in: auth.in }) };
  }
}
