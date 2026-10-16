import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from '../../shared/types';
import { WorkspaceSchema } from './schemas';

const EMPTY: Workspace = { collections: [], environments: [] };

/**
 * Workspace persisted as a single JSON file.
 * Updates are serialized, applied to a copy, and only committed once the file is written,
 * so a failed update never leaves memory and disk out of sync.
 */
export class WorkspaceStore {
  private readonly file: string;
  private data: Workspace = structuredClone(EMPTY);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    // Refuse to start on a corrupt file rather than silently overwriting the user's data.
    const parsed = WorkspaceSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new Error(`${this.file} is not a valid workspace file: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
    }
    this.data = parsed.data;
  }

  get(): Workspace {
    return this.data;
  }

  update<T>(mutate: (draft: Workspace) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const draft = structuredClone(this.data);
      const result = mutate(draft);
      await this.persist(draft);
      this.data = draft;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async persist(data: Workspace): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, this.file);
  }
}
