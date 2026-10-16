import { useMemo, useRef } from 'react';
import type { HttpMethod, KeyValue, RequestBody } from '../../../shared/types';
import { prettyJson } from '../lib/request';
import { KeyValueEditor } from './KeyValueEditor';
import { Alert, Button, Segmented, TextArea } from './ui';

type Mode = RequestBody['mode'];

export function BodyEditor({ body, method, onChange }: { body: RequestBody; method: HttpMethod; onChange: (body: RequestBody) => void }) {
  // Remember text/fields across mode switches so toggling modes doesn't lose input.
  const lastText = useRef(body.mode === 'json' || body.mode === 'text' ? body.text : '');
  const lastFields = useRef<KeyValue[]>(body.mode === 'urlencoded' ? body.fields : []);
  if (body.mode === 'json' || body.mode === 'text') lastText.current = body.text;
  if (body.mode === 'urlencoded') lastFields.current = body.fields;

  const setMode = (mode: Mode) => {
    if (mode === 'none') onChange({ mode });
    else if (mode === 'urlencoded') onChange({ mode, fields: lastFields.current });
    else onChange({ mode, text: lastText.current });
  };

  const jsonStatus = useMemo(() => {
    if (body.mode !== 'json' || !body.text.trim()) return null;
    if (prettyJson(body.text) !== null) return 'valid';
    return /\{\{[^}]+\}\}/.test(body.text) ? 'has-vars' : 'invalid';
  }, [body]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Body type"
          value={body.mode}
          onChange={setMode}
          options={[
            { value: 'none', label: 'None' },
            { value: 'json', label: 'JSON' },
            { value: 'text', label: 'Text' },
            { value: 'urlencoded', label: 'Form URL-encoded' },
          ]}
        />
        {body.mode === 'json' && (
          <div className="flex items-center gap-2 text-xs">
            {jsonStatus === 'valid' && <span className="text-emerald-600 dark:text-emerald-400">✓ Valid JSON</span>}
            {jsonStatus === 'invalid' && <span className="text-rose-600 dark:text-rose-400">Invalid JSON</span>}
            {jsonStatus === 'has-vars' && <span className="text-slate-500">Contains variables</span>}
            <Button
              variant="ghost"
              disabled={jsonStatus !== 'valid'}
              onClick={() => onChange({ mode: 'json', text: prettyJson(body.text) ?? body.text })}
            >
              Beautify
            </Button>
          </div>
        )}
      </div>

      {(method === 'GET' || method === 'HEAD') && body.mode !== 'none' && (
        <Alert tone="warning">{method} requests can't carry a body; it will be omitted when sending.</Alert>
      )}

      {body.mode === 'none' && <p className="text-xs text-slate-500 dark:text-slate-400">This request has no body.</p>}
      {(body.mode === 'json' || body.mode === 'text') && (
        <TextArea
          aria-label="Request body"
          rows={10}
          value={body.text}
          invalid={jsonStatus === 'invalid'}
          placeholder={body.mode === 'json' ? '{\n  "name": "{{userName}}"\n}' : 'Plain text body'}
          onChange={(e) => onChange({ mode: body.mode, text: e.target.value })}
        />
      )}
      {body.mode === 'urlencoded' && <KeyValueEditor items={body.fields} onChange={(fields) => onChange({ mode: 'urlencoded', fields })} />}
    </div>
  );
}
