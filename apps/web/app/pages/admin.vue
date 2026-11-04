<template>
  <div class="admin-page">
    <LandingNavBar :isLandingPage="false" />

    <div class="admin-page-body" v-if="isAdmin">
      <div class="w-full max-w-[90vw] mx-auto">
        <UTabs
          :items="tabs"
          value-key="key"
          v-model="activeTab"
          :ui="{
            root: 'flex flex-col items-center justify-center p-4 rounded-2xl',
            list: 'w-fit'
          }"
          class="w-full bg-white dark:bg-neutral-800 border border-gray-100 dark:border-neutral-700 p-4 gap-4 shadow-md"
        >
          <template #content="{ item }">
            <div class="w-full rounded-2xl">
              <component :is="item.component" />
            </div>
          </template>
        </UTabs>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import LandingNavBar from '~/components/LandingNavBar.vue'

definePageMeta({
  middleware: 'auth'
})

const store = useStore()
const { checkIfAdmin } = store
const { isAdmin } = storeToRefs(store)

const tabs = useAdminTabs()
const activeTab = ref(tabs[0]?.key)

onMounted(async () => {
  // Only the administrator sees this page; the API re-checks on every request.
  if (!(await checkIfAdmin())) {
    navigateTo({ name: 'index' })
  }
})
</script>
