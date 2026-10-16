// Types shared by the client and server.

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export type Auth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; key: string; value: string; in: 'header' | 'query' };

export type RequestBody =
  | { mode: 'none' }
  | { mode: 'json'; text: string }
  | { mode: 'text'; text: string }
  | { mode: 'urlencoded'; fields: KeyValue[] };

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  /** Full URL including the query string of enabled params. May contain {{variables}}. */
  url: string;
  /** UI view of the query string; disabled params live only here. */
  params: KeyValue[];
  headers: KeyValue[];
  auth: Auth;
  body: RequestBody;
}

export interface Collection {
  id: string;
  name: string;
  requests: ApiRequest[];
  updatedAt: string;
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValue[];
}

export interface Workspace {
  collections: Collection[];
  environments: Environment[];
}

/** A fully resolved request (variables substituted, auth applied) sent to the server proxy. */
export interface ProxyRequest {
  method: HttpMethod;
  url: string;
  headers: Array<[string, string]>;
  body?: string;
  timeoutMs?: number;
}

export interface ProxyResponse {
  status: number;
  statusText: string;
  /** Final URL after redirects. */
  url: string;
  redirected: boolean;
  headers: Array<[string, string]>;
  contentType: string;
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  /** Body size in bytes. */
  size: number;
  /** Time from sending the request until the whole body was received. */
  durationMs: number;
  warnings: string[];
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
}

export interface ImportResult {
  collection: Collection;
  environment?: Environment;
  warnings: string[];
}
