import { Redirect, type Href } from 'expo-router';
import { useAuth } from '@/store/auth';
import { useAccessInfo } from '@/store/access';
import { useData } from '@/store/data';
import { usePrefs } from '@/store/prefs';
import { takeReturnPath } from '@/lib/returnTo';
import { landingPath } from '@/features/home/landing';

/** "/" — the PWA start_url, the offline fallback and where sign-in leads: every business login lands on Home. */
export default function Index() {
  const status = useAuth((s) => s.status);
  const session = useAuth((s) => s.session);
  const access = useAccessInfo();
  const businessType = useData((s) => s.settings?.business_type);
  const startOnKitchenDisplay = usePrefs((s) => s.startOnKitchenDisplay);
  if (status !== 'signedIn' || !session) return <Redirect href="/login" />;
  if (session.accountType === 'platform') return <Redirect href="/admin" />;
  const href = landingPath({ role: session.role, businessType, access, returnTo: takeReturnPath(), startOnKitchenDisplay });
  return <Redirect href={href as Href} />;
}
