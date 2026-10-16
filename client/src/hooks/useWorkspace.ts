import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiRequest, Collection, Environment, Workspace } from '../../../shared/types';
import { api } from '../api';

/**
 * Loads the workspace from the server and exposes actions that persist changes.
 * State is updated from server responses, so what you see is what was saved.
 * Actions throw on failure; callers decide how to report errors.
 */
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const ref = useRef<Workspace | null>(null);
  ref.current = workspace;

  const reload = useCallback(() => {
    setLoadError(null);
    api
      .workspace()
      .then(setWorkspace)
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const replaceCollection = (c: Collection) =>
    setWorkspace((w) => w && { ...w, collections: w.collections.map((x) => (x.id === c.id ? c : x)) });
  const replaceEnvironment = (e: Environment) =>
    setWorkspace((w) => w && { ...w, environments: w.environments.map((x) => (x.id === e.id ? e : x)) });

  const getCollection = (id: string) => {
    const c = ref.current?.collections.find((x) => x.id === id);
    if (!c) throw new Error('Collection no longer exists');
    return c;
  };

  const actions = useMemo(
    () => ({
      reload,

      async createCollection(name: string) {
        const c = await api.createCollection(name);
        setWorkspace((w) => w && { ...w, collections: [...w.collections, c] });
        return c;
      },

      async renameCollection(id: string, name: string) {
        replaceCollection(await api.saveCollection({ ...getCollection(id), name }));
      },

      async deleteCollection(id: string) {
        await api.deleteCollection(id);
        setWorkspace((w) => w && { ...w, collections: w.collections.filter((c) => c.id !== id) });
      },

      /** Inserts or replaces a request in a collection. */
      async saveRequest(collectionId: string, request: ApiRequest) {
        const c = getCollection(collectionId);
        const exists = c.requests.some((r) => r.id === request.id);
        const requests = exists ? c.requests.map((r) => (r.id === request.id ? request : r)) : [...c.requests, request];
        replaceCollection(await api.saveCollection({ ...c, requests }));
      },

      async deleteRequest(collectionId: string, requestId: string) {
        const c = getCollection(collectionId);
        replaceCollection(await api.saveCollection({ ...c, requests: c.requests.filter((r) => r.id !== requestId) }));
      },

      async importPostman(json: unknown) {
        const result = await api.importPostman(json);
        setWorkspace(
          (w) =>
            w && {
              collections: [...w.collections, result.collection],
              environments: result.environment ? [...w.environments, result.environment] : w.environments,
            },
        );
        return result;
      },

      async createEnvironment(name: string) {
        const env = await api.createEnvironment(name);
        setWorkspace((w) => w && { ...w, environments: [...w.environments, env] });
        return env;
      },

      async saveEnvironment(env: Environment) {
        replaceEnvironment(await api.saveEnvironment(env));
      },

      async deleteEnvironment(id: string) {
        await api.deleteEnvironment(id);
        setWorkspace((w) => w && { ...w, environments: w.environments.filter((e) => e.id !== id) });
      },
    }),
    [reload],
  );

  return { workspace, loadError, actions };
}
