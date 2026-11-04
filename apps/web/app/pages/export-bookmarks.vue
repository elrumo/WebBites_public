<template>
    <LandingNavBar
        :showShadow="showShadow"
        :isLandingPage="false"
    />

    <div class="export-bookmarks-page">
        <h1 class="text-3xl md:text-4xl font-bold mb-6 text-center">{{ $t('import_export.export_guide.title') }}</h1>
        <p class="text-lg mb-8 text-center max-w-3xl mx-auto">
        {{ $t('import_export.export_guide.intro') }}
        </p>

        <!-- Browser Tabs using NuxtUI UTabs component -->
        <UTabs :items="tabItems" class="w-full mb-8">
            <template #icon="{ item, selected }">
                <img :src="item.icon" class="w-6 h-6 mr-1" />
            </template>

            <template #item="{ item }">
                <div v-html="item.content" />
            </template>
        </UTabs>

        <!-- Help Section -->
        <div class="help-section mt-12 text-center">
        <h3 class="text-xl font-semibold mb-3">{{ $t('import_export.export_guide.help_title') }}</h3>
        <i18n-t keypath="import_export.export_guide.help_text" tag="p">
          <template #link>
            <a href="/feedback" class="text-primary-600 dark:text-primary-400 hover:underline">{{ $t('import_export.export_guide.help_link') }}</a>
          </template>
        </i18n-t>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from "vue";

const { t } = useI18n();

const showShadow = ref(false);

onMounted(async () => {

    // Add scroll watcher to handle navbar shadow
    const handleScroll = () => showShadow.value = window.scrollY > 5;

    window.addEventListener('scroll', handleScroll);
});

const browsers = [
  {
    id: "chrome",
    name: "Chrome",
    icon: "/guide_resources/chrome.png",
    steps: [
      { key: "chrome_1", image: "/guide_resources/chrome/chrome_step_1.png" },
      { key: "chrome_2", image: "/guide_resources/chrome/chrome_step_2.png" },
      { key: "chrome_3", image: "/guide_resources/chrome/chrome_step_3.png" },
      { key: "chrome_4", hasNote: true }
    ]
  },
  {
    id: "firefox",
    name: "Firefox",
    icon: "/guide_resources/firefox.png",
    steps: [
      { key: "firefox_1", image: "/guide_resources/firefox/firefox_step_1.png" },
      { key: "firefox_2", image: "/guide_resources/firefox/firefox_step_2.png" },
      { key: "firefox_3", image: "/guide_resources/firefox/firefox_step_3.png" },
      { key: "firefox_4", hasNote: true }
    ]
  },
  {
    id: "safari",
    name: "Safari",
    icon: "/guide_resources/safari.png",
    steps: [
      { key: "safari_1", image: "/guide_resources/safari/safari_step_1.png" },
      { key: "safari_2", image: "/guide_resources/safari/safari_step_2.png" },
      { key: "safari_3", image: "/guide_resources/safari/safari_step_3.png", hasNote: true }
    ]
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    icon: "/guide_resources/edge.png",
    steps: [
      { key: "edge_1", image: "/guide_resources/edge/edge_step_1.png" },
      { key: "edge_2", image: "/guide_resources/edge/edge_step_2.png" },
      { key: "edge_3", hasNote: true }
    ]
  },
  {
    id: "opera",
    name: "Opera",
    icon: "/guide_resources/opera.png",
    steps: [
      { key: "opera_1", image: "/guide_resources/opera/opera_step_1.png" },
      { key: "opera_2", image: "/guide_resources/opera/opera_step_2.png" },
      { key: "opera_3", image: "/guide_resources/opera/opera_step_3.png" },
      { key: "opera_4", hasNote: true }
    ]
  },
  {
    id: "arc",
    name: "Arc",
    icon: "/guide_resources/arc.png",
    steps: [
      { key: "arc_1", image: "/guide_resources/arc/arc_step_1.png" },
      { key: "arc_2", image: "/guide_resources/arc/arc_step_2.png" },
      { key: "arc_3", hasNote: true }
    ]
  },
  {
    id: "raindrop",
    name: "Raindrop.io",
    icon: "/guide_resources/raindrop.png",
    steps: [
      { key: "raindrop_1", image: "/wizard/export/raindrop-login.jpg" },
      { key: "raindrop_2", image: "/wizard/export/raindrop-settings.jpg" },
      { key: "raindrop_3", image: "/wizard/export/raindrop-export.jpg" },
      { key: "raindrop_4", hasNote: true }
    ]
  }
];

