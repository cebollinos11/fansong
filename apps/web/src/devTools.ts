/** Dev tools (the sandbox, the preset editor, the `&record` sound booth, the cue panel) are on in any build whose URL carries `?dev=1`. */
export function devTools(): boolean {
  return new URLSearchParams(window.location.search).get('dev') === '1';
}
