import type { AccessInfo, BusinessType, Role } from '@/api/types';
import { visibleNavItems } from '@/components/nav/navItems';

/** Screens every business login may open, whatever its permissions. */
const ALWAYS_OPEN = ['home', 'settings'];

/** Can this person open `path`? Decided by the same rules as the navigation (the server still checks every call). */
export function canOpenPath(path: string, role: Role | null, businessType: BusinessType | undefined, access: AccessInfo | null): boolean {
  const first = path.split(/[?#]/)[0].split('/')[1] ?? '';
  if (ALWAYS_OPEN.includes(first)) return true;
  return visibleNavItems(role, businessType, access).some((i) => i.route === first);
}

/**
 * Where a business login lands after sign-in or a cold start of the app:
 * 1. the page they asked for before signing in (if their role can open it),
 * 2. the kitchen display, if this device is set to "Start on kitchen display" and they can open it,
 * 3. otherwise their Home.
 */
export function landingPath(opts: {
  role: Role | null; businessType: BusinessType | undefined; access: AccessInfo | null;
  returnTo: string | null; startOnKitchenDisplay: boolean;
}): string {
  const { role, businessType, access, returnTo, startOnKitchenDisplay } = opts;
  if (returnTo && canOpenPath(returnTo, role, businessType, access)) return returnTo;
  if (startOnKitchenDisplay && canOpenPath('/kitchen', role, businessType, access)) return '/kitchen';
  return '/home';
}
