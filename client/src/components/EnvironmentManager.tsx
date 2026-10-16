import { useEffect, useState } from 'react';
import type { Environment } from '../../../shared/types';
import { KeyValueEditor } from './KeyValueEditor';
import { Button, Modal, TextInput, cx } from './ui';

export function EnvironmentManager({
  environments,
  activeId,
  onClose,
  onCreate,
  onSave,
  onDelete,
}: {
  environments: Environment[];
  activeId: string;
  onClose: () => void;
  onCreate: (name: string) => Promise<Environment | undefined>;
  onSave: (env: Environment) => Promise<boolean>;
  onDelete: (env: Environment) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(activeId || environments[0]?.id || '');
  const selected = environments.find((e) => e.id === selectedId) ?? null;
  const [draft, setDraft] = useState<Environment | null>(selected);
  const [newName, setNewName] = useState('');

  // Reset the draft whenever a different environment is selected (or it was saved/deleted).
  useEffect(() => setDraft(selected), [selected]);

  const dirty = !!draft && !!selected && JSON.stringify(draft) !== JSON.stringify(selected);

  const select = (id: string) => {
    if (dirty && !confirm('Discard unsaved changes to this environment?')) return;
    setSelectedId(id);
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const env = await onCreate(name);
    if (env) {
      setNewName('');
      setSelectedId(env.id);
    }
  };

  return (
    <Modal
      title="Environments"
      wide
      onClose={() => {
        if (!dirty || confirm('Discard unsaved changes?')) onClose();
      }}
    >
      <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
        <div className="space-y-2">
          <ul className="space-y-0.5">
            {environments.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => select(e.id)}
                  className={cx(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm',
                    e.id === selectedId ? 'bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200' : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="truncate">{e.name}</span>
                  {e.id === activeId && <span className="text-[10px] font-semibold uppercase text-emerald-600">active</span>}
                </button>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <TextInput aria-label="New environment name" placeholder="New environment" className="min-w-0 flex-1 text-xs" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button type="submit" disabled={!newName.trim()}>
              Add
            </Button>
          </form>
        </div>

        <div className="min-w-0">
          {!draft ? (
            <p className="py-8 text-center text-sm text-slate-400">Create an environment to define variables like {'{{baseUrl}}'} or {'{{token}}'}.</p>
          ) : (
            <div className="space-y-3">
              <TextInput aria-label="Environment name" className="w-full font-semibold" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <KeyValueEditor items={draft.variables} onChange={(variables) => setDraft({ ...draft, variables })} keyPlaceholder="Variable" valuePlaceholder="Value" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Use variables anywhere in a request as <code>{'{{name}}'}</code>. Values are stored unencrypted in the server's workspace file.
              </p>
              <div className="flex justify-between gap-2 pt-2">
                <Button
                  variant="ghost"
                  className="text-rose-600"
                  onClick={() => {
                    if (selected && confirm(`Delete environment "${selected.name}"?`)) void onDelete(selected).then(() => setSelectedId(''));
                  }}
                >
                  Delete
                </Button>
                <div className="flex gap-2">
                  <Button disabled={!dirty} onClick={() => setDraft(selected)}>
                    Revert
                  </Button>
                  <Button variant="primary" disabled={!dirty || !draft.name.trim()} onClick={() => void onSave(draft)}>
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
