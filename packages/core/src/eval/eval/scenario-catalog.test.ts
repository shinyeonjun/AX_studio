import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeRequiredSlots } from '../../workflow/canvas/slots/requiredness.js';

describe('Eval scenarios', () => {
  const scenariosPath = join(__dirname, '../scenarios.json');
  const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf-8')) as Array<{
    id: string;
    requiredSlots: string[];
  }>;
  const knownSlots = [
    'goal',
    'trigger',
    'trigger.schedule',
    'trigger.timezone',
    'gmail.account',
    'slack.channel',
    'local_file.path',
    'rdb.connection',
    'approval',
    'send.params.to',
  ];

  for (const scenario of scenarios) {
    it(`records required slots for ${scenario.id}`, () => {
      expect(scenario.requiredSlots.length).toBeGreaterThan(0);
      for (const slot of scenario.requiredSlots) {
        expect(
          knownSlots.includes(slot) || computeRequiredSlots({ goal: 'x', steps: [] }).some((item) => item.slot === slot),
        ).toBe(true);
      }
    });
  }
});
