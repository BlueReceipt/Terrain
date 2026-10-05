import { describe, expect, it } from 'vitest';
import { offersSample } from '../../src/ui/sample.ts';

describe('the poutine sample', () => {
  it('is offered on the public demo address only', () => {
    expect(offersSample('terrain.ederer.digital')).toBe(true);
    for (const host of [
      'landagentfriend.ederer.digital',
      'terrain.alexandre-ederer.workers.dev',
      'localhost',
    ])
      expect(offersSample(host)).toBe(false);
  });
});
