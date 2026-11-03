<template>
  <div class="pdf-view-wrapper">
    <!-- The browser's own PDF plugin. Every desktop browser has one, and it
         brings paging, search and printing with it — none of which is worth
         rebuilding around a canvas renderer. -->
    <iframe
      v-if="fileUrl && !isMobile"
      class="pdf-view-frame"
      :src="`${fileUrl}#view=FitH`"
      :title="title"
      loading="lazy"
    ></iframe>

    <!-- iOS and most Android browsers refuse to render a PDF in a frame and
         leave a blank rectangle instead. The cover the server rendered is a
         real preview of the document, so it stands in, with the button that
         hands the file to whatever the phone does have. -->
    <div v-else-if="fileUrl" class="pdf-view-mobile">
      <img v-if="coverUrl" class="pdf-view-cover" :src="coverUrl" :alt="title">
      <UIcon v-else name="i-heroicons-document-text" class="pdf-view-icon" />

      <p class="pdf-view-title">{{ title }}</p>
      <p v-if="pageLabel" class="pdf-view-pages">{{ pageLabel }}</p>

      <UButton
        :to="fileUrl"
        target="_blank"
        rel="noopener"
        icon="i-heroicons-arrow-top-right-on-square"
        color="primary"
      >
        {{ $t('website_modal.pdf.open') }}
      </UButton>
    </div>

    <div v-else class="pdf-view-mobile">
      <UIcon name="i-heroicons-document-text" class="pdf-view-icon" />
      <p class="pdf-view-title">{{ $t('website_modal.pdf.unavailable') }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { pdfFileUrl, pdfPageLabel } from '~/composables/useBookmarkPdf'

const store = useStore()
const { webToShow, isMobile } = storeToRefs(store)

const fileUrl = computed(() => pdfFileUrl(webToShow.value))
const coverUrl = computed(() => webToShow.value?.OGImage || null)
const title = computed(() => webToShow.value?.siteTitle || webToShow.value?.fileName || 'PDF')
const pageLabel = computed(() => pdfPageLabel(webToShow.value))
</script>

<style scoped>
.pdf-view-wrapper {
  width: 100%;
  height: 100%;
  min-height: 60vh;
  display: flex;
}

.pdf-view-frame {
  width: 100%;
  height: 100%;
  min-height: 60vh;
  border: 0;
  border-radius: 0.5rem;
  background: var(--ui-bg-elevated, #f4f4f5);
}

.pdf-view-mobile {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem 1rem;
  text-align: center;
}

.pdf-view-cover {
  max-width: 100%;
  max-height: 50vh;
  border-radius: 0.5rem;
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}

.pdf-view-icon {
  width: 3rem;
  height: 3rem;
  opacity: 0.5;
}

.pdf-view-title {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.pdf-view-pages {
  font-size: 0.875rem;
  opacity: 0.7;
}
</style>
