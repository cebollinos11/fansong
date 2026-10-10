import { useMemo, useState, type ReactNode } from 'react';
import type { RunAction, RunState } from '@fansong/content';
import { LookSprite } from './Picker.js';
import { routeView, type RouteNodeView, type RouteView } from './runView.js';

/**
 * The act's map: the boss at the top, the roads up to it, where the run stands
 * and where it may go. Clicking an open place travels there; the cards beside
 * the map say what is known of each. It draws {@link routeView} and nothing else.
 */
export function RunMap({ run, act, roster }: { run: RunState; act: (action: RunAction) => void; roster?: ReactNode }): JSX.Element | null {
  const view = useMemo(() => routeView(run), [run]);
  const [hover, setHover] = useState<number | null>(null);
  if (!view) return null;
  const shown = view.nodes.find((n) => n.id === hover) ?? null;
  return (
    <>
      <section className="run-panel run-route">
        <h2 className="muster-label">{view.place}</h2>
        <p className="muster-meta">
          Pick your road to the boss. A battle pays in experience, gold and its reward; the enemy grows with every step, fought or not.
        </p>
        <div className="run-route-layout">
          <RouteMap view={view} act={act} hover={hover} onHover={setHover} />
          <div className="run-route-side">
            {shown && shown.state !== 'open' ? <NodeCard node={shown} act={act} /> : null}
            <h3 className="run-mission-pay">The road leads to</h3>
            {view.choices.map((node) => (
              <NodeCard key={node.id} node={node} act={act} lit={node.id === hover} onHover={setHover} />
            ))}
          </div>
        </div>
      </section>
      {roster}
    </>
  );
}

/** The map itself, as an SVG: roads under the places, each place a disc with its sign. */
export function RouteMap({
  view,
  act,
  hover = null,
  onHover,
}: {
  view: RouteView;
  act?: (action: RunAction) => void;
  hover?: number | null;
  onHover?: (id: number | null) => void;
}): JSX.Element {
  return (
    <svg className="run-route-map" viewBox={`0 0 ${view.width} ${view.height}`} role="group" aria-label={`The map of act ${view.act}`}>
      {view.edges.map((e) => (
        <line key={`${e.from}-${e.to}`} className={`run-road ${e.state}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
      ))}
      {view.nodes.map((n) => {
        const go = n.travel && n.travel.error === null && act ? () => act(n.travel!.action) : undefined;
        return (
          <g
            key={n.id}
            className={`run-node ${n.kind} ${n.state}${n.visited ? ' visited' : ''}${n.id === hover ? ' lit' : ''}`}
            transform={`translate(${n.x} ${n.y})`}
            data-node={n.id}
            data-kind={n.kind}
            data-state={n.state}
            role={go ? 'button' : undefined}
            tabIndex={go ? 0 : undefined}
            aria-label={`${n.label}: ${n.lines.join('. ')}`}
            onClick={go}
            onKeyDown={go ? (e) => (e.key === 'Enter' || e.key === ' ') && go() : undefined}
            onMouseEnter={() => onHover?.(n.id)}
            onMouseLeave={() => onHover?.(null)}
          >
            <title>{`${n.label}\n${n.lines.join('\n')}`}</title>
            <circle r={n.kind === 'boss' ? 30 : 22} />
            <text className="run-node-glyph" textAnchor="middle" dominantBaseline="central">
              {n.glyph}
            </text>
            {n.skulls !== undefined && n.kind === 'battle' ? (
              <text className="run-node-skulls" y={34} textAnchor="middle">
                {'☠︎'.repeat(n.skulls)}
              </text>
            ) : null}
            {n.state === 'closed' ? <path className="run-node-cross" d="M-16 -16 L16 16 M16 -16 L-16 16" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

/** What is known of one place, and the way there if it is open. */
function NodeCard({
  node,
  act,
  lit = false,
  onHover,
}: {
  node: RouteNodeView;
  act: (action: RunAction) => void;
  lit?: boolean;
  onHover?: (id: number | null) => void;
}): JSX.Element {
  return (
    <div
      className={`run-node-card ${node.kind} ${node.state}${lit ? ' lit' : ''}`}
      data-node={node.id}
      onMouseEnter={() => onHover?.(node.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="run-node-card-head">
        {node.look ? <LookSprite look={node.look} className="unit-sprite run-shadow" /> : <span className="run-node-card-glyph">{node.glyph}</span>}
        <div>
          <strong>{node.label}</strong>
          {node.lines.map((line, i) => (
            <small key={i}>{line}</small>
          ))}
          {node.state === 'closed' ? <small>You fled this place: the road there is shut.</small> : null}
        </div>
      </div>
      {node.travel ? (
        <button type="button" className="run-go" disabled={node.travel.error !== null} title={node.travel.error ?? undefined} onClick={() => act(node.travel!.action)}>
          {node.kind === 'boss' ? 'Face the boss' : 'Go there'}
        </button>
      ) : null}
    </div>
  );
}
