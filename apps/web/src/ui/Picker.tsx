import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { profileMove, profileRange, unitCost, warbandCost, type MapDef, type Warband, type WarbandUnit } from '@fansong/content';
import { tintPixels } from '../three/spriteTint.js';
import { spriteFor, spriteUrl } from '../three/unitSprites.js';
import { unitKinds } from './unitKinds.js';
import { mapThumb, type MapThumbData } from './mapThumb.js';
import { StatIcons, type UnitStats } from './StatIcons.js';

/** One choice in a {@link Picker}: a card with a picture, a name and a line of detail. */
export interface PickerItem {
  key: string;
  title: string;
  detail?: ReactNode;
  preview: ReactNode;
  disabled?: boolean;
}

export interface PickerGroup {
  label?: string;
  items: readonly PickerItem[];
}

/** Card sizes: wide map thumbnails, warband sprite strips, single units or bare sprites. */
export type PickerKind = 'map' | 'warband' | 'unit' | 'sprite';

/** Offer a text filter once there are more cards than this. */
const FILTER_FROM = 12;

/**
 * How long a gallery ignores clicks after it opens (ms). The second click of a
 * double-click on the trigger lands on whatever the gallery put under the
 * pointer: without this it would pick that card, or close the gallery again.
 */
const SETTLE_MS = 350;

/**
 * A select with pictures: a button showing `children` (the current choice, or a
 * call to action) that opens a gallery of cards. `groups` is built once each
 * time the gallery opens, so a closed picker costs nothing and an open one
 * isn't rebuilt when the screen behind it redraws.
 */
export function Picker({
  title,
  kind,
  groups,
  value,
  onPick,
  children,
  className,
  ariaLabel,
  disabled = false,
}: {
  /** The gallery's heading. */
  title: string;
  kind: PickerKind;
  groups: () => readonly PickerGroup[];
  /** The key of the current choice, highlighted in the gallery. */
  value?: string;
  onPick: (key: string) => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const openedAt = useRef(0);
  const settled = (): boolean => performance.now() - openedAt.current > SETTLE_MS;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector('.picker-card.selected')?.scrollIntoView({ block: 'nearest' });
    } else if (!open && d.open) d.close();
  }, [open]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- the offer is fixed while the gallery is open
  const all = useMemo(() => (open ? groups() : []), [open]);
  const needle = filter.trim().toLowerCase();
  const shown = all
    .map((g) => ({ ...g, items: g.items.filter((it) => it.title.toLowerCase().includes(needle)) }))
    .filter((g) => g.items.length > 0);
  const count = all.reduce((n, g) => n + g.items.length, 0);

  const pick = (key: string): void => {
    if (!settled()) return;
    setOpen(false);
    onPick(key);
  };

  return (
    <>
      <button
        type="button"
        className={`picker-trigger${className ? ` ${className}` : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          setFilter('');
          openedAt.current = performance.now();
          setOpen(true);
        }}
      >
        {children}
        <span className="picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      <dialog
        ref={dialog}
        className="picker-dialog"
        aria-label={title}
        onClose={() => setOpen(false)}
        // A click on the dialog itself (not its contents) is a click on the backdrop.
        onClick={(e) => e.target === e.currentTarget && settled() && setOpen(false)}
      >
        {open ? (
          <div className="picker-body">
            <header className="picker-head">
              <h3>{title}</h3>
              {count > FILTER_FROM ? (
                <input
                  className="picker-filter"
                  placeholder="Filter…"
                  aria-label="Filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              ) : null}
              <button type="button" className="ghost" aria-label="Close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </header>
            <div className="picker-scroll">
              {shown.length === 0 ? <p className="hint">Nothing matches.</p> : null}
              {shown.map((g, i) => (
                <section key={g.label ?? i}>
                  {g.label ? <h4>{g.label}</h4> : null}
                  <div className={`picker-grid picker-${kind}`}>
                    {g.items.map((it) => (
                      <button
                        key={it.key}
                        type="button"
                        className={`picker-card${it.key === value ? ' selected' : ''}`}
                        disabled={it.disabled}
                        onClick={() => pick(it.key)}
                      >
                        <span className="picker-preview">{it.preview}</span>
                        <span className="picker-title">{it.title}</span>
                        {it.detail ? <span className="picker-detail">{it.detail}</span> : null}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

/** A thumbnail ready to draw: every hex of one colour as a single path. */
interface ThumbPaths {
  viewBox: string;
  paths: { fill: string; d: string }[];
  flags: MapThumbData['flags'];
}

const thumbs = new WeakMap<MapDef, ThumbPaths>();

/** A map's thumbnail, worked out once per map: a big map has well over a thousand hexes. */
function thumbPaths(map: MapDef): ThumbPaths {
  let t = thumbs.get(map);
  if (!t) {
    const { viewBox, hexes, flags } = mapThumb(map);
    const byFill = new Map<string, string[]>();
    for (const h of hexes) {
      const d = `M${h.points}Z`;
      const same = byFill.get(h.fill);
      if (same) same.push(d);
      else byFill.set(h.fill, [d]);
    }
    t = { viewBox, paths: [...byFill].map(([fill, ds]) => ({ fill, d: ds.join('') })), flags };
    thumbs.set(map, t);
  }
  return t;
}

/** Work out a map's thumbnail ahead of time, so the gallery that shows it opens at once. */
export function warmMapThumb(map: MapDef): void {
  thumbPaths(map);
}

/** A top-down picture of a map: terrain, deploy zones, objectives. */
export const MapThumb = memo(function MapThumb({ map, className = 'map-thumb' }: { map: MapDef; className?: string }): JSX.Element {
  const t = thumbPaths(map);
  return (
    <svg className={className} viewBox={t.viewBox} role="img" aria-label={`${map.name} preview`}>
      {t.paths.map((p) => (
        <path key={p.fill} d={p.d} fill={p.fill} />
      ))}
      {t.flags.map((f, i) => (
        <circle key={i} cx={f.cx} cy={f.cy} r={0.55} fill={f.fill} stroke="#fff" strokeWidth={0.15} />
      ))}
    </svg>
  );
});

/** A unit's sprite, drawn as its look (or its name) and in its tint. */
export function UnitSprite({ unit, className = 'unit-sprite' }: { unit: WarbandUnit; className?: string }): JSX.Element {
  return <LookSprite look={unit.look ?? unit.name} tint={unit.tint} className={className} />;
}

/** The sprite for a look name, tinted if given a tint. */
export function LookSprite({
  look,
  tint,
  className = 'unit-sprite',
}: {
  look: string;
  tint?: string;
  className?: string;
}): JSX.Element {
  const plain = spriteUrl(spriteFor(look));
  const [tinted, setTinted] = useState<{ key: string; url: string } | null>(null);
  const key = `${tint}:${plain}`;
  // Sprites are fetched as they are first shown: a spinner stands in until this one has drawn.
  const [drawn, setDrawn] = useState<string | null>(null);
  useEffect(() => {
    if (!tint) return;
    let live = true;
    void tintedSpriteUrl(plain, tint).then((url) => live && setTinted({ key, url }), () => {});
    return () => {
      live = false;
    };
  }, [plain, tint, key]);
  // Until the tinted copy is ready, show the plain sprite rather than nothing.
  const src = tint && tinted?.key === key ? tinted.url : plain;
  return <img className={drawn === plain ? className : `${className} sprite-waiting`} src={src} alt="" loading="lazy" onLoad={() => setDrawn(plain)} />;
}

const tintedUrls = new Map<string, Promise<string>>();

/** A data URL of the sprite at `url` with `tint` blended in, cached per (sprite, tint). */
export function tintedSpriteUrl(url: string, tint: string): Promise<string> {
  const key = `${tint}:${url}`;
  let p = tintedUrls.get(key);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load sprite ${url}`));
      img.src = url;
    }).then((img) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      // Read back in software: a GPU canvas stalls the page on every getImageData.
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      tintPixels(data.data, tint);
      ctx.putImageData(data, 0, 0);
      return canvas.toDataURL();
    });
    p.catch(() => tintedUrls.delete(key));
    tintedUrls.set(key, p);
  }
  return p;
}

