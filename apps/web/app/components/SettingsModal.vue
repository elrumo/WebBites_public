<template>
    <UModal
      v-model:open="showSettingsModal"
      :fullscreen="isCompact"
      :ui="{ content: 'sm:max-w-3xl w-full' }"
    >
      <template #content>
        <!-- Delete account confirmation (kept as nested modal) -->
        <UModal
          v-model:open="deleteAccountModal"
          :title="$t('settings.delete_account.title')"
          :description="$t('settings.delete_account.confirmation_text')"
          :ui="{ content: 'sm:max-w-md', body: 'flex flex-col gap-4', footer: 'justify-end gap-2' }"
        >
          <template #body>
            <!-- Whose account goes, so nobody signed into the wrong one deletes it -->
            <div class="settings-card !flex-row items-center !gap-3 !px-4 !py-3">
              <UIcon name="i-heroicons-user-circle" class="text-xl opacity-60 shrink-0" />
              <span class="settings-row-title truncate">{{ userInfo.email || currentUser?.email }}</span>
            </div>

            <form @submit.prevent="deleteAccount">
              <UFormField :label="$t('settings.delete_account.type_confirmation')">
                <UInput
                  v-model="deleteAccountValidation"
                  :placeholder="$t('settings.delete_account.placeholder')"
                  :disabled="loadingDeleteAccount"
                  autocomplete="off"
                  autofocus
                  color="error"
                  class="w-full"
                />
              </UFormField>
            </form>
          </template>

          <template #footer>
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="loadingDeleteAccount"
              @click="deleteAccountModal = false"
            >
              {{ $t('common.cancel') }}
            </UButton>
            <UButton
              color="error"
              icon="i-heroicons-trash"
              :disabled="!canDeleteAccount"
              :loading="loadingDeleteAccount"
              @click="deleteAccount"
            >
              {{ $t('settings.delete_account.confirm_button') }}
            </UButton>
          </template>
        </UModal>

        <!-- macOS-style settings shell -->
        <div class="settings-shell">
            <div v-if="settingsLoader" class="absolute inset-0 z-20 bg-black/5 dark:bg-black/20" />

            <!-- Sidebar (wide screens): the pane list sits beside the content -->
            <aside v-if="!isCompact" class="settings-sidebar">
                <UTabs
                    v-model="activeSection"
                    :items="sections"
                    :content="false"
                    orientation="vertical"
                    color="neutral"
                    value-key="id"
                    :ui="{
                        list: 'bg-transparent gap-0.5 w-full',
                        indicator: 'bg-white dark:bg-neutral-700/80 shadow-sm rounded-lg',
                        trigger: 'justify-start w-full px-2.5 py-1.5 gap-2.5 text-sm font-medium data-[state=inactive]:text-neutral-700 dark:data-[state=inactive]:text-neutral-300 data-[state=active]:text-neutral-900 dark:data-[state=active]:text-white',
                        leadingIcon: 'text-lg shrink-0'
                    }"
                />
            </aside>

            <!-- Section list (phones): there is no room for a sidebar beside the
                 content, so the panes are reached one at a time, the way a
                 phone's own settings app does it. -->
            <nav v-else-if="showSectionList" class="settings-mobile-pane">
                <header class="settings-mobile-bar">
                    <h2 class="settings-mobile-title">{{ $t('settings.title') }}</h2>

                    <UButton
                        icon="i-heroicons-x-mark"
                        color="neutral"
                        variant="ghost"
                        size="md"
                        square
                        :aria-label="$t('common.close')"
                        @click="showSettingsModal = false"
                    />
                </header>

                <div class="settings-scroll">
                    <div class="settings-card !p-0 !gap-0">
                        <template v-for="(section, index) in sections" :key="section.id">
                            <div v-if="index > 0" class="settings-divider" />

                            <button
                                type="button"
                                class="settings-row settings-row--button"
                                @click="openSection(section.id)"
                            >
                                <span class="flex flex-row items-center gap-3 min-w-0">
                                    <UIcon :name="section.icon" class="text-xl opacity-60 shrink-0" />
                                    <span class="settings-row-title truncate">{{ section.label }}</span>
                                </span>
                                <UIcon name="i-heroicons-chevron-right" class="text-lg opacity-40 shrink-0" />
                            </button>
                        </template>
                    </div>
                </div>
            </nav>

            <!-- Content pane -->
            <section v-if="!isCompact || !showSectionList" class="settings-content">
                <!-- Phones get a navigation bar: back to the list on the left,
                     close on the right. Wide screens only need the close. -->
                <header v-if="isCompact" class="settings-mobile-bar">
                    <UButton
                        icon="i-heroicons-chevron-left"
                        :label="$t('settings.title')"
                        color="neutral"
                        variant="ghost"
                        size="md"
                        class="-ms-2"
                        @click="showSectionList = true"
                    />

                    <UButton
                        icon="i-heroicons-x-mark"
                        color="neutral"
                        variant="ghost"
                        size="md"
                        square
                        :aria-label="$t('common.close')"
                        @click="showSettingsModal = false"
                    />
                </header>

                <UButton
                    v-else
                    icon="i-heroicons-x-mark"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="settings-close"
                    @click="showSettingsModal = false"
                />

                <div class="settings-scroll">
                <Transition :name="transitionName" mode="out-in">
                <div :key="activeSection" class="flex flex-col gap-4">
                <!-- Account -->
                <template v-if="activeSection === 'account'">
                    <header class="settings-pane-header">
                        <h2 class="settings-pane-title">{{ $t('settings.personal_info.title') }}</h2>
                    </header>

                    <div class="settings-card">
                        <UFormField :label="$t('settings.personal_info.username')">
                            <UInput
                                name="username"
                                v-model="userInfo.username"
                                :placeholder="userInfo.username"
                                variant="outline"
                                @change="saveUserDetails('username')"
                                size="sm"
                                color="neutral"
                                class="w-full"
                            />
                        </UFormField>

                        <div class="settings-divider" />

                        <SettingsEmailChange />
                    </div>

                    <div class="settings-card !p-0 !gap-0">
                        <div class="settings-row settings-row--stack">
                            <div class="flex flex-col">
                                <span class="settings-row-title">{{ $t('settings.language') }}</span>
                            </div>
                            <!-- Shows the language the app is actually in, which the
                                 browser or the language cookie may have picked
                                 rather than the saved option. -->
                            <USelect
                                :model-value="locale"
                                :items="availableLocales"
                                @update:model-value="changeLanguage"
                                size="sm"
                                color="neutral"
                                class="w-full sm:w-auto sm:min-w-40"
                                :ui="{ base: 'rounded-lg' }"
                            />
                        </div>

                        <div class="settings-divider" />

                        <div class="settings-row settings-row--stack">
                            <div class="flex flex-col">
                                <span class="settings-row-title">{{ $t('settings.ai_language') }}</span>
                                <span class="settings-row-subtitle">{{ $t('settings.ai_language_description') }}</span>
                            </div>
                            <USelect
                                v-model="userOptions.aiLanguage"
                                :items="aiLanguageOptions"
                                @update:model-value="saveUserOptions('aiLanguage')"
                                size="sm"
                                color="neutral"
                                class="w-full sm:w-auto sm:min-w-40"
                                :ui="{ base: 'rounded-lg' }"
                            />
                        </div>
                    </div>

                    <div class="settings-card !p-0">
                        <button type="button" class="settings-row settings-row--button" @click="handleLogout">
                            <span class="settings-row-title">{{ $t('auth.logout') }}</span>
                            <UIcon name="i-heroicons-arrow-right-on-rectangle" class="text-lg opacity-60" />
                        </button>
                    </div>

                    <!-- Kept apart from logout, and toned down, so it is never
                         the row hit on the way to logging out. -->
                    <div class="settings-card !p-0">
                        <button
                            type="button"
                            class="settings-row settings-row--button settings-row--muted"
                            @click="deleteAccountModal = true"
                        >
                            <span class="settings-row-title">{{ $t('settings.delete_account.title') }}</span>
                            <UIcon name="i-heroicons-trash" class="text-lg text-red-500" />
                        </button>
                    </div>
                </template>

                <!-- Plan & Usage -->
                <template v-else-if="activeSection === 'plan'">
                    <header class="settings-pane-header">
                        <h2 class="settings-pane-title">{{ $t('upgrade_modal.plan_details') }}</h2>
                        <p class="settings-pane-subtitle">
                            {{ $t('upgrade_modal.current_plan', { plan: userPlan.name }) }}
                        </p>
                    </header>

                    <div class="settings-card !p-0">
                        <div class="settings-row settings-row--stack">
                            <div class="flex flex-col">
                                <span class="settings-row-title">{{ $t('upgrade_modal.current_plan', { plan: userPlan.name }) }}</span>
                            </div>
                            <div class="flex flex-row flex-wrap gap-2 items-center">
                                <!-- Plus is the only paid plan, so there is nothing to upgrade a paying user to. -->
                                <UButton
                                    v-if="!userPlan.isPaid"
                                    size="xs"
                                    variant="soft"
                                    color="primary"
                                    @click="showSettingsModal = false; showUpgradeModal = true"
                                >
                                    {{ $t('common.upgrade') }}
                                </UButton>
                                <UButton
                                    size="xs"
                                    variant="soft"
                                    color="neutral"
                                    :loading="loadingStripePortal"
                                    @click="openPortalSession"
                                >
                                    {{ $t('upgrade_modal.manage_plan') }}
                                </UButton>
                            </div>
                        </div>
                    </div>

                    <UsageCards />

                    <div
                        v-if="usageLeft.audio <= 0 || usageLeft.bookmarks <= 0"
                        class="well-red well-sm flex flex-row gap-1 items-center cursor-pointer"
                        @click="showSettingsModal = false; showUpgradeModal = true"
                    >
                        <UIcon class="text-lg" name="i-heroicons-information-circle" />
                        {{
                            usageLeft.audio <= 0 ?
                            $t('upgrade_modal.audios_upgrade') :
                            $t('upgrade_modal.bookmarks_upgrade')
                        }}
                    </div>
                </template>

                <!-- Data & Import -->
                <template v-else-if="activeSection === 'data'">
                    <header class="settings-pane-header">
                        <h2 class="settings-pane-title">{{ $t('settings.other_options.title') }}</h2>
                    </header>

                    <div class="settings-card !p-0 !gap-0">
                        <button
                            type="button"
                            class="settings-row settings-row--button"
                            @click="showSettingsModal = false; showImportStatusModal = true"
                        >
                            <span class="settings-row-title">{{ $t('settings_modal.view_import_status') }}</span>
                            <UIcon name="i-heroicons-arrow-path" class="text-lg opacity-60" />
                        </button>

                        <div class="settings-divider" />

                        <label
                            for="importBookmarks"
                            class="settings-row settings-row--button cursor-pointer"
                            @click="store.clickId('importBookmarks')"
                        >
                            <span class="settings-row-title">{{ $t('bookmarks.import') }}</span>
                            <input
                                @change="store.importBookmarksFile()"
                                id="importBookmarks"
                                type="file"
                                class="hidden absolute"
                                accept=".json,.txt,.html, .csv"
                            >
                            <UIcon name="i-heroicons-arrow-up-tray" class="text-lg opacity-60" />
                        </label>

                        <div class="settings-divider" />

                        <button
                            type="button"
                            class="settings-row settings-row--button"
                            @click="exportBookmarks()"
                        >
                            <span class="settings-row-title">{{ $t('settings.other_options.export_bookmarks') }}</span>
                            <UIcon
                                v-if="!isExportingBookmarksLoading"
                                name="i-heroicons-arrow-down-tray"
                                class="text-lg opacity-60"
                            />
                            <UIcon v-else name="i-heroicons-arrow-path" class="text-lg opacity-60 animate-spin" />
                        </button>

                        <div class="settings-divider" />

                        <button
                            type="button"
                            class="settings-row settings-row--button"
                            @click="showSettingsModal = false; showWelcomeModal = !showWelcomeModal"
                        >
                            <span class="settings-row-title">{{ $t('settings.other_options.show_onboarding') }}</span>
                            <UIcon name="i-heroicons-sparkles" class="text-lg opacity-60" />
                        </button>
                    </div>
                </template>

                <!-- About / Extensions -->
                <template v-else-if="activeSection === 'about'">
                    <header class="settings-pane-header">
                        <h2 class="settings-pane-title">{{ $t('settings_modal.extensions_title') }}</h2>
                        <p class="settings-pane-subtitle">
                            {{ $t('settings_modal.extensions_subtitle') }}
                        </p>
                    </header>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <a v-external
                            class="settings-extension-card"
                            target="_blank"
                            href="https://chromewebstore.google.com/detail/webbites-browser-extensio/kphdbcjcdhecefloameedhhldchhbela?authuser=1&hl=en-GB"
                        >
                            <img src="/icons/chrome.png" :alt="$t('settings_modal.chrome_icon_alt')" class="w-10 h-10 rounded-lg" />
                            <span class="text-sm font-semibold opacity-80">Chrome</span>
                        </a>

                        <a v-external
                            class="settings-extension-card"
                            target="_blank"
                            href="https://www.raycast.com/elias_ruiz_monserrat/webbites"
                        >
                            <img src="/icons/raycast.png" :alt="$t('settings_modal.raycast_icon_alt')" class="w-10 h-10 rounded-lg" />
                            <span class="text-sm font-semibold opacity-80">Raycast</span>
                        </a>
                    </div>
                </template>

                <!-- Automations -->
                <template v-else-if="activeSection === 'automations'">
                    <header class="settings-pane-header">
                        <h2 class="settings-pane-title">{{ $t('settings_modal.automations_title') }}</h2>
                        <p class="settings-pane-subtitle">{{ $t('settings_modal.automations_subtitle') }}</p>
                    </header>

                    <SettingsAutomations />
                </template>

                <!-- Backups -->
                <template v-else-if="activeSection === 'backups'">
                    <header class="settings-pane-header">
                        <h2 class="settings-pane-title">{{ $t('settings.backups.title') }}</h2>
                        <p class="settings-pane-subtitle">{{ $t('settings.backups.description') }}</p>
                    </header>

                    <SettingsBackups />
                </template>

                <!-- AI assistants -->
                <template v-else-if="activeSection === 'assistants'">
                    <header class="settings-pane-header">
                        <h2 class="settings-pane-title">{{ $t('settings.assistants.title') }}</h2>
                        <p class="settings-pane-subtitle">{{ $t('settings.assistants.description') }}</p>
                    </header>

                    <SettingsAssistants />
                </template>

                <!-- Developer -->
                <template v-else-if="activeSection === 'developer'">
                    <header class="settings-pane-header">
                        <h2 class="settings-pane-title">{{ $t('settings.developer.title') }}</h2>
                        <p class="settings-pane-subtitle">{{ $t('settings.developer.description') }}</p>
                    </header>

                    <UButton
                        color="neutral"
                        icon="i-heroicons-code-bracket"
                        class="w-fit"
                        @click="goToDevelopers"
                    >
                        {{ $t('settings.developer.button') }}
                    </UButton>
                </template>
                </div>
                </Transition>
                </div>
            </section>
        </div>
      </template>
    </UModal>