const P = "import_export.export_guide";

// Transform browsers array into tabItems format for UTabs component
const tabItems = computed(() => browsers.map(browser => {
  return {
    label: browser.name,
    icon: browser.icon,
    content: `
      <div class="browser-instructions">
        <h2 class="text-2xl font-semibold mb-4 flex items-center gap-2">
          <img src="${browser.icon}" alt="${browser.name}" class="w-6 h-6" />
          ${t(`${P}.exporting_from`, { browser: browser.name })}
        </h2>
        
        <div class="steps space-y-8">
          ${browser.steps.map((step, index) => {
            const title = t(`${P}.steps.${step.key}.title`);
            return `
            <div class="step">
              <div class="step-header flex items-start gap-3 mb-1">
                <div class="step-number bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  ${index + 1}
                </div>
                <h3 class="text-xl font-medium">${title}</h3>
              </div>
              
              <div class="step-content ml-11">
                <p class="mb-4">${t(`${P}.steps.${step.key}.description`)}</p>
                
                ${step.hasNote ? `
                <div class="step-note bg-amber-50 dark:bg-amber-900/30 border-l-4 border-amber-500 p-3 rounded-r-lg text-sm mb-2">
                  <strong>${t(`${P}.note_label`)}</strong> ${t(`${P}.steps.${step.key}.note`)}
                </div>
                ` : ''}

                ${step.image ? `
                <div class="step-image mb-4 border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 shadow-xl">
                  <img src="${step.image}" alt="${title}" class="w-full" />
                </div>
                ` : ''}
              </div>
            </div>
          `;
          }).join('')}
        </div>

        <div class="mt-8 pt-6 border-t border-slate-200 dark:border-neutral-700">
          <h3 class="text-xl font-semibold mb-3">${t(`${P}.next_title`)}</h3>
          <p class="mb-4">${t(`${P}.next_intro`)}</p>
          <ol class="list-decimal ml-5 space-y-2">
            <li>${t(`${P}.next_1`)}</li>
            <div class="pb-4">
                <img src="/guide_resources/webbites_import/webbites_import_1.png" alt="${t(`${P}.import_alt`, { n: 1 })}" class="w-full rounded-lg shadow-lg" />
            </div>

            <li>${t(`${P}.next_2`)}</li>
            <div class="pb-4">
                <img src="/guide_resources/webbites_import/webbites_import_2.png" alt="${t(`${P}.import_alt`, { n: 2 })}" class="w-full rounded-lg shadow-lg" />
            </div>

            <li>${t(`${P}.next_3`)}</li>
            <div class="pb-4">
                <img src="/guide_resources/webbites_import/webbites_import_3.png" alt="${t(`${P}.import_alt`, { n: 3 })}" class="w-full rounded-lg shadow-lg" />
            </div>
            
            <li>${t(`${P}.next_4`)}</li>
            <div class="pb-4">
                <img src="/guide_resources/webbites_import/webbites_import_4.png" alt="${t(`${P}.import_alt`, { n: 4 })}" class="w-full rounded-lg shadow-lg" />
            </div>
          </ol>
        </div>
      </div>
    `
  };
}));
</script>

<style>
@reference "../assets/css/tailwind.css";

    body{
        @apply dark:!bg-neutral-900;
    }

    .fade-enter-active,
    .fade-leave-active {
        transition: opacity 0.3s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }


    :deep(.dark) kbd {
    background-color: #374151;
    border-color: #4b5563;
    color: #e5e7eb;
    }
</style>