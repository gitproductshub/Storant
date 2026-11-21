/**
 * Account deletion from the public web page. The shared API client always attaches the signed-in session's token,
 * but this page is usually used while signed out, so it calls the endpoint with the token from its own login.
 */
import { ApiError } from '@/api/client';
import { getServerUrl } from '@/store/prefs';
import { t } from '@/i18n';

export async function deleteAccountWithToken(accessToken: string, password: string): Promise<{ success: boolean; business_closed: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
    response = await fetch(`${getServerUrl()}/auth/delete-account`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ password, confirm: 'DELETE' }),
      signal: controller.signal,
    });
  } catch (e: any) {
    const timedOut = e?.name === 'AbortError';
    throw new ApiError(timedOut ? t('public.accountApi.the_server_is_taking_too_long_to_respond') : t('public.accountApi.cannot_reach_the_server_check_your'),
      0, timedOut ? 'TIMEOUT' : 'NETWORK', undefined, true);
  } finally {
    clearTimeout(timer);
  }
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string' ? payload.error.message
      : response.status === 401 ? t('public.accountApi.your_sign_in_expired_please_start_again')
      : response.status === 429 ? t('public.accountApi.too_many_attempts_please_wait_a_few')
      : t('public.accountApi.could_not_delete_the_account_please_try');
    throw new ApiError(message, response.status, payload?.error?.code ?? 'HTTP_ERROR');
  }
  return payload as { success: boolean; business_closed: boolean };
}