</template>

<script setup>
import Parse from 'parse';
import { ref, computed } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { useStore } from '~/stores/myStore';

const { locale, locales, setLocale, finalizePendingLocaleChange, switchLocalePath } = useI18n()
import { useI18n } from 'vue-i18n';
const { t } = useI18n();

const store = useStore();

const {
  saveUserDetails,
  saveUserOptions,
  exportBookmarks
} = store

const {
  showSettingsModal,
  showImportBookmarksModal,
  userInfo,
  showWelcomeModal,
  settingsLoader,
  userOptions,
  userPlan,
  usageLeft,
  isLoggedIn,
  currentUser,
  showUpgradeModal,
  billingEnabled,
  showImportStatusModal,
  isExportingBookmarksLoading
} = storeToRefs(store);

const deleteAccountModal = ref(false);
const deleteAccountValidation = ref('');
const loadingDeleteAccount = ref(false);
const loadingStripePortal = ref(false);

// Forgiving about case and stray spaces: the phrase is there to make the
// deletion deliberate, not to be a typing test.
const canDeleteAccount = computed(() =>
  deleteAccountValidation.value.trim().toLowerCase() ===
    t('settings.delete_account.placeholder').toLowerCase()
);

// A half-typed confirmation shouldn't still be there the next time it opens.
watch(deleteAccountModal, (open) => {
  if (!open) deleteAccountValidation.value = '';
});

