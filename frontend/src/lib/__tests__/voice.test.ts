/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { createSpeaker, hindiVoices, pickVoice, type VoiceEngine, type VoiceInfo } from '../voice';
import { joinHindi, newKotLine, readyLine, reminderLine, spokenTarget } from '../voiceLines';

describe('spoken lines (always Hindi, Devanagari)', () => {
  it('names tables as written, tokens and apps', () => {
    expect(spokenTarget({ table_label: '5' })).toBe('टेबल 5');
    expect(spokenTarget({ table_label: 'Garden 2' })).toBe('टेबल Garden 2');
    expect(spokenTarget({ table_label: '5', bill_label: 'राहुल' })).toBe('टेबल 5, राहुल');
    expect(spokenTarget({ token_no: 12 })).toBe('टोकन 12');
    expect(spokenTarget({ channel: 'SWIGGY', token_no: 3 })).toBe('स्विगी');
    expect(joinHindi(['टेबल 2', 'टेबल 5', 'टोकन 7'])).toBe('टेबल 2, टेबल 5 और टोकन 7');
    expect(joinHindi(['टेबल 2', 'टेबल 2'])).toBe('टेबल 2');
  });

  it('announces new kitchen orders', () => {
    expect(newKotLine([{ table_label: '5' }])).toBe('नया ऑर्डर आया है। टेबल 5।');
    expect(newKotLine([{ channel: 'ZOMATO', token_no: 4 }])).toBe('ज़ोमैटो का नया ऑर्डर आया है।');
    expect(newKotLine([{ table_label: '2' }, { table_label: '5' }, { token_no: 7 }])).toBe('3 नए ऑर्डर आए हैं। टेबल 2, टेबल 5 और टोकन 7।');
    const items = [{ name: 'बटर नान', quantity: 2 }, { name: 'Dal Makhani', quantity: 1 }, { name: 'Roti', quantity: 1, is_void: true }];
    expect(newKotLine([{ table_label: '5', items }], { items: true })).toBe('नया ऑर्डर आया है। टेबल 5। 2 बटर नान, 1 Dal Makhani।');
    expect(newKotLine([{ table_label: '5', items }])).toBe('नया ऑर्डर आया है। टेबल 5।'); // item names off by default
    expect(newKotLine([])).toBe('');
  });

  it('says ready and reminds until served', () => {
    expect(readyLine([{ table_label: '5' }])).toBe('टेबल 5 का ऑर्डर तैयार है।');
    expect(readyLine([{ table_label: '2' }, { table_label: '5' }])).toBe('टेबल 2 और टेबल 5 का ऑर्डर तैयार है।');
    expect(reminderLine([{ table_label: '5' }])).toBe('याद दिलाना: टेबल 5 का ऑर्डर अभी तक परोसा नहीं गया।');
    expect(readyLine([])).toBe('');
  });
});

const v = (name: string, lang: string, uri = name): VoiceInfo => ({ name, lang, uri, local: true });

describe('choosing a voice', () => {
  const voices = [v('Microsoft Hemant - Hindi (India)', 'hi-IN'), v('Microsoft Kalpana - Hindi (India)', 'hi-IN'), v('Google US English', 'en-US')];

  it('prefers a female Hindi voice, keeps the one the person chose, and finds none without Hindi', () => {
    expect(pickVoice(voices, null)?.name).toBe('Microsoft Kalpana - Hindi (India)');
    expect(pickVoice(voices, 'Microsoft Hemant - Hindi (India)')?.name).toBe('Microsoft Hemant - Hindi (India)');
    expect(pickVoice(voices, 'gone-voice')?.name).toBe('Microsoft Kalpana - Hindi (India)');
    expect(pickVoice([v('Google US English', 'en-US')], null)).toBeNull();
    expect(hindiVoices(voices).map((x) => x.name)).toEqual(['Microsoft Kalpana - Hindi (India)', 'Microsoft Hemant - Hindi (India)']);
  });
});

describe('speaking queue', () => {
  function fakeEngine() {
    const said: string[] = [];
    let release: (() => void) | null = null;
    const engine: VoiceEngine = {
      kind: 'web', available: () => true, voices: () => [v('Lekha', 'hi-IN')], cancel: () => {}, onVoicesChanged: () => () => {},
      speak: (text) => new Promise<void>((resolve) => { said.push(text); release = resolve; }),
    };
    return { engine, said, finish: () => { const r = release; release = null; r?.(); } };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('says lines one after another and never queues the same line twice', async () => {
    const fake = fakeEngine();
    const speaker = createSpeaker(() => fake.engine, () => null);
    speaker.say('टेबल 5 का ऑर्डर तैयार है।');
    speaker.say('टेबल 2 का ऑर्डर तैयार है।');
    speaker.say('टेबल 2 का ऑर्डर तैयार है।'); // already waiting
    expect(fake.said).toEqual(['टेबल 5 का ऑर्डर तैयार है।']);
    expect(speaker.pending()).toEqual(['टेबल 2 का ऑर्डर तैयार है।']);
    fake.finish();
    await flush();
    expect(fake.said).toEqual(['टेबल 5 का ऑर्डर तैयार है।', 'टेबल 2 का ऑर्डर तैयार है।']);
    speaker.say('  ');
    fake.finish();
    await flush();
    expect(speaker.pending()).toEqual([]);
  });
});
