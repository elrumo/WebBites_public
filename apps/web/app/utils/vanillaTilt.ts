import type { Directive } from 'vue'
import VanillaTilt, { type HTMLVanillaTiltElement, type TiltOptions } from 'vanilla-tilt'

function destroyTilt(el: HTMLVanillaTiltElement) {
  el.vanillaTilt?.destroy()
}

function initTilt(el: HTMLVanillaTiltElement, options?: TiltOptions) {
  destroyTilt(el)
  VanillaTilt.init(el, options)
}

export const vTilt: Directive<HTMLElement, TiltOptions | undefined> = {
  mounted(el, binding) {
    initTilt(el as HTMLVanillaTiltElement, binding.value)
  },
  updated(el, binding) {
    if (binding.value !== binding.oldValue) {
      initTilt(el as HTMLVanillaTiltElement, binding.value)
    }
  },
  unmounted(el) {
    destroyTilt(el as HTMLVanillaTiltElement)
  }
}
