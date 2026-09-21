/** Worker bindings, declared in `wrangler.toml`. */
export interface Env {
  /** Durable Object namespace for game rooms (one instance per match). */
  GAME_ROOM: DurableObjectNamespace;
  /** Durable Object namespace for the matchmaker (a single global instance). */
  MATCHMAKER: DurableObjectNamespace;
}
