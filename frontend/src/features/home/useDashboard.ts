/**
 * Home data: the whole dashboard once a minute, the live widgets (tables, kitchen, claims…) on their own every 15–20 s
 * with `?widgets=` (the server caches each widget briefly, so many devices of one shop cost little). Both pause while
 * the screen is hidden. The last good dashboard is kept on the device for an offline start.
 */
import { useEffect, useMemo, useState } from 'react';
import { dashboardApi, type Dashboard } from '@/api/dashboard';
import { useLivePoll } from '@/hooks/live';
import { useAuth } from '@/store/auth';
import { snapshotOwner, useHomeSnapshot } from '@/store/homeSnapshot';
import { FULL_REFRESH_MS, liveKeys, mergeDashboard, pollInterval } from './homeLogic';

export function useDashboard() {
  const tenantId = useAuth((s) => s.session?.tenantId);
  const userId = useAuth((s) => s.session?.userId);
  const owner = snapshotOwner(tenantId, userId);

  const full = useLivePoll(() => dashboardApi.get(), [owner], FULL_REFRESH_MS);
  const keysJoined = liveKeys(full.data).join(',');
  const [liveMs, setLiveMs] = useState(20_000);
  const live = useLivePoll<Dashboard | null>(
    () => (keysJoined ? dashboardApi.get(keysJoined.split(',')) : Promise.resolve(null)), [keysJoined], liveMs);

  useEffect(() => {
    if (!full.data) return;
    const keys = new Set(keysJoined.split(','));
    setLiveMs(pollInterval({ widgets: full.data.widgets.filter((w) => keys.has(w.key)) }));
  }, [full.data, keysJoined]);

  const merged = useMemo(() => mergeDashboard(full.data, full.updatedAt, live.data, live.updatedAt),
    [full.data, full.updatedAt, live.data, live.updatedAt]);

  const snapshot = useHomeSnapshot((s) => (s.owner === owner ? s.data : null));
  const snapshotAt = useHomeSnapshot((s) => (s.owner === owner ? s.at : null));
  const save = useHomeSnapshot((s) => s.save);
  useEffect(() => {
    if (owner && full.data && full.updatedAt) save(owner, full.data, full.updatedAt);
  }, [owner, full.data, full.updatedAt, save]);

  const fromSnapshot = !merged && !!snapshot;
  return {
    data: merged ?? snapshot,
    /** Showing the copy saved on this device (offline start) */
    fromSnapshot,
    error: full.error ?? live.error,
    loading: full.loading && !fromSnapshot,
    refreshing: full.refreshing,
    updatedAt: merged ? Math.max(full.updatedAt ?? 0, live.updatedAt ?? 0) || null : snapshotAt,
    reload: () => { void full.reload(); void live.silentReload(); },
  };
}
