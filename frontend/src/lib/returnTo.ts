/**
 * "Return to the page I asked for": when a signed-out person opens a deep link (e.g. /reports or /pos?table=…), the app
 * remembers it, sends them to sign in, then takes them there instead of Home (if their role can open it, see
 * features/home/landing.ts). Kept in memory and, on web, in sessionStorage (this tab only, gone when it closes).
 *
 * Signing out on purpose forgets it, so the next person to sign in on this device starts on their own Home.
 */
const KEY = 'tallyko.returnTo';

let pending: string | null = null;
let suppressed = false;
/** The last path handed out: the landing page may render more than once while it redirects. */
let taken: { path: string | null; at: number } | null = null;
const TAKEN_GRACE_MS = 3000;

function session(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Only in-app paths: no other sites, no sign-in pages, nothing that is the landing page already. */
export function isReturnable(path: string | null | undefined): path is string {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.includes('://') || path.includes('\\')) return false;
  const first = path.split(/[?#]/)[0].split('/')[1] ?? '';
  return !['', 'home', 'login', 'signup', 'more', 'index'].includes(first);
}

export function rememberReturnPath(path: string | null | undefined): void {
  if (suppressed || !isReturnable(path)) return;
  pending = path;
  try { session()?.setItem(KEY, path); } catch { /* storage unavailable: memory only */ }
}

/** The remembered path (once; repeated calls in the next few seconds get the same answer), and the end of any sign-out suppression. */
export function takeReturnPath(now = Date.now()): string | null {
  let path = pending;
  if (!path) {
    try { path = session()?.getItem(KEY) ?? null; } catch { path = null; }
  }
  if (!path && taken && now - taken.at < TAKEN_GRACE_MS) return taken.path;
  pending = null;
  suppressed = false;
  try { session()?.removeItem(KEY); } catch { /* ignore */ }
  const result = isReturnable(path) ? path : null;
  taken = { path: result, at: now };
  return result;
}

/** Called when someone signs out on purpose: forget the page and ignore the redirect that follows. */
export function forgetReturnPath(): void {
  pending = null;
  taken = null;
  suppressed = true;
  try { session()?.removeItem(KEY); } catch { /* ignore */ }
}
