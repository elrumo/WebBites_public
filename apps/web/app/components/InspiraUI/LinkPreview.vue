<template>
  <div :class="cn('relative inline-block', props.class)" style="position: relative;">
    <!-- Trigger -->
    <div
      :class="cn(props.linkClass)"
      class="cursor-pointer overflow-hidden"
      ref="trigger"
      @mousemove="handleMouseMove"
      @mouseenter="handleMouseEnter"
      @mouseleave="hidePreview"
    >
      <slot />
    </div>

    <!-- Preview -->
    <Transition name="link-preview">
      <div
        v-if="isVisible"
        ref="preview"
        class="pointer-events-none absolute z-50 transition -translate-x-[48%]"
        style="transform-origin: 0% -70%"
        :style="previewStyle"
      >
        <!-- class="pointer-events-none absolute z-50 transition -translate-x-[48%] origin-top-left" -->
        <div
          class="overflow-hidden rounded-xl shadow-xl"
          :class="[
            { 'transform-gpu': !props.isStatic }
          ]"
        >
          <div
            class="block rounded-xl border border-neutral-600 p-1 shadow-lg bg-neutral-800"
          >
            <img
              :src="previewSrc"
              :width="width"
              :height="height"
              class="size-full rounded-lg object-cover"
              :style="imageStyle"
              alt="preview"
              @load="handleImageLoad"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onUnmounted, type CSSProperties } from "vue";
import { cn } from "~/lib/utils";
import { useScroll } from 'motion-v';

interface BaseProps {
  class?: string;
  linkClass?: string;
  width?: number;
  height?: number;
  image?: string; // Direct image path
  mousePosition?: { x: number; y: number } | null; // External mouse position
}

// Props for static image mode
interface StaticImageProps extends BaseProps {
  isStatic: true;
  imageSrc: string;
  url?: string; // optional in static mode
}

// Props for URL preview mode
interface URLPreviewProps extends BaseProps {
  isStatic?: false; // optional but must be false if specified
  imageSrc?: string; // optional in URL mode
  url: string;
}

// Combined type that enforces the requirements
type Props = StaticImageProps | URLPreviewProps;
const props = withDefaults(defineProps<Props>(), {
  isStatic: false,
  imageSrc: "",
  url: "",
  width: 200,
  height: 125,
  image: "", // Default to empty string
  mousePosition: null, // Default to null
});

const isVisible = ref(false);
const isLoading = ref(true);
const preview = ref<HTMLElement | null>(null);
const trigger = ref<HTMLElement | null>(null);
const hasPopped = ref(false);
const isHovering = ref(false);
const positionTrigger = ref(0);
const lastXSaved = ref(0);
const generalScrollY = ref();
const isMobile = ref(false);

// Internal mouse position tracking
const mousePosition = reactive({
  x: 0,
  y: 0,
});

// Generate preview URL
const previewSrc = computed(() => {
  // First priority: direct image path if provided
  if (props.image) return props.image;

  // Second priority: static image source
  if (props.isStatic) return props.imageSrc;

  // Last priority: generate preview from URL
  const params = new URLSearchParams({
    url: props.url,
    screenshot: "true",
    meta: "false",
    embed: "screenshot.url",
    colorScheme: "light",
    "viewport.isMobile": "true",
    "viewport.deviceScaleFactor": "1",
    "viewport.width": String(props.width * 3),
    "viewport.height": String(props.height * 3),
  });

  return `https://api.microlink.io/?${params.toString()}`;
});

onMounted(() => {
  // Set up scroll handling with motion-v
  generalScrollY.value = useScroll().scrollY;
  
  checkIfMobile();
  // Add resize listener
  window.addEventListener('resize', checkIfMobile);
})

onUnmounted(() => {
  window.removeEventListener('resize', checkIfMobile);
});

function checkIfMobile() {
  isMobile.value = window.innerWidth < 768;
}

const previewStyle = computed<CSSProperties>(() => {

  if(isMobile.value){
    return {
      left: '50%',
      top: '100px',
      position: 'fixed',
      transformOrigin: '0% 0% !important',
      transform: 'translateX(-50%)',
      width: `${props.width}px`,
      height: `${props.height}px`,
    };
  }

  // This will trigger a recalculation whenever positionTrigger changes
  const _ = positionTrigger.value;

  if (!trigger.value) return {};

  const previewWidth = props.width;
  const previewHeight = props.height;

  // Get fresh position data
  const linkRect = trigger.value.getBoundingClientRect();
  const previewHalfWidth = previewWidth / 2;
  const screenWidth = window.innerWidth;
  const absoluteX = (mousePosition.x - previewHalfWidth);

  // Calculate relative mouse position within the linkRect
  let x = (mousePosition.x - linkRect.left) / linkRect.width;

  // Center the preview on the mouse horizontally
  let previewX = (x * 100);
  previewX = absoluteX <= 0 ? lastXSaved.value : previewX;
  previewX = absoluteX + (previewWidth + (previewWidth * 0.05)) >= screenWidth ? lastXSaved.value : previewX;
  if(absoluteX > 0 && absoluteX + previewWidth + (previewWidth * 0.05) < screenWidth){ lastXSaved.value = previewX;}

  return {
    left: `${previewX}%`,
    top: `${100}px`,
    width: `${previewWidth}px`,
    height: `${previewHeight}px`,
  };
});


// Image specific styling
const imageStyle = computed<CSSProperties>(() => ({
  width: `${props.width}px`,
  height: `${props.height}px`,
}));

function handleMouseMove(event: MouseEvent) {
  // Only update internal mouse position if external is not provided
  if (!props.mousePosition) {
    mousePosition.x = event.clientX;
    mousePosition.y = event.clientY;

    // Force position recalculation on mouse move if visible
    if (isVisible.value) {
      positionTrigger.value++;
    }
  }
}

function handleMouseEnter() {
  isHovering.value = true;

  // Only show if not currently scrolling
  showPreview();
}

function showPreview() {
  // Force recalculation of position before showing
  positionTrigger.value++;
  isVisible.value = true;

  // Add slight delay before animation
  setTimeout(() => {
    hasPopped.value = true;
  }, 50);
}

function hidePreview() {
  isHovering.value = false;
  isVisible.value = false;
  hasPopped.value = false;
}

function handleImageLoad() {
  isLoading.value = false;
}

// Create a debounced function outside of the watcher
const debouncedScrollEnd = debounce(() => {
  // Only show if still hovering
  if (isHovering.value) {
    showPreview();
  }
}, 10);

// Watch for scroll changes
watch(generalScrollY, () => {

  if (isVisible.value) {
    // Hide preview immediately when scrolling starts
    isVisible.value = false;
    hasPopped.value = false;
  }

  // Debounce scroll end detection
  debouncedScrollEnd();
});

// Simple debounce utility that returns the debounced function
function debounce(fn: Function, delay: number) {
  let timeout: number | null = null;

  return function(...args: any[]) {
    if (timeout !== null) {
      clearTimeout(timeout);
    }

    timeout = window.setTimeout(() => {
      fn.apply(null, args);
      timeout = null;
    }, delay);
  };
}
</script>

<style scoped>
.transform-gpu {
  transform-origin: center bottom;
  will-change: transform;
  backface-visibility: hidden;
}

.link-preview-enter-active,
.link-preview-leave-active {
  transition: all 0.8s cubic-bezier(0.545, -0.600, 0.000, 1.370);
}

.link-preview-enter-from,
.link-preview-leave-to {
    opacity: 0;
    translate: 0 70px;
    scale: 0.3;
    filter: blur(10px);
}
</style>
