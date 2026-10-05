import { describe, expect, it } from 'vitest';
import { fileNameFrom, isPublicDemo } from '../../src/ui/demo.ts';

describe('the public demo', () => {
  it('is the demo address only: the sample and My Maps links show nowhere else', () => {
    expect(isPublicDemo('terrain.ederer.digital')).toBe(true);
    for (const host of [
      'landagentfriend.ederer.digital',
      'terrain.alexandre-ederer.workers.dev',
      'localhost',
    ])
      expect(isPublicDemo(host)).toBe(false);
  });

  it('names a linked map after the file name Google gives it', () => {
    expect(
      fileNameFrom("attachment; filename*=UTF-8''Poutine%20Autour%20du%20qu%C3%A9bec.kmz"),
    ).toBe('Poutine Autour du québec.kmz');
    expect(fileNameFrom('attachment; filename="Casse-croûtes.kmz"')).toBe('Casse-croûtes.kmz');
    expect(fileNameFrom(null)).toBe('My Maps map.kmz');
    expect(fileNameFrom("attachment; filename*=UTF-8''%E0%A4%A")).toBe('My Maps map.kmz');
  });
});
