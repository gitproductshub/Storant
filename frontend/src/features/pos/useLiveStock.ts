/**
 * Live stock while billing: GET /catalog/stock every 20 s (only items changed since the last call; paused while the
 * screen is hidden) and right after each bill, so "N left" and sold-out tiles follow other tills and the kitchen.
 */
import { useRef } from 'react';
import { catalogApi } from '@/api/endpoints';
import { useLivePoll } from '@/hooks/live';
import { useData } from '@/store/data';

export const LIVE_STOCK_MS = 20_000;

export function useLiveStock(enabled: boolean) {
  const since = useRef<string | null>(null);
  const poll = useLivePoll(async () => {
    if (!enabled) return null;
    const levels = await catalogApi.stock(since.current);
    useData.getState().applyStock(levels.items);
    since.current = levels.server_time;
    return levels;
  }, [enabled], LIVE_STOCK_MS);
  return { refresh: () => { void poll.silentReload(); } };
}
