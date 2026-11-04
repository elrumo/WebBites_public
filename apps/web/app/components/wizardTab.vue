<template>
  <div class="flex flex-col items-center justify-between h-full flex-1 relative">
    <div class="relative z-10 w-full flex flex-col justify-between items-center px-8 pt-6 pb-0 text-center">
    <!-- <div class="relative z-10 w-full flex flex-col justify-between items-center px-8 pt-6 pb-0 h-full text-center "> -->
      <!-- Title with animated gradient -->
      <h2
        class="text-3xl font-semibold tracking-tight w-full"
        :class="{
          'mb-8': !item.showBookmarkInput && !item.showImportButton,
          'mb-2': item.showImportButton,
        }"
      >
        <span class="relative">
          <span class="text-primary">
            {{ item.title }}
          </span>
          <span v-if="item.titleHighlight" class="absolute bottom-0 left-0 w-full h-[6px] bg-primary-400/20 rounded-lg -z-10"></span>
        </span>
      </h2>


      <div class="w-full flex flex-col justify-center items-center h-full">
        <div v-if="item.isLogo" class="w-full flex justify-center">
          <div class="flex justify-center w-[300px]">
            <div v-tilt="{ glare: true }" class="preserve">
              <Logo
                v-if="item.isLogo"
                :isText="false"
                :isImage="true"
                imageSize="200"
                class="animate-float my-8"
              />
            </div>
          </div>
        </div>

        <!-- Images with parallax effect -->
        <div
          v-if="item.images && item.images.length > 0"
          class="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-5 my-6 w-full relative"
          :key="'images-container-' + currentStep"
        >
          <div
            v-for="(image, index) in item.images"
            :key="'image-' + currentStep + '-' + index"
            class="overflow-hidden rounded-xl shadow-lg transition-transform duration-500"
            :class="[item.imageClass, {'hover:scale-[1.02] cursor-zoom-in': item.zoomable}]"
            @mouseenter="handleMouseEnter($event, index)"
            @mousemove="handleMouseMove($event, index)"
            @mouseleave="handleMouseLeave($event, index)"
            @click="item.zoomable ? toggleZoom(index) : null"
          >
            <img
              :src="image"
              class="h-full w-full object-cover transform transition-transform duration-700 ease-out"
              :class="[{'scale-105': hoveredImage === index}, item.links ? 'md:h-[220px] object-top' : 'md:min-h-[300px]']"
              :style="getImageTransform(index)"
              alt=""
            >
          </div>
        </div>

        <!-- Content with animated entrance -->
        <div v-if="!item.showBookmarkInput" class="wizard-tab-content">
        <!-- <div v-if="!item.showBookmarkInput" class="flex flex-col justify-center items-center max-w-md h-full"> -->
          <div
            v-html="markedText(item.content)"
            class="w-full font-medium text-lg"
            :class="{
              'mt-4': !item.images || item.images.length === 0 || item.showImportButton,
              'mt-8': item.images && !item.showImportButton,
              }"
          />
          <div
            v-if="item.subcontent"
            v-html="item.subcontent"
            class="mt-3 opacity-80 text-sm font-light w-full"
          />
        </div>

        <!-- Link / action buttons -->
        <div v-if="item.links?.length" class="flex flex-wrap justify-center gap-3 my-4 w-full">
          <UButton
            v-for="link in item.links"
            :key="link.label"
            :to="link.url"
            :target="link.url ? '_blank' : undefined"
            :icon="link.icon"
            color="primary"
            size="lg"
            class="border border-primary-500 bg-primary-600/95 hover:bg-primary-600 text-white py-2 px-6 shadow-md hover:shadow-lg transition-all duration-300"
            variant="solid"
            @click="link.action?.()"
          >
            <img v-if="link.img" :src="link.img" alt="" class="w-6 h-6">
            {{ link.label }}
          </UButton>
        </div>
      </div>

      <div v-if="item.showImportButton" class="flex justify-center my-4 w-full">
        <UButton
          @click="store.clickId('importBookmarks')"
          color="primary"
          size="lg"
          class="border border-primary-500 bg-primary-600/95 hover:bg-primary-600 text-white py-2 px-6 shadow-md hover:shadow-lg transition-all duration-300"
          variant="solid"
          icon="i-heroicons-arrow-up-tray"
        >
          <input @change="store.importBookmarksFile()" id="importBookmarks" type="file" class="hidden absolute">
          {{ $t('bookmarks.import') }}
        </UButton>
      </div>

      <!-- New bookmark input with animation -->
      <div
        v-if="item.showBookmarkInput"
        class="w-full flex flex-col justify-start h-full transition-all"
        :class="{
          'animate-pulse': pulseInput,
          'pt-12': isVirgin && !hasFocusTipTap
        }"
      >
        <div
          class="flex flex-col justify-center items-center h-fit transition-all"
          :class="{
          'opacity-50 scale-90': hasFocusTipTap || !isVirgin
        }"
        >
          <div
            v-html="markedText(item.content)"
            class="font-semibold w-full text-center leading-relaxed"
            :class="{'mt-2': !item.images || item.images.length === 0}"
          />
          <Transition name="blur" mode="out-in">
            <div
              v-if="item.subcontent != undefined && (isVirgin && !hasFocusTipTap)"
              v-html="markedText(item.subcontent)"
              class="mt-3 opacity-80 text-sm font-light w-full max-w-[80%]"
            />
          </Transition>
        </div>

        <NewBookmark
          :value="store.firstBookmark"
          :isInline="true"
          placeholderValue="https://webbites.io/"
        />
      </div>
    </div>

    <!-- Fullscreen image preview -->
    <div
      v-if="zoomedImage !== null"
      class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-8 cursor-zoom-out"
      @click="zoomedImage = null"
    >
      <img
        :src="item.images[zoomedImage]"
        class="max-h-full max-w-full object-contain rounded-lg"
        alt=""
      />
      <button
        class="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2 hover:bg-black/80"
        @click.stop="zoomedImage = null"
      >
        <span class="i-heroicons-x-mark w-6 h-6"></span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { vTilt } from '~/utils/vanillaTilt'

