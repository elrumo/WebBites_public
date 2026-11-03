<template>
  <div
    ref="textScrollRevealRef"
    :class="cn('relative z-0 h-[200vh]', $props.class)"
  >
    <div class="sticky top-0 flex h-1/2 max-w-4xl items-center bg-transparent px-4 py-0 -mt-20">
      <p
        class="flex flex-wrap justify-center p-5 text-2xl font-bold text-white/0 xl:text-5xl lg:p-10 lg:text-4xl md:p-8 md:text-3xl"
      >
        <ScrollWord
          v-for="(word, i) in words"
          :key="i"
          :word="word"
          :progress="scrollYProgress+0.01"
          :range="[i / words.length, (i + 1) / words.length]"
          :gradient-words="gradientWords"
        />
      </p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { cn } from "~/lib/utils";
import ScrollWord from "./ScrollWord.vue"; // Make sure to import the ScrollWord component

interface Props {
  class?: string;
  text: string;
  gradientWords?: string[];
}

// Props
const props = defineProps<Props>();

const textScrollRevealRef = ref<HTMLElement | null>(null);

const words = computed(() => props.text.split(" "));

// Convert all gradient words to lowercase for case-insensitive matching
const gradientWords = computed(() =>
  props.gradientWords?.map(word => word.toLowerCase()) || []
);

const scrollYProgress = ref(0);

function updateScrollYProgress() {
  if (textScrollRevealRef.value) {
    const element = textScrollRevealRef.value;
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight;

    // Calculate the visible portion of the element
    // Start at 0 when the element's top enters the viewport bottom
    // End at 1 when the element's bottom exits at the viewport top
    const elementHeight = rect.height;
    const visibleTop = Math.max(0, Math.min(elementHeight, (-rect.top + windowHeight)));
    // const visibleTop = Math.max(0, Math.min(elementHeight + 500, (-rect.top + windowHeight) - 500));
    const visibleBottom = Math.max(0, Math.min(elementHeight, windowHeight - rect.top));

    // Calculate progress from 0 to 1
    scrollYProgress.value = Math.max(0, Math.min(1, visibleTop / elementHeight));

    // console.log("scrollYProgress:", scrollYProgress.value);
  }
}

onMounted(() => {
  window.addEventListener("scroll", updateScrollYProgress, { passive: true });
  window.addEventListener("resize", updateScrollYProgress, { passive: true });
  updateScrollYProgress();
});

onUnmounted(() => {
  window.removeEventListener("scroll", updateScrollYProgress);
  window.removeEventListener("resize", updateScrollYProgress);
});
</script>
