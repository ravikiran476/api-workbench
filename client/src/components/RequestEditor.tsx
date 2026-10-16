import { useMemo, useState } from 'react';
import { HTTP_METHODS, type ApiRequest, type HttpMethod, type KeyValue } from '../../../shared/types';
import { DEFAULT_SCHEME } from '../api';
import { paramsFromUrl, prepareRequest, toCurl, urlWithParams } from '../lib/request';
import { AuthEditor } from './AuthEditor';
import { BodyEditor } from './BodyEditor';
import { KeyValueEditor } from './KeyValueEditor';
import { Button, CopyButton, METHOD_COLORS, Tabs, cx } from './ui';

type Tab = 'params' | 'headers' | 'auth' | 'body';

const count = (items: KeyValue[]) => items.filter((i) => i.enabled && i.key).length;

export function RequestEditor({
  request,
  onChange,
  variables,
  collectionName,
  dirty,
  sending,
  onSend,
  onCancel,
  onSave,
  onSaveAs,
}: {
  request: ApiRequest;
  onChange: (request: ApiRequest) => void;
  variables: KeyValue[];
  collectionName: string | null;
  dirty: boolean;
  sending: boolean;
  onSend: () => void;
  onCancel: () => void;
  onSave: () => void;
  onSaveAs: () => void;
}) {
  const [tab, setTab] = useState<Tab>('params');
  const set = (patch: Partial<ApiRequest>) => onChange({ ...request, ...patch });

  const prepared = useMemo(() => prepareRequest(request, variables, DEFAULT_SCHEME), [request, variables]);

  const bodyLabel = request.body.mode === 'none' ? 'Body' : `Body · ${request.body.mode === 'urlencoded' ? 'form' : request.body.mode}`;
  const authLabel = request.auth.type === 'none' ? 'Auth' : 'Auth ●';

  return (
    <section className="flex min-h-0 flex-col border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Title row */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
          {collectionName && (
            <>
              <span className="truncate text-slate-400">{collectionName}</span>
              <span className="text-slate-300 dark:text-slate-600">/</span>
            </>
          )}
          <input
            aria-label="Request name"
            value={request.name}
            onChange={(e) => set({ name: e.target.value })}
            className="min-w-0 flex-1 rounded px-1 py-0.5 font-semibold outline-none hover:bg-slate-100 focus:bg-slate-100 dark:hover:bg-slate-800 dark:focus:bg-slate-800"
          />
          {dirty && <span className="size-2 shrink-0 rounded-full bg-orange-500" title="Unsaved changes" />}
        </div>
        <CopyButton text={prepared.request.url ? toCurl(prepared.request) : ''} label="Copy as cURL" />
        <Button variant="secondary" onClick={onSaveAs}>
          Save as…
        </Button>
        <Button variant="secondary" onClick={onSave} title="Save (Ctrl+S)">
          Save
        </Button>
      </div>

      {/* URL bar */}
      <form
        className="flex gap-2 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (sending) onCancel();
          else onSend();
        }}
      >
        <div className="flex min-w-0 flex-1 rounded-md border border-slate-200 focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-500/20 dark:border-slate-700">
          <select
            aria-label="HTTP method"
            value={request.method}
            onChange={(e) => set({ method: e.target.value as HttpMethod })}
            className={cx(
              'rounded-l-md border-r border-slate-200 bg-slate-50 px-2 font-mono text-xs font-bold outline-none dark:border-slate-700 dark:bg-slate-800',
              METHOD_COLORS[request.method],
            )}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            aria-label="Request URL"
            spellCheck={false}
            autoCapitalize="off"
            value={request.url}
            placeholder="https://api.example.com/users?page=1  or  {{baseUrl}}/users"
            onChange={(e) => set({ url: e.target.value, params: paramsFromUrl(e.target.value, request.params) })}
            className="h-9 min-w-0 flex-1 rounded-r-md bg-white px-3 font-mono text-sm outline-none dark:bg-slate-950"
          />
        </div>
        <Button type="submit" variant={sending ? 'secondary' : 'primary'} className="h-[38px] w-24" title="Send (Ctrl+Enter)" disabled={!sending && !request.url.trim()}>
          {sending ? 'Cancel' : 'Send'}
        </Button>
      </form>

      {prepared.unresolved.length > 0 && (
        <p className="-mt-1 px-4 pb-2 text-xs text-amber-700 dark:text-amber-400">
          Undefined {prepared.unresolved.length === 1 ? 'variable' : 'variables'}:{' '}
          {prepared.unresolved.map((v) => (
            <code key={v} className="mr-1.5 rounded bg-amber-100 px-1 dark:bg-amber-950">{`{{${v}}}`}</code>
          ))}
          — select or edit an environment.
        </p>
      )}

      <Tabs
        className="px-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'params', label: `Params${count(request.params) ? ` (${count(request.params)})` : ''}` },
          { value: 'headers', label: `Headers${count(request.headers) ? ` (${count(request.headers)})` : ''}` },
          { value: 'auth', label: authLabel },
          { value: 'body', label: bodyLabel },
        ]}
      />
      <div className="max-h-[40vh] min-h-32 overflow-auto px-4 py-3">
        {tab === 'params' && (
          <KeyValueEditor
            items={request.params}
            onChange={(params) => set({ params, url: urlWithParams(request.url, params) })}
            keyPlaceholder="Query param"
          />
        )}
        {tab === 'headers' && <KeyValueEditor items={request.headers} onChange={(headers) => set({ headers })} keyPlaceholder="Header" suggestHeaders />}
        {tab === 'auth' && <AuthEditor auth={request.auth} onChange={(auth) => set({ auth })} />}
        {tab === 'body' && <BodyEditor body={request.body} method={request.method} onChange={(body) => set({ body })} />}
      </div>
    </section>
  );
}
