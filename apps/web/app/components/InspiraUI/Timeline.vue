<template>
  <div
    ref="timelineContainerRef"
    class="w-full font-sans max-w-6xl m-auto relative"
  >
    <!-- class="w-full font-sans max-w-6xl m-auto relative overflow-hidden" -->

    <!-- Background pattern -->
    <!-- <div class="absolute inset-0 bg-gradient-to-b from-neutral-900 to-neutral-800 opacity-90 z-0">
      <div class="absolute inset-0 bg-[radial-gradient(circle_500px_at_50%_200px,rgba(29,78,216,0.15),transparent)]"></div>
    </div> -->

    <!-- Header section -->
    <div class="mx-auto max-w-7xl px-6 pt-20 pb-12 text-center z-10 relative">
      <h2 class="mb-6 text-2xl font-bold text-white md:text-5xl bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
        <!-- 🤔
        <br> -->
        {{ title }}
      </h2>
      <p class="text-sm text-neutral-300 md:text-lg max-w-2xl mx-auto">
        {{ description }}
      </p>
    </div>

    <!-- Timeline content -->
    <div
      ref="timelineRef"
      class="relative mx-auto max-w-7xl pb-20 flex flex-col"
    >
      <!-- Timeline central line -->
      <div
        :style="{
          height: (height + props.offset) + 'px',
        }"
        class="z-[5] absolute left-1/2 -translate-x-1/2 -translate-y-[200px] top-0 w-1 overflow-hidden bg-[linear-gradient(to_bottom,var(--tw-gradient-stops))] from-transparent from-0% via-neutral-500 to-transparent to-[99%] [mask-image:linear-gradient(to_bottom,transparent_0%,black_10%,black_90%,transparent_100%)]"
      >
        <motion.div
          :style="{
            height: heightTransform,
            opacity: opacityTransform,
          }"
          class="absolute inset-x-0 top-0 w-full rounded-full bg-gradient-to-t from-emerald-500 from-0% via-emerald-400 via-40% to-cyan-400"
        >
        </motion.div>
      </div>

      <!-- Timeline items -->
      <div
        v-for="(item, index) in props.items"
        :key="item.id + index"
        class="relative flex flex-col items-center gap-4 justify-start z-10 w-full mb-24 md:mb-10 max-w-3xl mx-auto"
        :style="{
          scale: `${itemAnimations[index]?.scale}`,
          transform: `translateY(${itemAnimations[index]?.translateY * 3}px)`
        }"
        ref="itemRefs"
      >

        <!-- Content for even items (left side on desktop) -->
        <div
          class="flex items-center gap-4 p-6 backdrop-filter backdrop-blur-md border border-neutral-700/70 rounded-xl shadow-xl hover:!scale-105 transition duration-500"
          :class="index % 2 === 0 ? 'flex-col md:flex-row-reverse' : 'flex-col md:flex-row'"
          :style="{
              opacity: itemAnimations[index]?.opacity || 0,
              transform: `translateY(${itemAnimations[index]?.translateY * 1}px)`,
              filter: `blur(${itemAnimations[index]?.blur  * 0.3}px)`,
              transition: 'transform 0.1s ease-out, opacity 0.1s ease-out'
            }"
        >
          <div class="flex flex-col gap-2 relative md:w-[60%]">
            <div class="flex flex-row items-start gap-2">
              <h2 class="text-neutral-100 text-3xl font-bold">
                {{ item.label }}
              </h2>
            </div>
            <p class="text-neutral-200 text-lg">
              {{ item.description }}
            </p>
          </div>

          <div
            class="md:col-span-2 flex justify-start relative pt-2 md:pt-0 md:w-[40%]"
            :style="{
              opacity: itemAnimations[index]?.opacity || 0,
              scale: `${itemAnimations[index]?.scale}`,
              filter: `blur(${itemAnimations[index]?.blur * 1}px)`,
              transition: 'transform 0.1s ease-out, opacity 0.1s ease-out'
            }"
          >
            <div
              v-if="item.imgUrl"
              class="w-full overflow-hidden rounded-xl border border-neutral-700 shadow-lg shadow-emerald-900/20 transition-all duration-500"
              :class="[itemAnimations[index]?.hover ? 'scale-105' : 'scale-100']"
            >
              <img
                :src="item.imgUrl"
                class="w-full h-auto object-cover"
                :alt="item.label"
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { motion, useScroll, useTransform } from "motion-v";
  import type { HTMLAttributes } from "vue";
  import { ref, onMounted, nextTick, watch, reactive, onBeforeUnmount } from "vue";

  interface Props {
    containerClass?: HTMLAttributes["class"];
    class?: HTMLAttributes["class"];
    offset: number;
    items: {
      id: string;
      label: string;
      description: string;
      imgUrl: string;
    }[];
    title?: string;
    description?: string;
  }

  const props = withDefaults(defineProps<Props>(), {
    items: () => [],
  });

  const timelineContainerRef = ref<HTMLElement | null>(null);
  const timelineRef = ref<HTMLElement | null>(null);
  const itemRefs = ref<HTMLElement[]>([]);
  const height = ref(0);
  const scrollYProgress = ref();
  const heightTransform = ref();
  const opacityTransform = ref();

  // Store animation values for each item
  const itemAnimations = reactive<Array<{opacity: number, translateY: number, scale: number, blur: number, hover: boolean}>>([]);

  // Initialize values
  onMounted(() => {

    const { scrollYProgress: scrollProgress } = useScroll({
      target: timelineRef,
      offset: ["start 100%", "end 50%"],
    });

    console.log('scrollYProgress: ', scrollYProgress)
    console.log('scrollProgress: ', scrollProgress)

    scrollYProgress.value = scrollProgress;
    heightTransform.value = useTransform(scrollProgress, [0, 1], [0, 1])
    console.log('heightTransform: ', heightTransform.value)
    opacityTransform.value = useTransform(scrollProgress, [0, 0.1], [0, 1]);


    // Initialize each item with starting animation values
    props.items.forEach((_, index) => {
      itemAnimations[index] = { opacity: 0, translateY: 0, scale: 1, blur: 0, hover: false};
    });

    nextTick(() => {
      if (timelineRef.value) {
        const rect = timelineRef.value.getBoundingClientRect();
        height.value = rect.height;
      }

      // Set up scroll event listener
      window.addEventListener("scroll", handleScroll, { passive: true });

      // Run once to set initial positions
      handleScroll();
    });
  });

  onBeforeUnmount(() => {
    // Clean up event listener
    window.removeEventListener("scroll", handleScroll);
  });

  // Function to calculate how far an element is through the viewport
  const calculateVisibilityRatio = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight;

    // Start animation when element is 20% into view from bottom
    const startPoint = windowHeight * 1.59;
    // Complete animation when element is 20% up the screen
    const endPoint = windowHeight * 0.7;

    // Calculate how far through this range the element is
    let visibilityRatio;

    if (rect.top >= startPoint) {
      // Element hasn't reached start point yet
      visibilityRatio = 0;
    } else if (rect.top <= endPoint) {
      // Element has passed end point
      visibilityRatio = 1;
    } else {
      // Element is between start and end points
      visibilityRatio = (startPoint - rect.top) / (startPoint - endPoint);
    }


    return Math.max(0, Math.min(1, visibilityRatio));
  };

  // Handle scroll event to update animations
