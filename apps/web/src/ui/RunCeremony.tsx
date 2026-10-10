import { useEffect, useRef, useState } from 'react';
import type { RunState } from '@fansong/content';
import { sfx } from '../audio/sfx.js';
import { DIE_PIPS } from '../three/rollOverlay.js';
import { LookSprite } from './Picker.js';
import { injuryChecks, injuryFaces, renameError, standingUnits, type InjuryCheck } from './runView.js';

/**
 * The run's two moments that stop the screen: naming a unit (as it joins, or
 * any time from its card) and, after a battle, the tending of the wounded,
 * where each fallen unit's injury die is thrown one at a time (after a retreat,
 * so is the die of each unit left behind, on its harsher table). The die only
 * shows what the run already rolled: its fate is settled, the throwing is the
 * drama.
 */

/** A face of the die as pips on a 3×3 grid. */
function Die({ face, className = '' }: { face: number; className?: string }): JSX.Element {
  const on = DIE_PIPS[face] ?? [];
  return (
    <span className={`die tend-die ${className}`} aria-label={`a ${face}`}>
      {Array.from({ length: 9 }, (_, p) => (
        <span key={p} className={on.includes(p) ? 'pip on' : 'pip'} />
      ))}
    </span>
  );
}

/** How long the die tumbles before it lands (ms). */
const TUMBLE_MS = 1100;
/** How often it shows a new face while tumbling (ms). */
const FLICKER_MS = 75;

const OUTCOME_SOUND = { ok: 'tend-ok', hurt: 'tend-hurt', lost: 'tend-dead' } as const;

/**
 * The key under which this battle's tending is remembered as seen, so a reload
 * doesn't throw the dice again. By battles fought, not by round: a round
 * retreated from is fought twice.
 */
const tendedKey = (run: RunState): string => `${run.seed}:${run.round}:${run.log.length}`;
const TENDED_STORE = 'fansong.run.tended';

export function wasTended(run: RunState): boolean {
  try {
    return sessionStorage.getItem(TENDED_STORE) === tendedKey(run);
  } catch {
    return false;
  }
}

function markTended(run: RunState): void {
  try {
    sessionStorage.setItem(TENDED_STORE, tendedKey(run));
  } catch {
    // Without storage it plays again on a reload: harmless.
  }
}

/**
 * After a battle: an opening card with the fallen and the standing, then one
 * card per fallen unit with its odds and a die to throw, then back to the
 * aftermath. After a retreat the units left behind are tended too, and those
 * who reached the flag stand with the unhurt. Skippable at any point.
 */