const activeSection = ref('account');

// Below Tailwind's `sm` breakpoint the sidebar and the content pane cannot
// share the width, so the modal turns into a single column: a list of sections
// that pushes the chosen pane into view, with a back button to return.
const isCompact = useMediaQuery('(max-width: 639px)');
const showSectionList = ref(true);

const openSection = (id) => {
  activeSection.value = id;
  showSectionList.value = false;
};

const sections = computed(() => [
  { id: 'account', label: t('settings.personal_info.title'), icon: 'i-heroicons-user-circle' },
  // Plans and usage only exist on a deployment that bills.
  ...(billingEnabled.value ? [{ id: 'plan', label: t('upgrade_modal.plan_details'), icon: 'i-heroicons-credit-card' }] : []),
  { id: 'data', label: t('settings.other_options.title'), icon: 'i-heroicons-circle-stack' },
  { id: 'automations', label: t('settings_modal.automations_title'), icon: 'i-heroicons-bolt' },
  { id: 'backups', label: t('settings.backups.title'), icon: 'i-heroicons-cloud-arrow-up' },
  { id: 'about', label: t('settings_modal.extensions_label'), icon: 'i-heroicons-puzzle-piece' },
  { id: 'assistants', label: t('settings.assistants.title'), icon: 'i-heroicons-sparkles' },
  { id: 'developer', label: t('settings.developer.title'), icon: 'i-heroicons-code-bracket' },
]);

