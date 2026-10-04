import { useState, useSyncExternalStore } from 'react';
import { sfx } from '../audio/sfx.js';
import { SFX_CUES, type SfxCue, type SfxName } from '../audio/sfxCues.js';
import { cueReport } from '../audio/cueToggles.js';
import { downloadJson } from '../game/replay-io.js';

const OPEN_KEY = 'fansong.dev.cuePanel';

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Dev tool (`?dev=1`, over any game): switch sound cues on and off while
 * playing. "Just heard" lists the latest cues asked for, so the one that
 * annoyed you is a click away; the full list is below. Export hands over the
 * cues switched off, to be made the shipped defaults (DISABLED_SFX in
 * cueToggles.ts). Its own buttons don't click, so they don't crowd the list.
 */
export function SoundCuePanel(): JSX.Element {
  const [open, setOpenState] = useState(loadOpen);
  const [filter, setFilter] = useState('');
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Redrawn when a switch flips (or the recordings change), and when a cue is asked for.
  useSyncExternalStore(
    (fn) => sfx.subscribe(fn),
    () => sfx.cueOverrides(),
  );
  const recent = useSyncExternalStore(
    (fn) => sfx.subscribePlays(fn),
    () => sfx.recent(),
  );

  const setOpen = (on: boolean) => {
    setOpenState(on);
    try {
      localStorage.setItem(OPEN_KEY, on ? '1' : '0');
    } catch {
      // Not remembered.
    }
  };

  const off = SFX_CUES.filter((c) => !sfx.enabled(c.name)).length;
  if (!open) {
    return (
      <div className="cue-panel collapsed" data-sfx-quiet>
        <button type="button" onClick={() => setOpen(true)} title="Dev: switch sound cues on and off">
          ♪ Cues{off ? ` (${off} off)` : ''}
        </button>
      </div>
    );
  }

  const exportReport = () => {
    const text = JSON.stringify(cueReport(sfx.cueOverrides()), null, 2);
    setReport(text);
    setCopied(false);
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
    downloadJson(text, 'fansong-sound-cues.json');
  };

  const needle = filter.trim().toLowerCase();
  const shown = SFX_CUES.filter(
    (c) => !needle || c.name.includes(needle) || c.group.toLowerCase().includes(needle) || c.when.toLowerCase().includes(needle),
  );
  const groups = [...new Set(shown.map((c) => c.group))];
  const now = Date.now();

  return (
    <div className="cue-panel" data-sfx-quiet>
      <div className="cue-head">
        <strong>Sound cues</strong>
        <span className="sb-meta">{off} off</span>
        <button type="button" onClick={exportReport} title="Download (and copy) the list of cues switched off">
          Export
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Switch every cue back to the shipped defaults?')) sfx.resetCues();
          }}
        >
          Reset
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>
      <div className="cue-body">
        {report ? (
          <div className="cue-report">
            <div className="sb-label">
              {copied ? 'Copied to the clipboard and downloaded' : 'Downloaded'} as fansong-sound-cues.json
              <button type="button" onClick={() => setReport(null)}>
                ✕
              </button>
            </div>
            <textarea readOnly value={report} rows={6} onFocus={(e) => e.currentTarget.select()} />
          </div>
        ) : null}

        <div className="sb-label">Just heard</div>
        {recent.length === 0 ? (
          <p className="sb-hint">Nothing yet: the cues the game asks for show up here as you play.</p>
        ) : (
          <ul className="cue-list">
            {recent.map((r) => {
              const cue = SFX_CUES.find((c) => c.name === r.name);
              return cue ? <CueRow key={cue.name} cue={cue} age={Math.round((now - r.at) / 1000)} /> : null;
            })}
          </ul>
        )}

        <input
          type="search"
          placeholder="Filter cues"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {groups.map((group) => (
          <div key={group}>
            <div className="sb-label cue-group">
              {group}
              <span>
                <button type="button" onClick={() => setGroup(shown, group, true)}>
                  all on
                </button>
                <button type="button" onClick={() => setGroup(shown, group, false)}>
                  all off
                </button>
              </span>
            </div>
            <ul className="cue-list">
              {shown
                .filter((c) => c.group === group)
                .map((cue) => (
                  <CueRow key={cue.name} cue={cue} />
                ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function setGroup(cues: readonly SfxCue[], group: string, on: boolean): void {
  for (const c of cues) if (c.group === group) sfx.setEnabled(c.name, on);
}

/** One cue: its switch, a preview (heard even when off), and whether it is recorded (✓), stock (♪) or silent (✗). */
function CueRow({ cue, age }: { cue: SfxCue; age?: number }): JSX.Element {
  const on = sfx.enabled(cue.name);
  const stock = sfx.stockFor(cue.name);
  const mark = sfx.recorded(cue.name) > 0 ? '✓' : stock ? '♪' : '✗';
  return (
    <li className={on ? '' : 'off'}>
      <label title={`${cue.when}${stock ? ` · stock: ${stock}` : ''}`}>
        <input type="checkbox" checked={on} onChange={(e) => sfx.setEnabled(cue.name, e.target.checked)} />
        <span className="cue-name">{cue.name}</span>
      </label>
      <span className="sb-meta">
        {age !== undefined ? `${age}s ` : ''}
        {mark}
      </span>
      <button type="button" title="Hear it (even when off)" onClick={() => sfx.play(cue.name as SfxName, { force: true })}>
        ▶
      </button>
    </li>
  );
}
