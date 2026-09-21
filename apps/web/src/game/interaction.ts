import type { Command, Vec } from '@fansong/engine';

/**
 * Projection of the engine's legal-command list into the shapes the board and
 * HUD need. Purely derived from `getLegalCommands` output — the UI invents no
 * options of its own.
 */
export interface Interaction {
  /** Own units that may be activated (awaitingActivation). */
  selectableUnitIds: string[];
  /** Distinct dice counts offered for activation. */
  diceChoices: number[];
  /** Cells the active unit may move into (acting). */
  moveTargets: Vec[];
  /** Enemy unit ids the active unit may attack (acting). */
  attackTargetIds: string[];
  /** Whether EndActivation is currently legal. */
  canEndActivation: boolean;
}

export function deriveInteraction(legal: Command[]): Interaction {
  const selectable = new Set<string>();
  const diceChoices = new Set<number>();
  const moveTargets: Vec[] = [];
  const attackTargetIds: string[] = [];
  let canEndActivation = false;

  for (const c of legal) {
    switch (c.type) {
      case 'ChooseActivation':
        selectable.add(c.unitId);
        diceChoices.add(c.diceCount);
        break;
      case 'Move':
        moveTargets.push(c.to);
        break;
      case 'Attack':
        attackTargetIds.push(c.targetId);
        break;
      case 'EndActivation':
        canEndActivation = true;
        break;
    }
  }

  return {
    selectableUnitIds: [...selectable],
    diceChoices: [...diceChoices].sort((a, b) => a - b),
    moveTargets,
    attackTargetIds,
    canEndActivation,
  };
}
