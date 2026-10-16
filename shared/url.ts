// URL helpers that work on raw strings (no decoding), so {{variables}} survive untouched.

export interface UrlParts {
  base: string;
  query: string;
  hash: string;
}

/** Splits on the first "?" (before any "#") and the first "#". */
export function splitUrl(url: string): UrlParts {
  const hashIdx = url.indexOf('#');
  const beforeHash = hashIdx < 0 ? url : url.slice(0, hashIdx);
  const hash = hashIdx < 0 ? '' : url.slice(hashIdx);
  const qIdx = beforeHash.indexOf('?');
  return qIdx < 0
    ? { base: beforeHash, query: '', hash }
    : { base: beforeHash.slice(0, qIdx), query: beforeHash.slice(qIdx + 1), hash };
}

export interface QueryPair {
  key: string;
  value: string;
}

export function parseQuery(query: string): QueryPair[] {
  return query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      return i < 0 ? { key: pair, value: '' } : { key: pair.slice(0, i), value: pair.slice(i + 1) };
    });
}

/** Inverse of parseQuery: a pair with an empty value is written as a bare key. */
export function buildQuery(pairs: QueryPair[]): string {
  return pairs.map((p) => (p.value === '' ? p.key : `${p.key}=${p.value}`)).join('&');
}