// Direction of the tab change: 'down' when moving to a lower tab, 'up' when moving higher.
const transitionName = ref('settings-slide-down');

watch(activeSection, (next, prev) => {
  const ids = sections.value.map(s => s.id);
  const nextIndex = ids.indexOf(next);
  const prevIndex = ids.indexOf(prev);
  transitionName.value = nextIndex >= prevIndex ? 'settings-slide-down' : 'settings-slide-up';
});

watch(showSettingsModal, (val, oldVal) => {
  if(val){
    // Every opening starts at the section list on a phone; on wider screens the
    // flag is unused because the sidebar is always there.
    showSectionList.value = true;
    // A board's "Edit as automation" opens straight onto its rule.
    if (store.automationToEdit) openSection('automations');
    const url = new URL(window.location.href);
    url.searchParams.set('settings', true);
    window.history.pushState({}, '', url);
  } else{
    const url = new URL(window.location.href);
    url.searchParams.delete('settings');
    window.history.pushState({}, '', url);
  }
})

onMounted(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  if(currentUser.value === null) currentUser.value = Parse.User?.current?.() ?? null;
  if (urlParams.get('settings') === 'true') showSettingsModal.value = true;
  if (urlParams.get('importModal') === 'true' || urlParams.get('importConnect')) showImportBookmarksModal.value = true;
  // Back from connecting Google Drive or Dropbox; AppModals opened the modal.
  if (urlParams.get('backupConnect')) openSection('backups');
})

