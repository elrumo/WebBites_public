import { log } from '../../utils/useDevLog'

export default defineEventHandler(async (event) => {
  const { token, username, password } = await readBody(event);

  log('[passwordReset] token: ', token ? '\u2713 present' : '\u2717 missing');
  log('[passwordReset] username: ', username);

  if (!token || !password) {
    throw new Error('Invalid reset link. Please request a new password reset.');
  }

  try{
    // Parse needs only the token and the new password; a username is passed along when the link had one.
    const form = new URLSearchParams({
      new_password: password,
      'utf-8': '✓',
      token,
      ...(username ? { username } : {})
    })

    // Parse Server's own "choose a new password" endpoint: the link in the reset email
    // lands on the web app's /passwordReset page, which posts the new password here.
    const config = useRuntimeConfig()
    const parseUrl = parseBaseUrl()
    const appId = config.public.parseAppId
    if (!parseUrl || !appId) throw new Error('Parse is not configured')

    // Parse answers a form post with a redirect: to the success page, or back to the reset
    // page with `error=` in the query. Read the redirect instead of following it.
    const response = await fetch(`${parseUrl}/apps/${appId}/request_password_reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual'
    })

    const location = response.headers.get('location')
    const error = location ? new URL(location, parseUrl).searchParams.get('error') : null

    if (error) throw new Error('Password reset error: ' + error)
    if (response.status >= 400) throw new Error(`Password reset failed (${response.status})`)

    console.log('Password reset successful')
    
    return { success: true }
  } catch (error) {
    console.error('Password reset error:', error);
    throw new Error('Password reset error: ' + error);
  }

})