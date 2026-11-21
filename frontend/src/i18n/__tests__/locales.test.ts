import en from '../locales/en.json';
import hi from '../locales/hi.json';
import gu from '../locales/gu.json';
import { currentLocale, setLanguage, t } from '../index';
import { money } from '@/lib/format';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

const PLACEHOLDER = /\{\{\w+\}\}/g;
const english = flatten(en as Tree);

afterEach(() => setLanguage('en'));

describe.each([['hi', hi], ['gu', gu]] as const)('%s locale', (lang, tree) => {
  const strings = flatten(tree as Tree);

  it('only translates keys that exist in English', () => {
    expect(Object.keys(strings).filter((k) => !(k in english))).toEqual([]);
  });

  it('keeps every {{placeholder}} the English text has (except plural helpers v, v2…)', () => {
    const problems: string[] = [];
    for (const [key, text] of Object.entries(strings)) {
      const all: string[] = english[key]!.match(PLACEHOLDER) ?? [];
      const want = all.filter((p) => !/^\{\{v\d*\}\}$/.test(p));
      const have: string[] = text.match(PLACEHOLDER) ?? [];
      if (!want.every((p) => have.includes(p)) || !have.every((p) => all.includes(p))) problems.push(key);
    }
    expect(problems).toEqual([]);
  });

  it('switches the active language and falls back to English for untranslated keys', () => {
    setLanguage(lang);
    expect(t('common.settings')).toBe((strings['common.settings'] as string));
    expect(t('common.settings')).not.toBe(english['common.settings']);
    const untranslated = Object.keys(english).find((k) => !(k in strings))!;
    expect(t(untranslated)).toBe(english[untranslated]);
  });
});

describe('formatting', () => {
  it('uses Indian grouping and Latin digits in every language', () => {
    for (const lang of ['en', 'hi', 'gu'] as const) {
      setLanguage(lang);
      expect(money(123456.5)).toBe('₹1,23,456.50');
    }
  });

  it('picks the matching locale', () => {
    expect(currentLocale()).toBe('en-IN');
    setLanguage('hi');
    expect(currentLocale()).toBe('hi-IN-u-nu-latn');
    setLanguage('gu');
    expect(currentLocale()).toBe('gu-IN-u-nu-latn');
  });

  it('interpolates values', () => {
    expect(t('ui.DataList.sort_by_title', { title: 'Name' })).toBe('Sort by Name');
    setLanguage('hi');
    expect(t('ui.DataList.sort_by_title', { title: 'नाम' })).toBe('नाम के अनुसार क्रमबद्ध करें');
  });
});
