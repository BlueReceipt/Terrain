import { describe, expect, it } from 'vitest';
import { myMapsId } from '../../src/domain/mymaps.ts';

// A made-up map ID, shaped like Google's.
const ID = '1PoutineSampleMapIdForTests_0123456';

describe('My Maps links', () => {
  it('reads the map ID from every kind of link My Maps gives', () => {
    for (const link of [
      `https://www.google.com/maps/d/viewer?mid=${ID}&ll=46.8%2C-71.2&z=7`,
      `https://www.google.com/maps/d/edit?mid=${ID}&usp=sharing`,
      `https://www.google.com/maps/d/u/0/edit?mid=${ID}`,
      `https://www.google.com/maps/d/embed?mid=${ID}&ehbc=2E312F`,
      `https://www.google.com/maps/d/kml?mid=${ID}&forcekml=1`,
      `https://www.google.ca/maps/d/viewer?mid=${ID}`,
      `  google.com is not enough, but https://google.com/maps/d/viewer?mid=${ID} is  `,
    ])
      expect(myMapsId(link)).toBe(ID);
  });

  it('reads the embed code from "Embed on my site"', () => {
    const embed = `<iframe src="https://www.google.com/maps/d/embed?mid=${ID}&amp;ehbc=2E312F" width="640" height="480"></iframe>`;
    expect(myMapsId(embed)).toBe(ID);
  });

  it('finds nothing in other links or text', () => {
    for (const text of [
      '',
      ID,
      'https://maps.app.goo.gl/abcdef',
      `https://www.google.com/maps/place/Patate+Attack?mid=${ID}`,
      `https://example.com/maps/d/viewer?mid=${ID}`,
      'https://www.google.com/maps/d/viewer?mid=short',
      'https://www.google.com/maps/d/viewer?mid=<script>',
    ])
      expect(myMapsId(text)).toBeNull();
  });
});
