import { useEffect, useRef } from 'react';
import type { KeyValue } from '../../../shared/types';
import { newKeyValue } from '../lib/request';
import { Checkbox, IconButton, TextInput } from './ui';

const COMMON_HEADERS = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'If-Match',
  'If-None-Match',
  'Origin',
  'Referer',
  'User-Agent',
  'X-API-Key',
  'X-Request-ID',
];

/**
 * Editable key/value table. A trailing blank row turns into a real row as soon as you type in it.
 */
export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  suggestHeaders = false,
}: {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  suggestHeaders?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ id: string; field: 'key' | 'value' } | null>(null);

  // After the blank row becomes a real row, move the caret into it so typing continues there.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const input = containerRef.current?.querySelector<HTMLInputElement>(`[data-row="${target.id}"][data-field="${target.field}"]`);
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [items]);

  const update = (id: string, patch: Partial<KeyValue>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remove = (id: string) => onChange(items.filter((i) => i.id !== id));
  const addFromBlank = (field: 'key' | 'value', text: string) => {
    const row = { ...newKeyValue(), [field]: text };
    pendingFocus.current = { id: row.id, field };
    onChange([...items, row]);
  };
  const listId = suggestHeaders ? 'common-headers' : undefined;

  return (
    <div ref={containerRef} className="space-y-1.5">
      {suggestHeaders && (
        <datalist id="common-headers">
          {COMMON_HEADERS.map((h) => (
            <option key={h} value={h} />
          ))}
        </datalist>
      )}
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <Checkbox label="Enabled" checked={item.enabled} onChange={(enabled) => update(item.id, { enabled })} />
          <TextInput
            aria-label="Key"
            data-row={item.id}
            data-field="key"
            list={listId}
            className={`min-w-0 flex-1 font-mono text-xs ${item.enabled ? '' : 'opacity-50'}`}
            value={item.key}
            placeholder={keyPlaceholder}
            onChange={(e) => update(item.id, { key: e.target.value })}
          />
          <TextInput
            aria-label="Value"
            data-row={item.id}
            data-field="value"
            className={`min-w-0 flex-[2] font-mono text-xs ${item.enabled ? '' : 'opacity-50'}`}
            value={item.value}
            placeholder={valuePlaceholder}
            onChange={(e) => update(item.id, { value: e.target.value })}
          />
          <IconButton label="Remove row" onClick={() => remove(item.id)}>
            ✕
          </IconButton>
        </div>
      ))}
      {/* Blank row for adding */}
      <div className="flex items-center gap-2 opacity-70 focus-within:opacity-100">
        <span className="size-3.5 shrink-0" />
        <TextInput
          aria-label="New key"
          list={listId}
          className="min-w-0 flex-1 font-mono text-xs"
          value=""
          placeholder={keyPlaceholder}
          onChange={(e) => addFromBlank('key', e.target.value)}
        />
        <TextInput
          aria-label="New value"
          className="min-w-0 flex-[2] font-mono text-xs"
          value=""
          placeholder={valuePlaceholder}
          onChange={(e) => addFromBlank('value', e.target.value)}
        />
        <span className="size-7 shrink-0" />
      </div>
    </div>
  );
}
