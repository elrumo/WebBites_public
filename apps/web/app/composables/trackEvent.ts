// Sends an analytics event if an analytics plugin is installed, otherwise does nothing.
//
// The open-source build has no analytics. The hosted overlay adds @nuxtjs/plausible, whose plugin
// provides `$plausible`; this helper calls the same thing that module's `useTrackEvent` does, so
// there it behaves identically. It is deliberately not named `useTrackEvent`: the module
// auto-imports that name, and two auto-imports of one name clash.
export function trackEvent(name: string, options?: Record<string, any>) {
  if (!import.meta.client) return
  ;(tryUseNuxtApp() as any)?.$plausible?.trackEvent(name, options)
}
