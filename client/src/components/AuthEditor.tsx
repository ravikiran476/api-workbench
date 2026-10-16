import type { ReactNode } from 'react';
import type { Auth } from '../../../shared/types';
import { Select, TextInput } from './ui';

const DEFAULTS: Record<Auth['type'], Auth> = {
  none: { type: 'none' },
  bearer: { type: 'bearer', token: '' },
  basic: { type: 'basic', username: '', password: '' },
  apikey: { type: 'apikey', key: 'X-API-Key', value: '', in: 'header' },
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:items-center sm:gap-3">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export function AuthEditor({ auth, onChange }: { auth: Auth; onChange: (auth: Auth) => void }) {
  return (
    <div className="max-w-xl space-y-3">
      <Field label="Type">
        <Select value={auth.type} onChange={(e) => onChange(DEFAULTS[e.target.value as Auth['type']])} className="w-48">
          <option value="none">No auth</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic auth</option>
          <option value="apikey">API key</option>
        </Select>
      </Field>

      {auth.type === 'none' && <p className="text-xs text-slate-500 dark:text-slate-400">This request does not use authorization.</p>}

      {auth.type === 'bearer' && (
        <Field label="Token">
          <TextInput className="font-mono text-xs" value={auth.token} placeholder="{{token}}" onChange={(e) => onChange({ ...auth, token: e.target.value })} />
        </Field>
      )}

      {auth.type === 'basic' && (
        <>
          <Field label="Username">
            <TextInput className="font-mono text-xs" value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} />
          </Field>
          <Field label="Password">
            <TextInput type="password" className="font-mono text-xs" value={auth.password} onChange={(e) => onChange({ ...auth, password: e.target.value })} />
          </Field>
        </>
      )}

      {auth.type === 'apikey' && (
        <>
          <Field label="Key">
            <TextInput className="font-mono text-xs" value={auth.key} onChange={(e) => onChange({ ...auth, key: e.target.value })} />
          </Field>
          <Field label="Value">
            <TextInput className="font-mono text-xs" value={auth.value} placeholder="{{apiKey}}" onChange={(e) => onChange({ ...auth, value: e.target.value })} />
          </Field>
          <Field label="Add to">
            <Select value={auth.in} onChange={(e) => onChange({ ...auth, in: e.target.value as 'header' | 'query' })} className="w-48">
              <option value="header">Header</option>
              <option value="query">Query params</option>
            </Select>
          </Field>
        </>
      )}

      {auth.type !== 'none' && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Values support <code>{'{{variables}}'}</code>. A header you set explicitly on the Headers tab takes precedence.
        </p>
      )}
    </div>
  );
}
