import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { domainPurity } from '../../eslint.domain-purity.js';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    domainPurity,
  ],
});

async function ruleIds(code: string, filePath = 'src/domain/probe.ts'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'parse-error');
}

describe('domain purity rule', () => {
  it.each([
    [
      'a database library',
      "import Dexie from 'dexie';\nexport const db = Dexie;",
      'no-restricted-imports',
    ],
    [
      'src/data code',
      "import { repo } from '../data/repo.ts';\nexport const r = repo;",
      'no-restricted-imports',
    ],
    ['UI code', "import { h } from 'preact';\nexport const x = h;", 'no-restricted-imports'],
    [
      'the map library',
      "import maplibre from 'maplibre-gl';\nexport const m = maplibre;",
      'no-restricted-imports',
    ],
    ['a browser global', 'export const width = window.innerWidth;', 'no-restricted-globals'],
    ['storage', "export const saved = localStorage.getItem('x');", 'no-restricted-globals'],
    ['the network', "export const response = fetch('/x');", 'no-restricted-globals'],
    ['Date.now()', 'export const t = Date.now();', 'no-restricted-properties'],
    ['new Date() with no argument', 'export const t = new Date();', 'no-restricted-syntax'],
    ['Date() called as a function', 'export const t = Date();', 'no-restricted-syntax'],
    ['Math.random()', 'export const r = Math.random();', 'no-restricted-properties'],
  ])('rejects %s in src/domain', async (_label, code, rule) => {
    expect(await ruleIds(code)).toContain(rule);
  });

  it('accepts pure code, including dates built from a value passed in', async () => {
    const code = [
      'export function stamp(now: Date): string {',
      '  return new Date(now.getTime()).toISOString();',
      '}',
      '',
    ].join('\n');
    expect(await ruleIds(code)).toEqual([]);
  });

  it('does not apply outside src/domain', async () => {
    expect(await ruleIds('export const t = Date.now();', 'src/data/repo.ts')).toEqual([]);
  });
});
