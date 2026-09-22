/** Worker bindings, declared in `wrangler.toml`. */
export interface Env {
  /** Durable Object namespace for game rooms (one instance per join code). */
  GAME_ROOM: DurableObjectNamespace;
}
