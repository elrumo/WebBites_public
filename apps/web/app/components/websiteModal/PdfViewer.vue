<template>
  <div class="h-full w-full">
    <iframe 
     :src="pdfUrl" 
     frameborder="0"
     class="h-full w-full"
    ></iframe>
  </div>
</template>

<script setup lang="ts">

const props = defineProps({
  pdfUrl: {
    type: String,
    required: true
  }
})
</script>
