/**
 * What the voice alerts say. Always Hindi, in Devanagari script (Hindi voices read it best), whatever the app's language.
 * Pure functions, unit-tested. Table names are read as written ("टेबल 5", "टेबल T5", "टेबल Garden 2").
 */

/** Who an order is for, as a short spoken name: a table, a token, or an online channel. */
export interface SpokenTarget {
  table_label?: string | null;
  bill_label?: string | null;
  token_no?: number | string | null;
  channel?: string | null;
}

const CHANNEL_HI: Record<string, string> = {
  SWIGGY: 'स्विगी', ZOMATO: 'ज़ोमैटो', ONDC: 'ओएनडीसी', MAGICPIN: 'मैजिकपिन', ONLINE: 'ऑनलाइन', OTHER: 'फ़ोन',
};

const clean = (s: string | number | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** "टेबल 5", "टेबल 5, राहुल" (a named bill on a shared table), "टोकन 12", "स्विगी" */
export function spokenTarget(t: SpokenTarget): string {
  const table = clean(t.table_label);
  if (table) {
    const bill = clean(t.bill_label);
    return bill ? `टेबल ${table}, ${bill}` : `टेबल ${table}`;
  }
  const channel = clean(t.channel).toUpperCase();
  if (channel && CHANNEL_HI[channel]) return CHANNEL_HI[channel]!;
  const token = clean(t.token_no);
  return token ? `टोकन ${token}` : 'काउंटर';
}

/** "टेबल 2", "टेबल 2 और टेबल 5", "टेबल 2, टेबल 5 और टोकन 7" (duplicates said once) */
export function joinHindi(parts: string[]): string {
  const list = parts.filter((p, i) => p && parts.indexOf(p) === i);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} और ${list[list.length - 1]}`;
}

export interface SpokenKot extends SpokenTarget {
  items?: { name: string; quantity: number; is_void?: boolean }[];
}

/** Kitchen: "नया ऑर्डर आया है। टेबल 5।" — several at once: "3 नए ऑर्डर आए हैं। टेबल 2, टेबल 5 और टोकन 7।" */
export function newKotLine(kots: SpokenKot[], opts: { items?: boolean } = {}): string {
  if (!kots.length) return '';
  if (kots.length > 1) return `${kots.length} नए ऑर्डर आए हैं। ${joinHindi(kots.map(spokenTarget))}।`;
  const one = kots[0]!;
  const target = spokenTarget(one);
  // An app order is named by its app: "स्विगी का नया ऑर्डर आया है।"
  const fromApp = !clean(one.table_label) && !!CHANNEL_HI[clean(one.channel).toUpperCase()];
  const parts = fromApp ? [`${target} का नया ऑर्डर आया है।`] : ['नया ऑर्डर आया है।', `${target}।`];
  if (opts.items) {
    const items = (one.items ?? []).filter((i) => !i.is_void && clean(i.name));
    if (items.length) parts.push(`${items.map((i) => `${i.quantity} ${clean(i.name)}`).join(', ')}।`);
  }
  return parts.join(' ');
}

/** Waiters: "टेबल 5 का ऑर्डर तैयार है।" — several: "टेबल 2 और टेबल 5 का ऑर्डर तैयार है।" */
export function readyLine(targets: SpokenTarget[]): string {
  if (!targets.length) return '';
  return `${joinHindi(targets.map(spokenTarget))} का ऑर्डर तैयार है।`;
}

/** Reminder until served: "याद दिलाना: टेबल 5 का ऑर्डर अभी तक परोसा नहीं गया।" */
export function reminderLine(targets: SpokenTarget[]): string {
  if (!targets.length) return '';
  return `याद दिलाना: ${joinHindi(targets.map(spokenTarget))} का ऑर्डर अभी तक परोसा नहीं गया।`;
}

/** Said once when voice is turned on (the tap browsers need before they speak). */
export const VOICE_ON_LINE = 'आवाज़ चालू है।';

/** "Test voice" in settings. */
export const TEST_LINE = 'यह आवाज़ की जाँच है। टेबल 5 का ऑर्डर तैयार है।';
