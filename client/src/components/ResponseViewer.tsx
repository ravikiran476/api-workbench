import { useMemo, useState, type ReactNode } from 'react';
import type { ProxyResponse } from '../../../shared/types';
import { STANDALONE } from '../api';
import { formatBytes, formatDuration, prettyJson } from '../lib/request';
import { Alert, Button, CopyButton, Segmented, Tabs, cx } from './ui';

export type ResponseState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; response: ProxyResponse }
  | { status: 'error'; message: string; code?: string };

const DISPLAY_LIMIT = 500_000;
const HIGHLIGHT_LIMIT = 300_000;

const ERROR_HINTS: Record<string, string> = {
  ECONNREFUSED: 'Nothing is listening at that address. Is the target server running, and is the port right?',
  ENOTFOUND: 'Check the host name for typos, or that your environment variables resolve to a real host.',
  TIMEOUT: 'The server did not finish responding in time.',
  SERVER_UNREACHABLE: 'Start it with `npm run dev` from the project root.',
  BROWSER_FETCH_FAILED:
    'In browser mode, requests are subject to CORS: the API must send Access-Control-Allow-Origin. Run API Workbench locally (npm run dev) to call any API through its server.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The server uses a self-signed certificate, which is not trusted.',
};

function statusTone(status: number): string {
  if (status < 300) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  if (status < 400) return 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300';
  if (status < 500) return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';
}

export function ResponseViewer({ state, onCancel }: { state: ResponseState; onCancel: () => void }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-900" aria-label="Response">
      {state.status === 'idle' && (
        <div className="grid flex-1 place-items-center p-8 text-center text-sm text-slate-400">
          <div>
            <p>Send a request to see the response here.</p>
            <p className="mt-1 text-xs">
              <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">Ctrl</kbd> +{' '}
              <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">Enter</kbd> to send ·{' '}
              <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">Ctrl</kbd> +{' '}
              <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">S</kbd> to save
            </p>
            {STANDALONE && (
              <p className="mx-auto mt-4 max-w-md text-xs leading-relaxed">
                Browser mode: requests go directly from your browser, so the API must allow CORS. Try{' '}
                <code className="text-slate-500">https://jsonplaceholder.typicode.com/todos/1</code>
              </p>
            )}
          </div>
        </div>
      )}
      {state.status === 'loading' && (
        <div className="grid flex-1 place-items-center p-8 text-sm text-slate-500">
          <div className="flex flex-col items-center gap-3">
            <span className="size-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
            <span>Sending request…</span>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      )}
      {state.status === 'error' && (
        <div className="p-4">
          <Alert tone="error" className="text-sm">
            <p className="font-semibold">
              Could not get a response{state.code && <span className="ml-2 font-mono text-xs font-normal opacity-75">{state.code}</span>}
            </p>
            <p className="mt-1">{state.message}</p>
            {state.code && ERROR_HINTS[state.code] && <p className="mt-2 text-xs opacity-80">{ERROR_HINTS[state.code]}</p>}
          </Alert>
        </div>
      )}
      {state.status === 'done' && <ResponseDetails response={state.response} />}
    </section>
  );
}

function ResponseDetails({ response: r }: { response: ProxyResponse }) {
  const [tab, setTab] = useState<'body' | 'headers'>('body');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 text-xs">
        <span className={cx('rounded px-2 py-0.5 font-mono text-sm font-bold', statusTone(r.status))}>
          {r.status} {r.statusText}
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          Time <strong className="text-slate-800 dark:text-slate-100">{formatDuration(r.durationMs)}</strong>
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          Size <strong className="text-slate-800 dark:text-slate-100">{formatBytes(r.size)}</strong>
        </span>
        {r.redirected && (
          <span className="truncate text-slate-500 dark:text-slate-400" title={r.url}>
            ↪ Redirected to <span className="font-mono">{r.url}</span>
          </span>
        )}
      </div>
      {r.warnings.length > 0 && (
        <div className="px-4 pt-2">
          <Alert tone="warning">
            {r.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </Alert>
        </div>
      )}
      <Tabs
        className="mt-2 px-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'body', label: 'Body' },
          { value: 'headers', label: `Headers (${r.headers.length})` },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'body' ? <ResponseBody response={r} /> : <HeaderTable headers={r.headers} />}
      </div>
    </div>
  );
}

