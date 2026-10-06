import { afterEach, describe, expect, it } from 'vitest';
import { clientWords, language, setLanguage, strings } from '../../src/ui/strings.ts';

// Alex, 2026-10-06: the screens in English or French; the files for the client in English.

afterEach(() => {
  setLanguage('en');
});

describe('the language of the screens', () => {
  it('switches every word on screen to French', () => {
    setLanguage('fr');
    expect(language.value).toBe('fr');
    expect(strings.settings.title).toBe('Paramètres');
    expect(strings.dayLog.open).toBe('Journal du jour');
    // French counts 0 and 1 in the singular, and writes its numbers its way.
    expect([strings.rows(0), strings.rows(1), strings.rows(2)]).toEqual([
      '0 fiche',
      '1 fiche',
      '2 fiches',
    ]);
    expect(strings.settings.size(4_194_304)).toBe('4,0 Mo');
    setLanguage('en');
    expect(strings.settings.title).toBe('Settings');
    expect(strings.rows(2)).toBe('2 entries');
    expect(strings.settings.size(4_194_304)).toBe('4.0 MB');
  });

  it('keeps the files for the client in English, whatever the screens say', () => {
    setLanguage('fr');
    expect(clientWords.journal.headers[0]).toBe('Date');
    expect(clientWords.journal.actions.newOwner).toBe('New owner');
    expect(clientWords.exports.appHeaders.packageStatus).toBe('Package status');
    expect(clientWords.exports.parcelsSheet).toBe('Parcels');
    expect(clientWords.previousInfo.previousOwner('Marie Trempette', '26.09.2026')).toBe(
      'Marie Trempette (until 26.09.2026)',
    );
    expect(clientWords.notes.lotSpread('Given', 'Luc', '12, chemin du Lac', '26.09.2026')).toBe(
      'Given with Luc at 12, chemin du Lac, 26.09.2026',
    );
  });
});
