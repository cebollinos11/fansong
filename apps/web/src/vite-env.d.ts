/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the FanSong worker, e.g. https://fansong.<subdomain>.workers.dev.
   *  Defaults to the local `wrangler dev` address when unset. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
