import { router } from 'expo-router';
import { confirm } from '@/components/ui';
import { sessionsApi } from '@/api/subscription';
import { useAuth } from '@/store/auth';
import { useOutbox } from '@/store/outbox';
import { useAccess } from '@/store/access';
import { forgetReturnPath } from '@/lib/returnTo';
import { useHomeSnapshot } from '@/store/homeSnapshot';
import { t } from '@/i18n';

/**
 * Sign this device out: revoke the session on the server (best effort — offline or an already-ended session must
 * never block signing out), then clear it locally. Offline bills stay in the outbox for the next sign-in.
 */
export async function endSession(): Promise<void> {
  forgetReturnPath(); // the next person to sign in here starts on their own Home
  const session = useAuth.getState().session;
  // /auth/logout is a business-login route; platform consoles only sign out locally
  if (session && session.accountType === 'business') {
    try {
      await sessionsApi.logout();
    } catch {
      /* offline / already signed out: the local sign-out below is what matters */
    }
  }
  await useAuth.getState().logout();
  useAccess.getState().reset();
  useHomeSnapshot.getState().reset(); // the business's numbers don't stay on a shared device
}

/** Confirm, warn about bills that haven't synced yet, then sign out and return to the login screen. */
export async function signOut(): Promise<void> {
  const tenantId = useAuth.getState().session?.tenantId;
  const pending = useOutbox.getState().queue.filter((q) => !tenantId || q.tenantId === tenantId).length;
  const ok = await confirm({
    title: t('app.signOut.sign_out_title'),
    message: pending
      ? t('app.signOut.pending', { pending })
      : t('app.signOut.sign_back_in'),
    confirmLabel: t('app.signOut.sign_out'),
    danger: pending > 0,
  });
  if (!ok) return;
  await endSession();
  router.replace('/login');
}
