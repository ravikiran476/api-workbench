/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" for the browser-only build (see .env.standalone). */
  readonly VITE_STANDALONE?: string;
}