/** Every kind of unit in a warband, side by side, with a `×N` pill on repeated ones. */
export function WarbandStrip({ warband }: { warband: Warband }): JSX.Element {
  return (
    <span className="warband-strip">
      {unitKinds(warband.units).map(({ unit, count }, i) => (
        <span key={i} className="warband-strip-unit">
          <UnitSprite unit={unit} />
          {count > 1 ? <span className="warband-strip-count">×{count}</span> : null}
        </span>
      ))}
    </span>
  );
}

/** A profile's core numbers, ready for {@link StatIcons}. */
export function profileStats(u: WarbandUnit): UnitStats {
  return { quality: u.quality, combat: u.combat, move: profileMove(u), ...(u.shooter ? { range: profileRange(u) } : {}) };
}

/** A unit's core numbers as icons, then its cost (e.g. `· 14 pts`). */
export function unitLine(u: WarbandUnit, cost: number | null = unitCost(u)): JSX.Element {
  return (
    <span className="unit-line">
      <StatIcons stats={profileStats(u)} />
      {cost === null ? null : <span>· {cost} pts</span>}
    </span>
  );
}

/** A gallery card for a unit. */
export function unitItem(key: string, u: WarbandUnit, detail: ReactNode = unitLine(u)): PickerItem {
  return { key, title: u.name, detail, preview: <UnitSprite unit={u} /> };
}

/** A gallery card for a whole warband: its units side by side. */
export function warbandItem(key: string, w: Warband, detail = `${warbandCost(w)} pts · ${w.units.length} units`): PickerItem {
  return { key, title: w.name, detail, preview: <WarbandStrip warband={w} /> };
}
