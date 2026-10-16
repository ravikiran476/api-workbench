import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiRequest, Collection } from '../../shared/types';
import { api, ApiClientError } from './api';
import { EnvironmentManager } from './components/EnvironmentManager';
import { RequestEditor } from './components/RequestEditor';
import { ResponseViewer, type ResponseState } from './components/ResponseViewer';
import { SaveDialog } from './components/SaveDialog';
import { Sidebar } from './components/Sidebar';
import { Alert, Button, Select, cx, type Tone } from './components/ui';
import { usePersistentState } from './hooks/usePersistentState';
import { useWorkspace } from './hooks/useWorkspace';
import { newId, newRequest, prepareRequest } from './lib/request';

interface EditorState {
  request: ApiRequest;
  collectionId: string | null;
  /** JSON of the request as last saved/opened; used to detect unsaved changes. */
  snapshot: string;
}

const freshEditor = (): EditorState => {
  const request = newRequest();
  return { request, collectionId: null, snapshot: JSON.stringify(request) };
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const { workspace, loadError, actions } = useWorkspace();
  const [envId, setEnvId] = usePersistentState<string>('apiwb-env', '');
  // The open request survives reloads, including unsaved edits.
  const [editor, setEditor] = usePersistentState<EditorState>('apiwb-editor', freshEditor);
  const [response, setResponse] = useState<ResponseState>({ status: 'idle' });
  const [dialog, setDialog] = useState<null | 'save' | 'save-as' | 'environments'>(null);
  const [toast, setToast] = useState<{ tone: Tone; message: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const collections = workspace?.collections ?? [];
  const environments = workspace?.environments ?? [];
  const activeEnv = environments.find((e) => e.id === envId);
  const editorCollection = collections.find((c) => c.id === editor.collectionId) ?? null;
  const dirty = JSON.stringify(editor.request) !== editor.snapshot;

  const notify = useCallback((tone: Tone, message: string) => setToast({ tone, message }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === 'error' ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Runs an action, reporting failures as a toast. Returns undefined on failure. */
  const attempt = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const result = await fn();
        if (success) notify('success', success);
        return result;
      } catch (e) {
        notify('error', errorMessage(e));
        return undefined;
      }
    },
    [notify],
  );

  const confirmDiscard = () => !dirty || confirm('You have unsaved changes. Discard them?');

  const openRequest = (collectionId: string, request: ApiRequest) => {
    if (request.id === editor.request.id || !confirmDiscard()) return;
    setEditor({ request: structuredClone(request), collectionId, snapshot: JSON.stringify(request) });
    setResponse({ status: 'idle' });
  };

  const newRequestTab = () => {
    if (!confirmDiscard()) return;
    setEditor(freshEditor());
    setResponse({ status: 'idle' });
  };

  // ── Sending ──
  const send = useCallback(async () => {
    const { request, unresolved } = prepareRequest(editor.request, activeEnv?.variables ?? []);
    if (!request.url) return;
    if (unresolved.length) notify('warning', `Sending with undefined variables: ${unresolved.map((v) => `{{${v}}}`).join(', ')}`);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setResponse({ status: 'loading' });
    try {
      const res = await api.send(request, controller.signal);
      setResponse({ status: 'done', response: res });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setResponse({ status: 'idle' });
        return;
      }
      setResponse({ status: 'error', message: errorMessage(e), code: e instanceof ApiClientError ? e.code : undefined });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [editor.request, activeEnv, notify]);

  const cancel = () => abortRef.current?.abort();

  // ── Saving ──
  const save = useCallback(async () => {
    if (!editorCollection) {
      setDialog('save');
      return;
    }
    const request = editor.request;
    const ok = await attempt(() => actions.saveRequest(editorCollection.id, request).then(() => true), 'Saved');
    // Snapshot what was actually saved, so edits made while saving still count as unsaved.
    if (ok) setEditor((ed) => ({ ...ed, snapshot: JSON.stringify(request) }));
  }, [editorCollection, editor.request, actions, attempt, setEditor]);

  const saveTo = async (target: { collectionId: string } | { newCollectionName: string }, name: string, asCopy: boolean) => {
    let collectionId: string;
    if ('collectionId' in target) {
      collectionId = target.collectionId;
    } else {
      const created = await attempt(() => actions.createCollection(target.newCollectionName));
      if (!created) return;
      collectionId = created.id;
    }
    const request: ApiRequest = { ...editor.request, name, id: asCopy ? newId() : editor.request.id };
    const ok = await attempt(() => actions.saveRequest(collectionId, request).then(() => true), 'Saved');
    if (!ok) return;
    setEditor({ request, collectionId, snapshot: JSON.stringify(request) });
    setDialog(null);
  };

  // ── Keyboard shortcuts ──
  const shortcuts = useRef({ send, save, cancel, sending: false });
  shortcuts.current = { send, save, cancel, sending: response.status === 'loading' };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (shortcuts.current.sending) shortcuts.current.cancel();
        else void shortcuts.current.send();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void shortcuts.current.save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Sidebar actions ──
  const createCollection = async () => {
    const name = prompt('Collection name')?.trim();
    if (name) await attempt(() => actions.createCollection(name), `Created "${name}"`);
  };

  const renameCollection = async (c: Collection) => {
    const name = prompt('Rename collection', c.name)?.trim();
    if (name && name !== c.name) await attempt(() => actions.renameCollection(c.id, name));
  };

  const deleteCollection = async (c: Collection) => {
    if (!confirm(`Delete collection "${c.name}" and its ${c.requests.length} request(s)? This cannot be undone.`)) return;
    const ok = await attempt(() => actions.deleteCollection(c.id).then(() => true), `Deleted "${c.name}"`);
    // Keep the open request as an unsaved draft.
    if (ok && editor.collectionId === c.id) setEditor((ed) => ({ ...ed, collectionId: null, snapshot: '' }));
  };

  const deleteRequest = async (c: Collection, r: ApiRequest) => {
    if (!confirm(`Delete "${r.name}"?`)) return;
    const ok = await attempt(() => actions.deleteRequest(c.id, r.id).then(() => true));
    if (ok && editor.request.id === r.id) setEditor((ed) => ({ ...ed, collectionId: null, snapshot: '' }));
  };

  const importFile = async (file: File) => {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      notify('error', `${file.name} is not valid JSON`);
      return;
    }
    const result = await attempt(() => actions.importPostman(json));
    if (!result) return;
    const parts = [`Imported "${result.collection.name}" (${result.collection.requests.length} requests)`];
    if (result.environment) parts.push(`and environment "${result.environment.name}"`);
    if (result.warnings.length) parts.push(`— ${result.warnings.length} warning(s): ${result.warnings.join('; ')}`);
    notify(result.warnings.length ? 'warning' : 'success', parts.join(' '));
  };

  const title = useMemo(() => `${dirty ? '● ' : ''}${editor.request.name} · API Workbench`, [dirty, editor.request.name]);
  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-orange-600 text-white" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 8l5 4-5 4M13 16h6" />
            </svg>
          </span>
          <span className="font-bold tracking-tight">API Workbench</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="hidden text-xs text-slate-500 sm:block" htmlFor="env-select">
            Environment
          </label>
          <Select id="env-select" value={activeEnv ? envId : ''} onChange={(e) => setEnvId(e.target.value)} className="max-w-48">
            <option value="">No environment</option>
            {environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <Button onClick={() => setDialog('environments')}>Manage</Button>
          <ThemeToggle />
        </div>
      </header>

      {loadError ? (
        <div className="grid flex-1 place-items-center p-8">
          <Alert tone="error" className="max-w-md text-sm">
            <p className="font-semibold">Could not load your workspace</p>
            <p className="mt-1">{loadError}</p>
            <Button className="mt-3" onClick={actions.reload}>
              Retry
            </Button>
          </Alert>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-1">
          <Sidebar
            collections={collections}
            activeRequestId={editor.collectionId ? editor.request.id : null}
            onOpen={openRequest}
            onNewRequest={newRequestTab}
            onCreateCollection={() => void createCollection()}
            onRenameCollection={(c) => void renameCollection(c)}
            onDeleteCollection={(c) => void deleteCollection(c)}
            onDeleteRequest={(c, r) => void deleteRequest(c, r)}
            onImport={(f) => void importFile(f)}
          />
          <main className="flex min-h-0 flex-col">
            <RequestEditor
              request={editor.request}
              onChange={(request) => setEditor((ed) => ({ ...ed, request }))}
              variables={activeEnv?.variables ?? []}
              collectionName={editorCollection?.name ?? null}
              dirty={dirty}
              sending={response.status === 'loading'}
              onSend={() => void send()}
              onCancel={cancel}
              onSave={() => void save()}
              onSaveAs={() => setDialog('save-as')}
            />
            <ResponseViewer state={response} onCancel={cancel} />
          </main>
        </div>
      )}

      {(dialog === 'save' || dialog === 'save-as') && (
        <SaveDialog
          title={dialog === 'save' ? 'Save request' : 'Save as new request'}
          collections={collections}
          initialName={dialog === 'save-as' ? `${editor.request.name} (copy)` : editor.request.name}
          initialCollectionId={editor.collectionId}
          onSave={(target, name) => saveTo(target, name, dialog === 'save-as')}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'environments' && (
        <EnvironmentManager
          environments={environments}
          activeId={envId}
          onClose={() => setDialog(null)}
          onCreate={(name) => attempt(() => actions.createEnvironment(name))}
          onSave={async (env) => (await attempt(() => actions.saveEnvironment(env).then(() => true), 'Environment saved')) ?? false}
          onDelete={async (env) => {
            const ok = await attempt(() => actions.deleteEnvironment(env.id).then(() => true));
            if (ok && env.id === envId) setEnvId('');
          }}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <Alert tone={toast.tone} className={cx('pointer-events-auto max-w-xl text-sm shadow-lg')}>
            <div className="flex items-start gap-3">
              <span className="flex-1">{toast.message}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="opacity-60 hover:opacity-100">
                ✕
              </button>
            </div>
          </Alert>
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('apiwb-theme', next ? 'dark' : 'light');
    } catch {
      // storage unavailable — theme still applies for this session
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
    >
      {dark ? '☀' : '☾'}
    </button>
  );
}