const handleScroll = () => {
    if (!itemRefs.value || itemRefs.value.length === 0) return;

    // Update each item's animation based on its position
    itemRefs.value.forEach((item, index) => {
      if (!item) return;

      const visibilityRatio = calculateVisibilityRatio(item);

      // Keep hover state while updating other properties
      const hoverState = itemAnimations[index]?.hover || false;

      // Calculate new translateY value
      let newTranslateY = 70 * (1 - visibilityRatio);

      // If the element is fully visible (ratio = 1), ensure it stays at 0 translateY
      if (visibilityRatio >= 0.99) {
        newTranslateY = 0;
      }

      let opacityAmount = Math.min(visibilityRatio * 1.5, 1); // Faster opacity change
      let blurAmount = 10 * (1 - visibilityRatio); // Blur starts at 10 and reduces to 0
      let scaleAmount = 0.5 + (visibilityRatio * 0.5); // Scale from 0.5 to 1 as element comes into view

      // Update animation values based on scroll position
      itemAnimations[index] = {
        opacity: opacityAmount,
        translateY: newTranslateY,
        scale: scaleAmount,
        blur: blurAmount,
        hover: hoverState
      };
    });
  };

  watch(height, (newHeight) => {
    heightTransform.value = useTransform(scrollYProgress.value, [0, 1], [0, newHeight + props.offset]);
  });
</script>