const props = defineProps({
  item: {
    type: Object,
    required: true
  },
  index: {
    type: Number,
    required: true
  },
  currentStep: {
    type: Number,
    required: true
  },
  totalSteps: {
    type: Number,
    required: true
  }
})

const {
  hasFocusTipTap,
  newUrlValue
} = storeToRefs(useStore())

const store = useStore()
const { markedText, removeHtml } = store

// Parallax and interaction state
const hoveredImage = ref(null)
const pulseInput = ref(false)
const zoomedImage = ref(null)

const isVirgin = computed(() => {
  try {
    return removeHtml(newUrlValue.value).length == 0
  } catch (error) {
    console.log('error with removeHtml: ', error)
    return false
  }
  return newUrlValue.value === '<p class="editor-paragraph"></p>' || newUrlValue.value == undefined;
})

// Use computed to dynamically update the array size when props change
const imageTransforms = ref([])

// Initialize transforms when component mounts or when the step changes
function initializeImageTransforms() {
  const length = props.item?.images?.length || 0
  imageTransforms.value = Array(length).fill().map(() => ({ x: 0, y: 0 }))
}

// Call initialization when mounted
onMounted(() => {
  initializeImageTransforms()
})

// Handle parallax effect on images
function handleMouseEnter(event, index) {
  hoveredImage.value = index
}

function handleMouseMove(event, index) {
  const rect = event.currentTarget.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width - 0.5
  const y = (event.clientY - rect.top) / rect.height - 0.5

  // Update transform for specific image
  imageTransforms.value[index] = { x, y }
}

function handleMouseLeave(event, index) {
  hoveredImage.value = null
  imageTransforms.value[index] = { x: 0, y: 0 }
}

function getImageTransform(index) {
  if (!imageTransforms.value[index]) return ''
  const { x, y } = imageTransforms.value[index]

  // Subtle parallax effect
  return `translate(${x * -5}px, ${y * -5}px)`
}

function toggleZoom(index) {
  zoomedImage.value = index
}

// Pulse animation for input on last step
onMounted(() => {
  if (props.item.showBookmarkInput) {
    setTimeout(() => {
      pulseInput.value = true
      setTimeout(() => { pulseInput.value = false }, 1500)
    }, 500)
  }
})


// Ensure smooth transitions between steps
watch(() => props.currentStep, (newStep) => {
  // Reset states when step changes
  hoveredImage.value = null
  zoomedImage.value = null

  // Reinitialize image transforms for the new step
  initializeImageTransforms()

  // Trigger pulse animation when entering bookmark input step
  if (props.item.showBookmarkInput) {
    setTimeout(() => {
      pulseInput.value = true
      setTimeout(() => { pulseInput.value = false }, 1500)
    }, 500)
  }
})

// Also watch for changes to the images array
watch(() => props.item.images, () => {
  initializeImageTransforms()
}, { deep: true })
</script>

<style lang="scss" scoped>
.preserve {
  transform-style: preserve-3d;
}

.animate-float {
  animation: float 6s ease-in-out infinite;
}

@keyframes float {
  0% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-10px);
  }
  100% {
    transform: translateY(0px);
  }
}


</style>
