/// <reference types="jest" />
import type { ReadyToServeEntry } from '@/api/floor';
import { announcerStep, initialAnnouncer, visibleEntries, type AnnouncerState } from '../announcer';

const entry = (kot: string, table: string, over: Partial<ReadyToServeEntry> = {}): ReadyToServeEntry => ({
  kot_id: kot, kot_no: 1, order_id: `o-${table}`, order_code: 'ABC', table_id: `t-${table}`, table_label: table, bill_label: null,
  assigned_staff_id: null, waiter_id: null, ready_count: 1, ready_since: null, ...over,
});

const MIN = 60_000;
const opts = { reminderMs: MIN, muted: false };

/** Runs a sequence of polls and collects what was said at each. */
function run(polls: [number, ReadyToServeEntry[]][], o = opts, start: AnnouncerState = initialAnnouncer()) {
  let state = start;
  return polls.map(([at, list]) => {
    const r = announcerStep(state, list, at, o);
    state = r.state;
    return r.lines;
  });
}

describe('floor announcer', () => {
  it('does not announce what was already ready when the app starts; only starts its reminders', () => {
    const said = run([[0, [entry('k1', '5')]], [30_000, [entry('k1', '5')]], [MIN, [entry('k1', '5')]]]);
    expect(said[0]).toEqual([]);
    expect(said[1]).toEqual([]);
    expect(said[2]).toEqual(['याद दिलाना: टेबल 5 का ऑर्डर अभी तक परोसा नहीं गया।']);
  });

  it('announces a newly ready ticket once, then reminds every interval until it is served', () => {
    const said = run([
      [0, []],
      [10_000, [entry('k1', '5')]],
      [20_000, [entry('k1', '5')]], // still waiting (e.g. now bumped): not announced again
      [10_000 + MIN, [entry('k1', '5')]],
      [10_000 + MIN + 30_000, [entry('k1', '5')]],
      [10_000 + 2 * MIN, [entry('k1', '5')]],
      [10_000 + 2 * MIN + 5_000, []], // served
      [10_000 + 4 * MIN, []],
    ]);
    expect(said).toEqual([
      [],
      ['टेबल 5 का ऑर्डर तैयार है।'],
      [],
      ['याद दिलाना: टेबल 5 का ऑर्डर अभी तक परोसा नहीं गया।'],
      [],
      ['याद दिलाना: टेबल 5 का ऑर्डर अभी तक परोसा नहीं गया।'],
      [],
      [],
    ]);
  });

  it('never announces the same ticket twice, but a new KOT on the same table is announced', () => {
    const said = run([
      [0, []],
      [1_000, [entry('k1', '5')]],
      [2_000, []], // served
      [3_000, [entry('k1', '5')]], // the same ticket shows up again (sent back, ready again)
      [4_000, [entry('k1', '5'), entry('k2', '5')]], // "one more naan": a new KOT
    ]);
    expect(said[1]).toEqual(['टेबल 5 का ऑर्डर तैयार है।']);
    expect(said[3]).toEqual([]);
    expect(said[4]).toEqual(['टेबल 5 का ऑर्डर तैयार है।']);
  });

  it('puts several tables in one line', () => {
    const said = run([
      [0, []],
      [1_000, [entry('k1', '2'), entry('k2', '5')]],
      [1_000 + MIN, [entry('k1', '2'), entry('k2', '5')]],
    ]);
    expect(said[1]).toEqual(['टेबल 2 और टेबल 5 का ऑर्डर तैयार है।']);
    expect(said[2]).toEqual(['याद दिलाना: टेबल 2 और टेबल 5 का ऑर्डर अभी तक परोसा नहीं गया।']);
  });

  it('stays quiet while muted and does not catch up afterwards', () => {
    const muted = { reminderMs: MIN, muted: true };
    let state = announcerStep(initialAnnouncer(), [], 0, opts).state; // app started with nothing waiting
    let r = announcerStep(state, [entry('k1', '5')], 1_000, muted);
    expect(r.lines).toEqual([]); // ready while muted: not said…
    state = r.state;
    r = announcerStep(state, [entry('k1', '5')], 1_000 + MIN, muted);
    expect(r.lines).toEqual([]); // …nor reminded while muted
    state = r.state;
    r = announcerStep(state, [entry('k1', '5')], 1_000 + MIN + 10_000, opts);
    expect(r.lines).toEqual([]); // mute ended: no burst of old lines
    r = announcerStep(r.state, [entry('k1', '5')], 1_000 + 2 * MIN, opts);
    expect(r.lines).toEqual(['याद दिलाना: टेबल 5 का ऑर्डर अभी तक परोसा नहीं गया।']); // reminders resume on schedule
  });

  it('follows the reminder setting: 30 s, 2 min or off', () => {
    const at = (ms: number, reminderMs: number) => run([[0, []], [1, [entry('k1', '5')]], [1 + ms, [entry('k1', '5')]]], { reminderMs, muted: false })[2];
    expect(at(30_000, 30_000)).toHaveLength(1);
    expect(at(MIN, 2 * MIN)).toEqual([]);
    expect(at(2 * MIN, 2 * MIN)).toHaveLength(1);
    expect(at(10 * MIN, 0)).toEqual([]); // off
  });

  it('"only my tables" keeps the tables assigned to me', () => {
    const list = [entry('k1', '2', { assigned_staff_id: 'me' }), entry('k2', '5', { assigned_staff_id: 'someone' }), entry('k3', '7')];
    expect(visibleEntries(list, { onlyMine: true, myStaffId: 'me' }).map((e) => e.table_label)).toEqual(['2']);
    expect(visibleEntries(list, { onlyMine: false, myStaffId: 'me' })).toHaveLength(3);
    expect(visibleEntries(list, { onlyMine: true, myStaffId: null })).toHaveLength(3);
  });
});
