/**
 * Floor voice alerts, the decisions only (pure, unit-tested; FloorAnnouncer.tsx speaks):
 * - A dine-in ticket whose live items are all ready → "टेबल 5 का ऑर्डर तैयार है।", once per ticket (per bill). Ready and then
 *   Bump don't announce twice; a ticket that comes back later isn't announced again; a new KOT on the same table is.
 * - Until it is served: "याद दिलाना: …" every `reminderMs` (0 = never), several tables in one line.
 * - On app start / reload: tickets already waiting are NOT announced; only their reminder schedule starts.
 * - Muted: nothing is said, but the bookkeeping goes on as if it had been (so it doesn't all come out when the mute ends).
 */
import type { ReadyToServeEntry } from '@/api/floor';
import { readyLine, reminderLine } from '@/lib/voiceLines';

export interface AnnouncerState {
  /** The first list after start-up has been seen (it is never announced). */
  started: boolean;
  /** Tickets (kot:order) already announced, oldest first; kept after they are served so they are never announced again. */
  announced: string[];
  /** When each waiting ticket was last said (announced or reminded). */
  lastSaid: Record<string, number>;
}

export const initialAnnouncer = (): AnnouncerState => ({ started: false, announced: [], lastSaid: {} });

const MAX_REMEMBERED = 500;

export const entryKey = (e: Pick<ReadyToServeEntry, 'kot_id' | 'order_id'>) => `${e.kot_id}:${e.order_id}`;

/** "Only my tables": the tables assigned to me; otherwise every table. */
export function visibleEntries(entries: ReadyToServeEntry[], opts: { onlyMine: boolean; myStaffId: string | null }): ReadyToServeEntry[] {
  if (!opts.onlyMine || !opts.myStaffId) return entries;
  return entries.filter((e) => e.assigned_staff_id === opts.myStaffId);
}

export function announcerStep(state: AnnouncerState, entries: ReadyToServeEntry[], now: number, opts: { reminderMs: number; muted: boolean }):
  { state: AnnouncerState; lines: string[] } {
  const keys = entries.map(entryKey);
  // Forget waiting times of tickets that were served; keep "announced" (never announce the same ticket twice)
  const lastSaid: Record<string, number> = {};
  for (const k of keys) if (state.lastSaid[k] !== undefined) lastSaid[k] = state.lastSaid[k]!;

  if (!state.started) {
    for (const k of keys) lastSaid[k] = now; // reminders start counting now
    return { state: { started: true, announced: keys.slice(-MAX_REMEMBERED), lastSaid }, lines: [] };
  }

  const announcedSet = new Set(state.announced);
  const fresh = entries.filter((e) => !announcedSet.has(entryKey(e)));
  const announced = [...state.announced, ...fresh.map(entryKey)].slice(-MAX_REMEMBERED);
  for (const e of fresh) lastSaid[entryKey(e)] = now;

  const freshKeys = new Set(fresh.map(entryKey));
  const due = opts.reminderMs > 0
    ? entries.filter((e) => !freshKeys.has(entryKey(e)) && now - (lastSaid[entryKey(e)] ?? now) >= opts.reminderMs)
    : [];
  // A ticket seen for the first time after start-up but already announced elsewhere in this run has no time yet
  for (const e of entries) if (lastSaid[entryKey(e)] === undefined) lastSaid[entryKey(e)] = now;
  for (const e of due) lastSaid[entryKey(e)] = now;

  const lines = opts.muted ? [] : [readyLine(fresh), reminderLine(due)].filter(Boolean);
  return { state: { started: true, announced, lastSaid }, lines };
}
