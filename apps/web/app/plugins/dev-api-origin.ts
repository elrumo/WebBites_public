import { setApiOrigin } from '~/utils/devApi'

// The /developers pages show the address of this installation's API, not a hosted one.
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const configured = String(config.public.backendUrl || '')
  // Same-origin deployments (everything behind one domain) leave it as a path on this site.
  setApiOrigin(configured && configured !== '/' ? configured : useRequestURL().origin)
})
