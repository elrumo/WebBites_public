import { defineNuxtPlugin } from '#app'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('external', {
    mounted(el: HTMLAnchorElement) {
      // Only act on anchor elements with http(s), mailto, or tel links
      const isAnchor = el.tagName.toLowerCase() === 'a'
      if (!isAnchor) return

      el.addEventListener('click', async (e: Event) => {
        const href = el.getAttribute('href') || ''
        if (!href) return

        const isExternal = /^(https?:\/\/|mailto:|tel:)/i.test(href)
        if (!isExternal) return

        e.preventDefault()
        try {
          window.open(href, '_blank', 'noopener')
        } catch {
          // Always provide a safe fallback
          window.open(href, '_blank', 'noopener')
        }
      })
    },
  })
})