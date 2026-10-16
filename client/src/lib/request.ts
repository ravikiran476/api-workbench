import type { ApiRequest, KeyValue, ProxyRequest } from '../../../shared/types';
import { buildQuery, parseQuery, splitUrl } from '../../../shared/url';

export const newId = () => crypto.randomUUID();

export const newKeyValue = (key = '', value = ''): KeyValue => ({ id: newId(), key, value, enabled: true });

export function newRequest(): ApiRequest {
  return {
    id: newId(),
    name: 'Untitled request',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: { mode: 'none' },
  };
}

// ── URL ⇄ params sync ──

/** Rebuilds the params table after the URL was edited. Disabled params are kept; ids are reused for stable rows. */
export function paramsFromUrl(url: string, current: KeyValue[]): KeyValue[] {
  const enabled = current.filter((p) => p.enabled);
  const parsed = parseQuery(splitUrl(url).query).map((p, i) => ({ id: enabled[i]?.id ?? newId(), ...p, enabled: true }));
  return [...parsed, ...current.filter((p) => !p.enabled)];
}

/** Rewrites the URL's query string after the params table was edited. */
export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url);
  const query = buildQuery(params.filter((p) => p.enabled && (p.key || p.value)));
  return `${base}${query ? `?${query}` : ''}${hash}`;
}

// ── Variables & request preparation ──

const VARIABLE = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function toVariableMap(variables: KeyValue[]): Record<string, string> {
  return Object.fromEntries(variables.filter((v) => v.enabled && v.key.trim()).map((v) => [v.key.trim(), v.value]));
}

function base64Utf8(text: string): string {
  let binary = '';
  for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
  return btoa(binary);
}

function appendQuery(url: string, key: string, value: string): string {
  const { base, query, hash } = splitUrl(url);
  const pair = `${key}=${value}`;
  return `${base}?${query ? `${query}&` : ''}${pair}${hash}`;
}

export interface PreparedRequest {
  request: ProxyRequest;
  /** Variable names referenced but not defined in the active environment. */
  unresolved: string[];
}

/** Substitutes {{variables}}, applies auth and default Content-Type, and produces what the proxy sends. */
export function prepareRequest(req: ApiRequest, variables: KeyValue[], defaultScheme: 'http' | 'https' = 'http'): PreparedRequest {
  const vars = toVariableMap(variables);
  const unresolved = new Set<string>();
  const sub = (s: string) =>
    s.replace(VARIABLE, (match, name: string) => {
      if (Object.hasOwn(vars, name)) return vars[name];
      unresolved.add(name);
      return match;
    });

  let url = sub(req.url.trim());
  if (url && !/^[a-z][\w+.-]*:\/\//i.test(url)) url = `${defaultScheme}://${url}`;

  const headers: Array<[string, string]> = req.headers
    .filter((h) => h.enabled && h.key.trim())
    .map((h) => [sub(h.key).trim(), sub(h.value)]);
  const hasHeader = (name: string) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());
  const setDefault = (name: string, value: string) => {
    if (!hasHeader(name)) headers.push([name, value]);
  };

  const auth = req.auth;
  switch (auth.type) {
    case 'bearer':
      setDefault('Authorization', `Bearer ${sub(auth.token)}`);
      break;
    case 'basic':
      setDefault('Authorization', `Basic ${base64Utf8(`${sub(auth.username)}:${sub(auth.password)}`)}`);
      break;
    case 'apikey':
      if (auth.key.trim()) {
        if (auth.in === 'header') setDefault(sub(auth.key).trim(), sub(auth.value));
        else url = appendQuery(url, encodeURIComponent(sub(auth.key)), encodeURIComponent(sub(auth.value)));
      }
      break;
    case 'none':
      break;
  }

  let body: string | undefined;
  switch (req.body.mode) {
    case 'json':
      body = sub(req.body.text);
      setDefault('Content-Type', 'application/json');
      break;
    case 'text':
      body = sub(req.body.text);
      setDefault('Content-Type', 'text/plain');
      break;
    case 'urlencoded': {
      const form = new URLSearchParams();
      for (const f of req.body.fields) if (f.enabled && f.key) form.append(sub(f.key), sub(f.value));
      body = form.toString();
      setDefault('Content-Type', 'application/x-www-form-urlencoded');
      break;
    }
    case 'none':
      break;
  }

  return { request: { method: req.method, url, headers, body }, unresolved: [...unresolved] };
}

// ── Formatting ──

export function toCurl(req: ProxyRequest): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const lines = [`curl${req.method === 'GET' ? '' : ` -X ${req.method}`} ${q(req.url)}`];
  for (const [k, v] of req.headers) lines.push(`  -H ${q(`${k}: ${v}`)}`);
  if (req.body !== undefined && req.body !== '') lines.push(`  --data-raw ${q(req.body)}`);
  return lines.join(' \\\n');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Pretty-prints JSON text, or returns null if it isn't JSON. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}