const goToDevelopers = () => {
  showSettingsModal.value = false;
  navigateTo('/developers');
};

const handleLogout = () => {
    store.logout();
    showSettingsModal.value = false;
    isLoggedIn.value = false;
    currentUser.value = null;
};

  const deleteAccount = async () => {
    // Enter in the confirmation field submits too, so check again here.
    if (!canDeleteAccount.value || loadingDeleteAccount.value) return;

    try {
        loadingDeleteAccount.value = true;
        const user = Parse.User?.current?.();
        if (!user) {
          throw new Error('No authenticated user found');
        }

        store.showAlert({
            type: 'success',
            message: t('settings_modal.deleting_account')
        });

        // Deleted through Parse with the user's own session token, exactly as
        // the apps do. The old `/api/deleteAccount` route took a raw userId with
        // no authentication at all — it destroyed whichever account it was
        // handed — and the ownership check was this line of client code.
        // Parse's beforeDelete hook is what erases the bookmarks, files and
        // subscription behind it, and it throws rather than half-delete.
        await user.destroy();

        store.showAlert({
            type: 'success',
            message: t('settings_modal.account_deleted')
        });
        deleteAccountModal.value = false;
        handleLogout();
    } catch (error) {
        console.error('Error deleting account:', error);
        store.showAlert({
            type: 'error',
            message: t('settings_modal.delete_account_failed')
        });
    } finally {
        loadingDeleteAccount.value = false;
    }
};

