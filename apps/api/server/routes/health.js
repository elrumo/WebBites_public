import { isDraining } from '../utils/inflight'

// 503 while the process is shutting down (plugins/shutdown.ts), so the load
// balancer takes it out of rotation before it exits.
export default defineEventHandler((event) => {
  if (isDraining()) {
    setResponseStatus(event, 503)
    return { status: 'DRAINING', message: 'Shutting down' }
  }
  return {
    status: 'OK',
    message: 'Nitro backend is running'
  }
})
