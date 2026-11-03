<template>   
    <UModal
      v-model:open="showWelcomeModal"
      class="auth"
      :ui="{ content: 'max-w-none bg-transparent shadow-none ring-0 border-0' }"
      :dismissible="false"
    >
  <template #content>
        <div
            class="hide-tabs max-h-[90vh] h-[660px] w-[620px] bg-white dark:bg-neutral-900 shadow-xl border border-slate-200 dark:border-neutral-800 rounded-2xl overflow-hidden flex flex-col justify-between relative"
        >
            <div class="right-0 flex justify-center gap-1.5 pt-5">
                <div
                    v-for="(_, index) in wizardTabs.length"
                    :key="index"
                    class="h-1 rounded-full transition-all duration-300 ease-out cursor-pointer"
                    @click="selectTab(index)"
                    :class="[
                    index === activeTab ? 'w-8 bg-primary-500' :
                    index < activeTab ? 'w-4 bg-primary-400 opacity-60' : 'w-4 bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-600 dark:hover:bg-neutral-500 hover:scale-150 transition-all'
                    ]"
                ></div>
            </div>

            <Transition
                :name="transitionName"
            >
                <WizardTab
                    :item="wizardTabs[activeTab]"
                    :key="activeTab"
                    :currentStep="activeTab"
                    :index="activeTab"
                    :totalSteps="wizardTabs.length"
                    @select="selectTab"
                    @next="nextStep"
                    @previous="previousStep"
                    @skip="skipWizard"
                />
            </Transition>

            <div class="flex justify-between w-full px-8 py-6 absolute bottom-0 left-0">
                <UButton
                    variant="ghost"
                    class="opacity-70 hover:opacity-100 transition-opacity"
                    @click="skipWizard"
                >
                    {{ $t('wizard_tab.skip') }}
                </UButton>

                <div class="flex gap-3">
                    <Transition name="shrink">
                        <UButton
                            v-if="activeTab > 0"
                            variant="ghost"
                            @click="previousStep"
                            icon="i-heroicons-arrow-left"
                            class=""
                        >
                            {{ $t('wizard_tab.back') }}
                        </UButton>
                    </Transition>

                    <UButton
                        variant="solid"
                        color="primary"
                        @click="nextStep"
                        :icon="activeTab === wizardTabs.length - 1 ? 'i-heroicons-check' : 'i-heroicons-arrow-right'"
                        class="shadow-sm hover:shadow-md transition-all duration-300"
                    >
                        {{ activeTab === wizardTabs.length - 1 ? $t('wizard_tab.finish') : (activeTab === wizardTabs.length ? $t('wizard_tab.save') : $t('wizard_tab.next')) }}
                    </UButton>
                </div>
            </div>
        </div>
    
  </template>
</UModal>
</template>

<script setup>
import Parse from 'parse';
import { storeToRefs } from 'pinia';
import { useStore } from '~/stores/myStore';

const store = useStore();


const {
  showWelcomeModal,
  isFirstTime,
} = storeToRefs(store)

const previousTab = ref(0)
const activeTab = ref(0)

// Watch activeTab to track navigation direction
watch(activeTab, (newValue, oldValue) => {
  previousTab.value = oldValue
})


const transitionName = computed(() => {
  return activeTab.value > previousTab.value ? 'wizard-slide-in-out' : 'wizard-slide-out-in'
})

function selectTab(index) {
  previousTab.value = activeTab.value // Store current before changing
  activeTab.value = index
}

function nextStep() {
  if (activeTab.value >= wizardTabs.value.length - 1) {
      skipWizard(true)
      return
  }
  previousTab.value = activeTab.value // Store current before changing
  activeTab.value++
}

function previousStep() {
  if (activeTab.value > 0) {
      previousTab.value = activeTab.value // Store current before changing
      activeTab.value--
  }
}

// `thenAsk` is only true for finishing the tour: someone who hit Skip has said
// no to onboarding, so the questionnaire doesn't follow them in.
const skipWizard = async (thenAsk = false) => {
    try {
        const currentUser = Parse.User.current();
        if (!currentUser) return;
        
        // Update local state
        showWelcomeModal.value = false;
        isFirstTime.value = false;
        if (thenAsk === true && !currentUser.get('questionnaire')) store.showQuestionnaireModal = true;

        // Batch update user and userOptions
        const userOptions = currentUser.get('userOptions');
        console.log("userOptions: ", userOptions);

        await Promise.all([
            currentUser.save({ isFirstTime: false }),
            userOptions?.save({ isFirstTime: false })
        ]);
    } catch (error) {
        console.error('Error skipping wizard:', error);
        // Could add error handling/user notification here
    }
}

const { t } = useI18n()
const config = useRuntimeConfig()
const { showAddFeedModal } = storeToRefs(store)

const chromeUrl = "https://chromewebstore.google.com/detail/webbites-browser-extensio/kphdbcjcdhecefloameedhhldchhbela"
// Same rule as ApplePlansCard: no store button until the App Store id is configured.
const appStoreUrl = config.public.appleAppId ? `https://apps.apple.com/app/id${config.public.appleAppId}` : null

const wizardTabs = computed(() => [
  {
      isLogo: true,
      title: t('onboarding_wizard.intro.title'),
      content: t('onboarding_wizard.intro.content'),
      subcontent: t('onboarding_wizard.intro.subcontent'),
  },
  {
      title: t('onboarding_wizard.organised.title'),
      content: t('onboarding_wizard.organised.content'),
      subcontent: t('onboarding_wizard.organised.subcontent'),
      images: ["./wizard/auto-tag.png"]
  },
  {
      title: t('onboarding_wizard.feeds.title'),
      content: t('onboarding_wizard.feeds.content'),
      links: [{ label: t('onboarding_wizard.feeds.add'), icon: 'i-heroicons-rss', action: () => { showAddFeedModal.value = true } }],
      images: ["./wizard/feeds.jpg"],
      imageClass: "wizard-image-shadow",
  },
  {
      title: t('onboarding_wizard.everywhere.title'),
      content: t('onboarding_wizard.everywhere.content'),
      subcontent: t('onboarding_wizard.everywhere.subcontent'),
      links: [
        { label: t('onboarding_wizard.everywhere.chrome'), url: chromeUrl, img: "/icons/chrome.png" },
        appStoreUrl && { label: t('onboarding_wizard.everywhere.apps'), url: appStoreUrl, icon: 'i-fa6-brands-apple' },
        { label: 'Raycast', url: "https://www.raycast.com/elias_ruiz_monserrat/webbites", img: "/icons/raycast.png" },
      ].filter(Boolean),
      images: ["./wizard/first-bookmark1.jpg", "./wizard/first-bookmark2.jpg"],
  },
  {
      title: t('onboarding_wizard.import.title'),
      content: t('onboarding_wizard.import.content'),
      subcontent: t('onboarding_wizard.import.subcontent', {
        link: `<a href="/export-bookmarks" target="_blank">${t('onboarding_wizard.import.this_page')}</a>`,
      }),
      images: ["./wizard/onboarding_import.png"],
      showImportButton: true,
      showBookmarkInput: false,
  },
  {
      title: t('onboarding_wizard.first_bookmark.title'),
      content: t('onboarding_wizard.first_bookmark.content'),
      subcontent: t('onboarding_wizard.first_bookmark.subcontent'),
      showBookmarkInput: true,
  },
])

</script>
