<template>
  <node-view-wrapper class="image-gallery-wrapper">
    <div class="flex flex-wrap gap-4">
      <node-view-content class="flex flex-wrap gap-4" />
    </div>
  </node-view-wrapper>
</template>

<script setup>
import { nodeViewProps } from '@tiptap/vue-3'
import { NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'

defineProps(nodeViewProps)
</script>

<style>
@reference "../../assets/css/tailwind.css";
.image-gallery-wrapper {
  @apply my-4 w-full;
}

.image-gallery-wrapper .flex {
  @apply justify-start items-start;
}

.image-gallery-wrapper img {
  @apply max-w-[300px] h-auto object-cover flex-grow-0 flex-shrink-0;
}
</style>
