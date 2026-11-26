import { defineEventHandler } from 'h3'
import { appleSignInEnabled, appleWebClientId } from '../../../utils/apple-auth'

defineRouteMeta({
  openAPI: {
    tags: ['Authentication'],
    summary: 'Which sign-in options this server offers',
    description: 'Public and non-secret: the sign-in page reads it to decide whether to show "Continue with Apple". `clientId` is the Services ID the button signs in with.',
    responses: { 200: { description: '`{ apple: { enabled, clientId } }`' } },
  },
})

export default defineEventHandler((event) => {
  // Read on every call: the admin page can change it while the server runs.
  event.node.res.setHeader('Cache-Control', 'no-store')
  return { apple: { enabled: appleSignInEnabled(), clientId: appleWebClientId() } }
})