function ResponseBody({ response: r }: { response: ProxyResponse }) {
  const [view, setView] = useState<'pretty' | 'raw'>('pretty');
  const [showAll, setShowAll] = useState(false);

  const pretty = useMemo(() => (r.bodyEncoding === 'utf8' ? prettyJson(r.body) : null), [r]);
  const isJson = pretty !== null;
  const text = isJson && view === 'pretty' ? pretty : r.body;
  const truncated = !showAll && text.length > DISPLAY_LIMIT;
  const shown = truncated ? text.slice(0, DISPLAY_LIMIT) : text;

  const download = () => {
    const bytes = r.bodyEncoding === 'base64' ? Uint8Array.from(atob(r.body), (c) => c.charCodeAt(0)) : new TextEncoder().encode(r.body);
    const url = URL.createObjectURL(new Blob([bytes], { type: r.contentType || 'application/octet-stream' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `response${extensionFor(r.contentType)}` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const toolbar = (
    <div className="sticky top-0 flex items-center justify-between gap-2 bg-white/95 px-4 py-2 backdrop-blur dark:bg-slate-900/95">
      <div className="flex items-center gap-2">
        {isJson && (
          <Segmented
            label="Body view"
            value={view}
            onChange={setView}
            options={[
              { value: 'pretty', label: 'Pretty' },
              { value: 'raw', label: 'Raw' },
            ]}
          />
        )}
        {r.contentType && <span className="font-mono text-[11px] text-slate-400">{r.contentType}</span>}
      </div>
      <div className="flex items-center gap-1">
        {r.bodyEncoding === 'utf8' && <CopyButton text={r.body} />}
        <Button variant="ghost" onClick={download} disabled={r.size === 0}>
          Download
        </Button>
      </div>
    </div>
  );

  if (r.size === 0) {
    return (
      <>
        {toolbar}
        <p className="px-4 py-2 text-xs text-slate-400">Empty response body.</p>
      </>
    );
  }

  if (r.bodyEncoding === 'base64') {
    return (
      <>
        {toolbar}
        <div className="px-4 pb-4">
          {r.contentType.startsWith('image/') ? (
            <img src={`data:${r.contentType};base64,${r.body}`} alt="Response" className="max-h-[60vh] max-w-full rounded border border-slate-200 dark:border-slate-700" />
          ) : (
            <p className="text-sm text-slate-500">Binary response ({formatBytes(r.size)}). Use Download to save it.</p>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {toolbar}
      <pre className="whitespace-pre-wrap break-all px-4 pb-4 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200">
        {isJson && view === 'pretty' && shown.length <= HIGHLIGHT_LIMIT ? highlightJson(shown) : shown}
      </pre>
      {truncated && (
        <div className="px-4 pb-4">
          <Button onClick={() => setShowAll(true)}>
            Showing first {formatBytes(DISPLAY_LIMIT)} — show all ({formatBytes(text.length)})
          </Button>
        </div>
      )}
    </>
  );
}

function HeaderTable({ headers }: { headers: Array<[string, string]> }) {
  return (
    <>
    {STANDALONE && (
      <p className="px-4 pt-2 text-xs text-slate-500 dark:text-slate-400">
        Browser mode shows only the headers the API exposes via CORS (Access-Control-Expose-Headers).
      </p>
    )}
    <table className="w-full text-left text-xs">
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {headers.map(([k, v], i) => (
          <tr key={i} className="align-top">
            <td className="w-1/3 px-4 py-1.5 font-mono font-semibold text-slate-600 dark:text-slate-300">{k}</td>
            <td className="break-all px-4 py-1.5 font-mono text-slate-800 dark:text-slate-100">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const [, str, colon, literal] = m;
    if (str !== undefined) {
      out.push(
        <span key={i++} className={colon ? 'text-sky-700 dark:text-sky-300' : 'text-emerald-700 dark:text-emerald-300'}>
          {str}
        </span>,
      );
      if (colon) out.push(colon);
    } else {
      out.push(
        <span key={i++} className={literal ? 'text-violet-700 dark:text-violet-300' : 'text-amber-700 dark:text-amber-300'}>
          {m[0]}
        </span>,
      );
    }
    last = start + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function extensionFor(contentType: string): string {
  const ct = contentType.split(';')[0].trim();
  const map: Record<string, string> = {
    'application/json': '.json',
    'text/html': '.html',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/xml': '.xml',
    'text/xml': '.xml',
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'image/webp': '.webp',
  };
  return map[ct] ?? (ct.endsWith('+json') ? '.json' : '');
}