export function TendWounded({ run, onDone }: { run: RunState; onDone: () => void }): JSX.Element | null {
  const checks = injuryChecks(run);
  const standing = standingUnits(run);
  const retreated = run.aftermath?.retreated === true;
  // -1: the opening card; then the index of the unit whose die is up.
  const [step, setStep] = useState(-1);
  const [stage, setStage] = useState<'ready' | 'rolling' | 'landed'>('ready');
  const [face, setFace] = useState(1);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const finish = (): void => {
    timers.current.forEach((t) => window.clearTimeout(t));
    markTended(run);
    onDone();
  };
  const check: InjuryCheck | undefined = checks[step];
  const faces = injuryFaces(check?.leftBehind);

  const throwDie = (): void => {
    if (!check || stage !== 'ready') return;
    setStage('rolling');
    sfx.play('tend-roll');
    const start = performance.now();
    const flick = (): void => {
      if (performance.now() - start >= TUMBLE_MS) {
        setFace(check.die);
        setStage('landed');
        sfx.play(OUTCOME_SOUND[check.tone]);
        return;
      }
      setFace((f) => 1 + ((f + Math.floor(Math.random() * 5)) % 6));
      timers.current.push(window.setTimeout(flick, FLICKER_MS));
    };
    flick();
  };

  const next = (): void => {
    if (step + 1 >= checks.length) return finish();
    setStep(step + 1);
    setStage('ready');
    setFace(1);
  };

  if (checks.length === 0) return null;
  const fallen = checks.length === 1 ? '1 unit' : `${checks.length} units`;
  const behind = checks.filter((c) => c.leftBehind).length;
  const lead = !retreated
    ? `The battle is won, but ${fallen} fell. Roll for each to see who pulls through.`
    : behind === 0
      ? `The retreat is made, but ${fallen} fell on the way. Roll for each to see who pulls through.`
      : `The retreat is made, but ${fallen} did not reach the flag. Roll for each: those left behind on the field fare worse than those who fell.`;
  return (
    <div className="tend-layer" role="dialog" aria-modal="true" aria-label="Tending the wounded">
      <div className={`tend-card${check && stage === 'landed' ? ` tone-${check.tone}` : ''}`}>
        <header className="tend-head">
          <h2>Tending the wounded</h2>
          {step >= 0 ? (
            <span className="tend-count">
              {step + 1} / {checks.length}
            </span>
          ) : null}
          <button type="button" className="tend-skip" onClick={finish} title="Show every result at once">
            Skip
          </button>
        </header>

        {!check ? (
          <div className="tend-open">
            <p className="tend-lead">{lead}</p>
            <div className="tend-row lost">
              {checks.map((c) => (
                <figure key={c.unitId}>
                  <LookSprite look={c.look} tint={c.tint} className="unit-sprite tend-mini fallen" />
                  <figcaption>{c.name}</figcaption>
                </figure>
              ))}
            </div>
            {standing.length > 0 ? (
              <>
                <p className="tend-sub">{retreated ? 'Got away' : 'Came through standing'}</p>
                <div className="tend-row">
                  {standing.map((u, i) => (
                    <figure key={i}>
                      <LookSprite look={u.look} tint={u.tint} className="unit-sprite tend-mini" />
                      <figcaption>{u.name}</figcaption>
                    </figure>
                  ))}
                </div>
              </>
            ) : null}
            <button type="button" className="run-go run-go-big" autoFocus onClick={next}>
              Tend them
            </button>
          </div>
        ) : (
          <div className="tend-unit" key={check.unitId}>
            <LookSprite look={check.look} tint={check.tint} className={`unit-sprite tend-sprite ${stage === 'landed' ? check.tone : 'fallen'}`} />
            <strong className="tend-name">{check.name}</strong>
            <p className="tend-sub">{check.leftBehind ? 'was left behind' : 'fell in battle'}</p>

            <ol className="tend-odds" aria-label="What each roll does">
              {faces.map((f) => (
                <li key={f.die} className={`${f.tone}${stage === 'landed' && f.die === check.die ? ' hit' : ''}`}>
                  <Die face={f.die} className="tiny" />
                  <span>{f.label}</span>
                </li>
              ))}
            </ol>

            <div className="tend-throw">
              <Die face={face} className={stage === 'rolling' ? 'tumbling' : stage === 'landed' ? `landed ${check.tone}` : 'waiting'} />
            </div>

            <div className="tend-verdict" aria-live="polite">
              {stage === 'landed' ? (
                <>
                  <span className={`tend-stamp ${check.tone}`}>{check.verdict}</span>
                  <span className="tend-detail">{check.detail}</span>
                </>
              ) : null}
            </div>

            {stage === 'landed' ? (
              <button type="button" className="run-go run-go-big" autoFocus onClick={next}>
                {step + 1 >= checks.length ? 'Done' : 'Next'}
              </button>
            ) : (
              <button type="button" className="run-go run-go-big" autoFocus disabled={stage === 'rolling'} onClick={throwDie}>
                Roll the die
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Name a roster unit. `joining`: it just joined the warband, and the prompt
 * offers to keep the name it came with.
 */
export function NameUnit({
  run,
  unitId,
  joining,
  onRename,
  onClose,
}: {
  run: RunState;
  unitId: string;
  joining: boolean;
  onRename: (name: string) => void;
  onClose: () => void;
}): JSX.Element | null {
  const unit = run.roster.find((u) => u.id === unitId);
  const [text, setText] = useState(unit?.unit.name ?? '');
  if (!unit) return null;
  const changed = text.trim() !== unit.unit.name;
  const error = changed ? renameError(run, unitId, text) : null;
  const submit = (): void => {
    if (error) return;
    if (changed) onRename(text);
    onClose();
  };
  return (
    <div
      className="tend-layer"
      role="dialog"
      aria-modal="true"
      aria-label={`Name ${unit.unit.name}`}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <form
        className="tend-card name-card"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <header className="tend-head">
          <h2>{joining ? 'A new recruit' : 'Rename'}</h2>
        </header>
        <LookSprite look={unit.unit.look ?? unit.unit.name} tint={unit.unit.tint} className="unit-sprite tend-sprite" />
        <p className="tend-sub">{joining ? `${unit.unit.name} joins the warband. What will you call it?` : `What should ${unit.unit.name} be called?`}</p>
        <input
          className="name-field"
          value={text}
          maxLength={40}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={error !== null}
          aria-label="Name"
        />
        <p className="muster-error name-error">{error ?? ' '}</p>
        <div className="name-actions">
          <button type="button" onClick={onClose}>
            {joining ? `Keep “${unit.unit.name}”` : 'Cancel'}
          </button>
          <button type="submit" className="run-go" disabled={error !== null}>
            {changed ? 'Name it' : 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}
