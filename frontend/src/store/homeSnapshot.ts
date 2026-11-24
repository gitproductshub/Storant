/**
 * The last Home dashboard this device received, so Home still shows something useful when the app starts offline
 * ("Offline · showing 10:42"). One snapshot per device, tied to the login that loaded it: another person never sees it,
 * and signing out clears it (lib/signOut.ts).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Dashboard } from '@/api/dashboard';
import { persistStorage } from '@/lib/storage';

interface HomeSnapshotState {
  /** `${tenantId}:${userId}` of the login the snapshot belongs to */
  owner: string | null;
  data: Dashboard | null;
  at: number | null;
  save: (owner: string, data: Dashboard, at?: number) => void;
  reset: () => void;
}

export const useHomeSnapshot = create<HomeSnapshotState>()(
  persist(
    (set) => ({
      owner: null,
      data: null,
      at: null,
      save: (owner, data, at = Date.now()) => set({ owner, data, at }),
      reset: () => set({ owner: null, data: null, at: null }),
    }),
    { name: 'tallyko.home', storage: persistStorage, version: 1 },
  ),
);

export function snapshotOwner(tenantId: string | null | undefined, userId: string | null | undefined): string | null {
  return tenantId && userId ? `${tenantId}:${userId}` : null;
}
