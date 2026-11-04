<template>
  <div
    :style="{
      translate: `0px ${translate}px`,
      transform: `rotateX(${rotate}deg) scale(${scale})`,
    }"
    class="mx-auto -mt-12 w-full max-w-4xl rounded-xl border border-[#6C6C6C] shadow-2xl h-fit"
  >
    <!-- class="mx-auto -mt-12 h-[30rem] w-full max-w-5xl rounded-[30px] border-4 border-[#6C6C6C] bg-[#222222] p-2 shadow-2xl md:h-[40rem] md:p-4" -->

    <!-- <div
      class="size-full overflow-hidden rounded-2xl bg-gray-100 md:rounded-2xl md:p-4 dark:bg-zinc-900"
    > -->
      <slot></slot>
    <!-- </div> -->
  </div>
</template>

<script setup lang="ts">
defineProps({
  rotate: Number,
  scale: Number,
  translate: Number,
});
</script>

