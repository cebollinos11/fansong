import { describe } from 'vitest';
import { aiScoresZones, everyMapCompletes } from './harness.js';

describe('every built-in map: conquest', () => everyMapCompletes('conquest'));

describe('AI in conquest', () => aiScoresZones('conquest'));
