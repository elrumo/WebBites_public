import { DraggablePlugin } from '@braks/revue-draggable';

export default defineNuxtPlugin((nuxtApp) => {
    nuxtApp.vueApp.use(DraggablePlugin)
})