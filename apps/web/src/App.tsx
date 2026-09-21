import { useState } from 'react';
import { GameScreen } from './ui/GameScreen.js';
import { SetupScreen } from './ui/SetupScreen.js';
import { DEFAULT_SETUP, type MatchSetup } from '@fansong/content';

/** A match is keyed by a monotonic id so starting a new one remounts GameScreen. */
interface ActiveMatch {
  id: number;
  setup: MatchSetup;
}

export function App(): JSX.Element {
  const [match, setMatch] = useState<ActiveMatch | null>(null);

  if (!match) {
    return (
      <SetupScreen
        initial={DEFAULT_SETUP}
        onStart={(setup) => setMatch({ id: Date.now(), setup })}
      />
    );
  }

  return (
    <GameScreen
      key={match.id}
      setup={match.setup}
      onExit={() => setMatch(null)}
    />
  );
}