const changeLanguage = async (newLocale) => {
  try {
    if (process.client) {
      window.addEventListener('beforeunload', (e) => {
        e.preventDefault();
        e.returnValue = '';
      }, { once: true });
    }

    // Set the new locale
    await setLocale(newLocale);

    // Re-read the canonical lists now that the locale has switched, rather than
    // re-declaring them here. The copy that used to live inline had already drifted —
    // it gave `website` the value 'default', dropped `article` entirely and used a
    // different movie icon — so changing the language quietly broke the type filters.
    const { bookmarkTypes, typeOptions } = useStoreConstants();

    // Force store to refresh translations
    store.$patch((state) => {
      state.userOptions.language = newLocale;

      state.bookmarkTypes = bookmarkTypes;
      state.typeOptions = typeOptions;
      state.viewingOptions = [
        { id: 'Grid', label: t('settings.grid_view') },
        { id: 'Compact', label: t('settings.compact_view') },
        { id: 'List', label: t('settings.list_view') },
      ]
      state.imageRatioOptions = [
        { id: 'original', label: t('settings.image_ratio.original') },
        { id: '4-3', label: '4/3' },
        { id: '16-9', label: '16/9' },
      ]
      state.displayMode = { id: 'grid', label: t('settings.grid_view'), isMount: true }
      state.imageRatio = { id: 'original', label: t('settings.image_ratio.original'), isMount: true }

      // Plan copy is no longer duplicated here. The catalogue comes from
      // `GET /v1/plans` (via `fetchPlans`) and its marketing bullets are
      // translated at render time from `plans.features.<tier>.<id>`, so a
      // language switch needs nothing beyond the locale change. The table that
      // used to live here had drifted into its own pricing: plan ids of
      // 'premium', prices as strings, and Stripe payment links that predate
      // checkout sessions.
    });

    // Show success message
    store.showAlert({
      type: 'success',
      message: t('common.language_changed_success')
    });
  } catch (error) {
    console.error('Error changing language:', error);
  }
};

// Computed props
const availableLocales = computed(() => {
  return locales.value.map(locale => {
    return {
      label: locale.label,
      value: locale.code
    };
  })
})
// The AI writes in one of the app's languages, or simply follows whatever the
// saved page is written in.
const aiLanguageOptions = computed(() => [
  { label: t('settings.ai_language_same'), value: 'same' },
  ...availableLocales.value
]);

// Add this function in the <script setup> section
const openPortalSession = async () => {
  try {
    // TODO: Stripe event hook for when the user cancels their subscription.
    loadingStripePortal.value = true;
    const response = await $fetch('/api/create-portal-session', { method: 'post' });
    if (response.url) {
      window.open(response.url, '_blank');
    }
    loadingStripePortal.value = false;
  } catch (error) {
    console.error('Error opening portal session:', error.message || error);
    store.showAlert({
      type: 'error',
      message: error.message
      // message: t('common.error_try_again')
    });
    loadingStripePortal.value = false;

  }
};
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

/* macOS-style two-pane settings layout, collapsing to a single column on phones */
.settings-shell {
    @apply relative flex w-full h-[100dvh] sm:h-[600px] sm:max-h-[82vh] overflow-hidden;
}

/* Sidebar */
.settings-sidebar {
    @apply
        shrink-0 w-56
        flex flex-col gap-2
        px-3 py-4
        border-r border-neutral-200 dark:border-neutral-700/70
        bg-neutral-100/60 dark:bg-neutral-800/40
        overflow-y-auto;
}

.settings-sidebar-title {
    @apply px-2 mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500;
}

