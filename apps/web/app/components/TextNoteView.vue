<template>
  <div class="textEditor-wrapper" @click="setFocusEditor">
    <LazyTiptap
      class="w-full h-full"
      :outlineWhenFocused="false"
      v-model="webToShow.textNote"
      @update:modelValue="debounce(() => notesUpdated($event), 500)"
    />
  </div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const store = useStore()

const {
    createDebounce,
    saveUpdatedSite,
} = store

const {
  webToShow,
} = storeToRefs(store)

const props = defineProps({
  widePage: Boolean,
})

const debounce = createDebounce();

function notesUpdated(textNote) {
    saveUpdatedSite(webToShow.value.objectId, 'textNote', textNote);
}

function setFocusEditor() {
  // document.querySelector('.tiptap-editor').focus()
}
</script>
