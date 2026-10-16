import { isUtf8 } from 'node:buffer';
import type { ProxyRequest, ProxyResponse } from '../../shared/types';
import { HttpError } from './errors';

const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Connection-level headers that fetch manages itself (or rejects). */
const MANAGED_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
  'te',
  'trailer',
  'content-length',
]);

const NETWORK_ERRORS: Record<string, string> = {
  ENOTFOUND: 'Could not resolve host',
  EAI_AGAIN: 'DNS lookup timed out',
  ECONNREFUSED: 'Connection refused',
  ECONNRESET: 'Connection reset by the server',
  ETIMEDOUT: 'Connection timed out',
  EHOSTUNREACH: 'Host unreachable',
  CERT_HAS_EXPIRED: 'TLS certificate has expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'Server uses a self-signed TLS certificate',
  SELF_SIGNED_CERT_IN_CHAIN: 'Self-signed certificate in the TLS chain',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Unable to verify the TLS certificate',
  ERR_TLS_CERT_ALTNAME_INVALID: 'TLS certificate does not match the host name',
};

export async function executeRequest(req: ProxyRequest): Promise<ProxyResponse> {
  let target: URL;
  try {
    target = new URL(req.url);
  } catch {
    throw new HttpError(400, `Invalid URL: ${req.url}`, 'INVALID_URL');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new HttpError(400, `Unsupported protocol "${target.protocol}" — only http and https are allowed`, 'UNSUPPORTED_PROTOCOL');
  }

  const warnings: string[] = [];
  const headers = new Headers();
  for (const [rawName, value] of req.headers) {
    const name = rawName.trim();
    if (!name) continue;
    if (MANAGED_HEADERS.has(name.toLowerCase())) {
      warnings.push(`Header "${name}" is managed by the HTTP client and was not sent`);
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
  const started = performance.now();
  let res: Response;
  let buf: Buffer;
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    buf = await readLimited(res, MAX_RESPONSE_BYTES);
  } catch (e) {
    throw e instanceof HttpError ? e : networkError(e, timeoutMs);
  }
  const durationMs = Math.round(performance.now() - started);

  const contentType = res.headers.get('content-type') ?? '';
  const textual = isTextualContentType(contentType) || (!contentType && isUtf8(buf));
  return {
    status: res.status,
    statusText: res.statusText,
    url: res.url,
    redirected: res.redirected,
    headers: [...res.headers.entries()],
    contentType,
    body: buf.toString(textual ? 'utf8' : 'base64'),
    bodyEncoding: textual ? 'utf8' : 'base64',
    size: buf.length,
    durationMs,
    warnings,
  };
}

async function readLimited(res: Response, limit: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    // Leaving the loop cancels the underlying stream.
    if (total > limit) throw new HttpError(502, `Response exceeds the ${limit / 1024 / 1024} MB limit`, 'RESPONSE_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function networkError(e: unknown, timeoutMs: number): HttpError {
  const err = e as (Error & { cause?: { code?: string; message?: string } }) | undefined;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new HttpError(504, `Request timed out after ${timeoutMs} ms`, 'TIMEOUT');
  }
  const code = err?.cause?.code;
  const message = (code ? NETWORK_ERRORS[code] : undefined) ?? err?.cause?.message ?? err?.message ?? 'Request failed';
  return new HttpError(502, message, code ?? 'NETWORK_ERROR');
}

export function isTextualContentType(contentType: string): boolean {
  return /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|csv/i.test(contentType);
}
