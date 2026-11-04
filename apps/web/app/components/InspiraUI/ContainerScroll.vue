<template>
  <div
    ref="containerRef"
    class="relative flex items-start justify-center p-2 md:h-[70rem] md:p-10 -mb-64 w-full"
  >
    <div
      class="relative w-full pt-40"
      style="perspective: 800px"
    >
      <ContainerScrollTitle :translate="translateY">
        <slot name="title"></slot>
      </ContainerScrollTitle>

      <!-- :rotate="rotate"
      :scale="scale" -->
      <ContainerScrollCard
        :rotate="rotate"
        :scale="scale"
        :translate="translateCardY"
      >
        <slot name="card" />
      </ContainerScrollCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useWindowSize, useScroll, useElementBounding } from "@vueuse/core";
import { ref, onMounted, onUnmounted, computed } from "vue";

const containerRef = ref(null);
const isMobile = ref(false);
const isHydrated = ref(false);

function updateIsMobile() {
  isMobile.value = window.innerWidth <= 768;
}

onMounted(() => {
  updateIsMobile();
  window.addEventListener("resize", updateIsMobile);
  // Mark as hydrated after mount to prevent hydration mismatch
  isHydrated.value = true;
});

onUnmounted(() => {
  window.removeEventListener("resize", updateIsMobile);
});

const { height } = useWindowSize();
const { y: scrollY } = useScroll(window);
const { top, bottom, height: containerHeight } = useElementBounding(containerRef);

// Calculate scrollYProgress based on the middle of the component
const scrollYProgress = computed(() => {
  if (!top.value || !containerHeight.value) return 0;

  // Calculate the position of the middle of the component relative to the viewport
  const viewportMiddle = scrollY.value + height.value / 3.5;

  // Calculate raw progress based on how close the component middle is to the viewport middle
  const rawProgress = (viewportMiddle - top.value) / (containerHeight.value * 3);

  // Start animation only when rawProgress is more than -0.30
  // Normalize the range from [-0.30, 1] to [0, 1]
  const normalizedProgress = (rawProgress + 0.38) / 1.38;

  // Clamp the value between 0 and 1
  return Math.max(0, Math.min(1, normalizedProgress));
});

const scaleDimensions = computed(() => (isMobile.value ? [0.7, 1] : [2.5, 1.2]));

// Updated calculations to hit targets at the midpoint (when scrollYProgress = 0.5)
const rotate = computed(() => {
  // Return untransformed state during SSR and before hydration
  if (import.meta.server || !isHydrated.value) return 0;

  const [start, end] = [40, -1]

  // Linear interpolation adjusted to reach 1 at the midpoint
  if (scrollYProgress.value <= 0.5) {
    // First half: start -> 1
    return start + (1 - start) * (scrollYProgress.value / 0.5);
  } else {
    // Second half: 1 -> end with reduced speed
    return start + (1 - start) * (1 + (scrollYProgress.value - 0.5) * 0.5);
  }
});

const scale = computed(() => {
  // Return untransformed state during SSR and before hydration
  if (import.meta.server || !isHydrated.value) return 1;

  const [start, end] = scaleDimensions.value;

  // Linear interpolation adjusted to reach 1 at the midpoint
  if (scrollYProgress.value <= 0.5) {
    // First half: start -> 1
    return start + (end - start) * (scrollYProgress.value / 0.5);
  } else {
    // Second half: 1 -> end
    return end
  }
});

// Adjust these translations as needed for your design
const translateY = computed(() => {
  // Return untransformed state during SSR and before hydration
  if (import.meta.server || !isHydrated.value) return 0;

  let translate = -((scrollYProgress.value * 80) + 1) * 10;
  let minTranslate = isMobile.value ? -247 : -247;
  let toTranslate = translate <= minTranslate ? minTranslate : translate;
  return toTranslate
});

const translateCardY = computed(() => {
  // Return untransformed state during SSR and before hydration
  if (import.meta.server || !isHydrated.value) return 0;

  // Reduce movement and offset on mobile to avoid cutting off the screenshot/card
  const baseOffset = isMobile.value ? -150 : -230; // initial offset
  const multiplierBefore = isMobile.value ? 300 : 500; // movement before threshold
  const multiplierAfterFactor = isMobile.value ? 0.05 : 0.1; // slower movement after threshold

  let translate;
  if (scrollYProgress.value <= 0.3) {
    // Normal translation rate before 0.3 (reduced on mobile)
    translate = (scrollYProgress.value * multiplierBefore) + baseOffset;
  } else {
    // Slower translation rate after 0.3 by reducing the multiplier (more reduced on mobile)
    const slowedProgress = 0.3 - (scrollYProgress.value - 0.3) * multiplierAfterFactor;
    translate = (slowedProgress * multiplierBefore) + baseOffset;
  }

  // console.log('isMobile.value: ', isMobile.value)

  // Clamp translation on mobile to ensure content stays visible within viewport
  if (isMobile.value) {
    const minY = -830; // do not translate beyond this value on mobile
    translate = Math.max(translate - 150, minY);
  }


  return translate;
});
</script>
