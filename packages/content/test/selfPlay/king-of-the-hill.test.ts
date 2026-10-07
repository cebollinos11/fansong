import { describe } from 'vitest';
import { aiScoresZones, everyMapCompletes } from './harness.js';

describe('every built-in map: king-of-the-hill', () => everyMapCompletes('king-of-the-hill'));

describe('AI in king-of-the-hill', () => aiScoresZones('king-of-the-hill'));
