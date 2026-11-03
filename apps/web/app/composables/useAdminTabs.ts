/**
 * The tabs on /admin.
 *
 * Kept in a composable (not in the page) so a deployment can add or replace tabs by
 * overriding this one file: the hosted service adds its analytics tabs that way, and the
 * self-hosted edition only ever sees what is listed here.
 */
import { defineAsyncComponent, markRaw, type Component } from 'vue'

export interface AdminTab {
  key: string
  label: string
  icon: string
  /** The component rendered for this tab. */
  component: Component
}

// Imported here rather than looked up by name: a tab added by a deployment brings its own import.
const AdminSettings = defineAsyncComponent(() => import('~/components/admin/Settings.vue'))
const AdminMeilisearchSync = defineAsyncComponent(() => import('~/components/admin/MeilisearchSync.vue'))

export function useAdminTabs(): AdminTab[] {
  return [
    { key: 'settings', label: 'Settings', icon: 'i-heroicons-cog-6-tooth', component: markRaw(AdminSettings) },
    { key: 'search-sync', label: 'Search index', icon: 'i-heroicons-magnifying-glass', component: markRaw(AdminMeilisearchSync) },
  ]
}
