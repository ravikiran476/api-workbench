import { useRef, useState } from 'react';
import type { ApiRequest, Collection } from '../../../shared/types';
import { Button, IconButton, MethodLabel, TextInput, cx } from './ui';

export function Sidebar({
  collections,
  activeRequestId,
  onOpen,
  onNewRequest,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onExportCollection,
  onDeleteRequest,
  onImport,
}: {
  collections: Collection[];
  activeRequestId: string | null;
  onOpen: (collectionId: string, request: ApiRequest) => void;
  onNewRequest: () => void;
  onCreateCollection: () => void;
  onRenameCollection: (c: Collection) => void;
  onDeleteCollection: (c: Collection) => void;
  onExportCollection: (c: Collection) => void;
  onDeleteRequest: (c: Collection, r: ApiRequest) => void;
  onImport: (file: File) => void;
}) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const q = filter.trim().toLowerCase();
  const visible = collections
    .map((c) => ({
      collection: c,
      requests: q
        ? c.requests.filter((r) => `${r.method} ${r.name} ${r.url}`.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
        : c.requests,
    }))
    .filter(({ collection, requests }) => !q || requests.length > 0 || collection.name.toLowerCase().includes(q));

  return (
    <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
      <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <Button variant="primary" className="w-full" onClick={onNewRequest}>
          + New request
        </Button>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={onCreateCollection}>
            New collection
          </Button>
          <Button className="flex-1" onClick={() => fileInput.current?.click()} title="Import a Postman v2.0/v2.1 collection">
            Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
              e.target.value = '';
            }}
          />
        </div>
        <TextInput aria-label="Filter requests" placeholder="Filter…" className="w-full text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <nav aria-label="Collections" className="min-h-0 flex-1 overflow-auto p-2">
        {collections.length === 0 && (
          <p className="px-2 py-6 text-center text-xs leading-relaxed text-slate-400">
            No collections yet.
            <br />
            Create one or import from Postman.
          </p>
        )}
        {visible.map(({ collection: c, requests }) => {
          const open = q ? true : !collapsed[c.id];
          return (
            <div key={c.id} className="mb-1">
              <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-slate-200/60 dark:hover:bg-slate-800">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setCollapsed((s) => ({ ...s, [c.id]: open }))}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-sm font-medium"
                >
                  <span className={cx('text-[10px] text-slate-400 transition', open && 'rotate-90')}>▶</span>
                  <span className="truncate">{c.name}</span>
                  <span className="text-xs font-normal text-slate-400">{c.requests.length}</span>
                </button>
                <div className="hidden items-center group-focus-within:flex group-hover:flex">
                  <IconButton label={`Rename ${c.name}`} onClick={() => onRenameCollection(c)}>
                    ✎
                  </IconButton>
                  <IconButton label={`Export ${c.name} as Postman v2.1`} onClick={() => onExportCollection(c)}>
                    ⤓
                  </IconButton>
                  <IconButton label={`Delete ${c.name}`} onClick={() => onDeleteCollection(c)} className="hover:text-rose-600">
                    🗑
                  </IconButton>
                </div>
              </div>
              {open && (
                <ul className="ml-3 border-l border-slate-200 pl-1 dark:border-slate-800">
                  {requests.length === 0 && <li className="px-2 py-1 text-xs text-slate-400">{q ? 'No matches' : 'Empty — save a request here'}</li>}
                  {requests.map((r) => (
                    <li key={r.id} className="group flex items-center">
                      <button
                        type="button"
                        onClick={() => onOpen(c.id, r)}
                        aria-current={r.id === activeRequestId ? 'true' : undefined}
                        className={cx(
                          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-xs',
                          r.id === activeRequestId
                            ? 'bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200'
                            : 'text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800',
                        )}
                      >
                        <MethodLabel method={r.method} className="w-8 shrink-0" />
                        <span className="truncate">{r.name}</span>
                      </button>
                      <IconButton label={`Delete ${r.name}`} onClick={() => onDeleteRequest(c, r)} className="hidden group-focus-within:grid group-hover:grid hover:text-rose-600">
                        ✕
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