/* Directional tab-switch animation for the content pane */
.settings-slide-down-enter-active,
.settings-slide-down-leave-active,
.settings-slide-up-enter-active,
.settings-slide-up-leave-active {
    transition: opacity 180ms ease, transform 180ms ease;
}

/* Moving to a lower tab: new pane rises from below, old exits upward */
.settings-slide-down-enter-from {
    opacity: 0;
    transform: translateY(14px);
}

.settings-slide-down-leave-to {
    opacity: 0;
    transform: translateY(-14px);
}

/* Moving to a higher tab: new pane drops from above, old exits downward */
.settings-slide-up-enter-from {
    opacity: 0;
    transform: translateY(-14px);
}

.settings-slide-up-leave-to {
    opacity: 0;
    transform: translateY(14px);
}

/* Content pane. The pane itself doesn't scroll: it holds the phone's fixed
   navigation bar above `.settings-scroll`, which is what actually scrolls. */
.settings-content {
    @apply
        relative flex-1 min-w-0
        flex flex-col
        overflow-hidden;
}

/* Single-column section list shown instead of the sidebar on phones */
.settings-mobile-pane {
    @apply relative flex flex-col w-full min-w-0 overflow-hidden;
}

/* Phone navigation bar: title or back button on one side, close on the other */
.settings-mobile-bar {
    @apply
        shrink-0
        flex flex-row items-center justify-between gap-2
        px-4 py-2.5
        border-b border-neutral-200 dark:border-neutral-700/70;

    /* The modal is full-bleed on a phone, so keep the bar clear of the notch. */
    padding-top: calc(0.625rem + env(safe-area-inset-top));
}

.settings-mobile-title {
    @apply text-xl font-bold text-neutral-900 dark:text-white m-0;
}

.settings-scroll {
    @apply
        flex-1 min-w-0
        flex flex-col gap-4
        px-4 pt-4 pb-6
        sm:px-7 sm:py-6
        overflow-y-auto;
}

/* Keep the last row clear of the home indicator */
@media (max-width: 639px) {
    .settings-scroll {
        padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));
    }
}

.settings-close {
    @apply absolute top-3 right-3 z-10;
}

.settings-pane-header {
    @apply flex flex-col gap-0.5 mb-1 pr-0 sm:pr-8;
}

.settings-pane-title {
    @apply text-xl sm:text-2xl font-bold text-neutral-900 dark:text-white m-0;
}

.settings-pane-subtitle {
    @apply text-sm text-neutral-500 dark:text-neutral-400 m-0;
}

/* Grouped rows card (macOS inset list) */
.settings-card {
    @apply
        flex flex-col gap-4
        p-4
        rounded-xl
        bg-white dark:bg-neutral-800
        border border-neutral-200 dark:border-neutral-700/70;
}

.settings-row {
    @apply flex flex-row items-center justify-between gap-3 px-4 py-3 text-left;
}

/* Rows whose control is too wide to sit beside its label on a phone */
.settings-row--stack {
    @apply flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3;
}

.settings-row--button {
    @apply w-full transition-colors duration-150 hover:bg-neutral-100/70 dark:hover:bg-neutral-700/40 first:rounded-t-xl last:rounded-b-xl;
}

/* A row that has to be there but shouldn't draw the eye */
.settings-row--muted {
    @apply opacity-70 hover:opacity-100 focus-visible:opacity-100;
    transition-property: color, background-color, opacity;
}

.settings-row-title {
    @apply text-sm font-medium text-neutral-800 dark:text-neutral-100;
}

.settings-row-subtitle {
    @apply text-xs text-neutral-500 dark:text-neutral-400 max-w-full sm:max-w-56;
}

.settings-divider {
    @apply h-px bg-neutral-200 dark:bg-neutral-700/70 mx-4;
}

/* Extension cards */
.settings-extension-card {
    @apply
        flex flex-row items-center gap-3
        px-4 py-3
        rounded-xl
        bg-white dark:bg-neutral-800
        border border-neutral-200 dark:border-neutral-700/70
        shadow-sm
        transition-all duration-200
        hover:shadow-md hover:-translate-y-0.5 cursor-pointer;
}
</style>
