import { useState } from 'react';
import type { Collection } from '../../../shared/types';
import { Button, Modal, Select, TextInput } from './ui';

const NEW = '__new__';

export function SaveDialog({
  title,
  collections,
  initialName,
  initialCollectionId,
  onSave,
  onClose,
}: {
  title: string;
  collections: Collection[];
  initialName: string;
  initialCollectionId: string | null;
  /** Receives either an existing collection id or a name for a new collection. */
  onSave: (target: { collectionId: string } | { newCollectionName: string }, requestName: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [collectionId, setCollectionId] = useState(initialCollectionId ?? collections[0]?.id ?? NEW);
  const [newCollection, setNewCollection] = useState('');
  const [busy, setBusy] = useState(false);

  const isNew = collectionId === NEW;
  const valid = name.trim() && (!isNew || newCollection.trim());

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSave(isNew ? { newCollectionName: newCollection.trim() } : { collectionId }, name.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Request name</span>
          <TextInput className="w-full" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Collection</span>
          <Select className="w-full text-sm" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW}>+ New collection…</option>
          </Select>
        </label>
        {isNew && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">New collection name</span>
            <TextInput className="w-full" value={newCollection} placeholder="My API" onChange={(e) => setNewCollection(e.target.value)} />
          </label>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
