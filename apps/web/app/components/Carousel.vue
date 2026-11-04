<template>
  <div class="embla">
    <div class="embla__viewport" ref="emblaRef">
      <div class="embla__container">
        
        <!-- Empty slide -->
        <div class="embla__slide embla__slide--empty" :class="{ 'is-selected': selectedIndex === 0 }"></div>

        <!-- Main slides -->
        <div
          class="embla__slide feature-slide-item"
          v-for="(feature, index) in features" 
          :key="feature.title"
          :class="{ 'is-selected': index + (hasFirstSlot ? 1 : 0) === selectedIndex }"
        >
          <div v-if="feature.html" v-html="feature.html"></div>
          <template v-else>
            <div class="feature-image-wrapper">
              <img :src="feature.imageUrl" :alt="feature.title" />
            </div>
            <h3 class="feature-title">{{ feature.title }}</h3>
            <p class="feature-description">{{ feature.description }}</p>
          </template>
        </div>

        <!-- Empty last slide -->
        <div class="embla__slide embla__slide--empty" :class="{ 'is-selected': selectedIndex === totalSlides - 1 }"></div>
      </div>
    </div>

    <div class="embla__footer">
      <div class="embla__dots">
        <button
          class="embla__dot"
          v-for="(_, index) in totalSlides"
          :key="index"
          :class="{ 'is-selected': index === selectedIndex }"
          @click="scrollTo(index)"
        ></button>
      </div>
    </div>
    <div class="embla__arrows">
      <button class="embla__prev" @click="scrollPrev">
        <IconBrew :size="24" icon="arrowLeft"/>
      </button>
      <button class="embla__next" @click="scrollNext">
        <IconBrew :size="24" icon="arrowRight"/>
      </button>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, watch, computed } from 'vue'
import emblaCarouselVue from 'embla-carousel-vue'

export default {
  props: {
    features: {
      type: Array,
      required: true
    }
  },

  setup(props) {
    const [emblaRef, emblaApi] = emblaCarouselVue({
      loop: false,
      align: 'center',
      containScroll: 'trimSnaps'
    })
    const selectedIndex = ref(0)
    const hasFirstSlot = ref(false)
    const hasLastSlot = ref(false)

    const totalSlides = computed(() => {
      return props.features.length + (hasFirstSlot.value ? 1 : 0) + (hasLastSlot.value ? 1 : 0)
    })

    const scrollPrev = () => emblaApi.value && emblaApi.value.scrollPrev()
    const scrollNext = () => emblaApi.value && emblaApi.value.scrollNext()
    const scrollTo = (index) => emblaApi.value && emblaApi.value.scrollTo(index)

    const onSelect = () => {
      if (emblaApi.value) {
        selectedIndex.value = emblaApi.value.selectedScrollSnap()
      }
    }

    onMounted(() => {
      if (emblaApi.value) {
        emblaApi.value.on('select', onSelect)
        onSelect()

        // Check if slots are present
        hasFirstSlot.value = !!emblaApi.value.slideNodes()[0].querySelector(':scope > :not(.embla__slide--empty)')
        hasLastSlot.value = !!emblaApi.value.slideNodes()[emblaApi.value.slideNodes().length - 1].querySelector(':scope > :not(.embla__slide--empty)')

        // Reposition to center if first slot is present
        if (hasFirstSlot.value) {
          emblaApi.value.scrollTo(1)
        }
      }
    })

    watch(emblaApi, (newVal) => {
      if (newVal) {
        newVal.on('select', onSelect)
        onSelect()
      }
    })

    return {
      emblaRef,
      scrollPrev,
      scrollNext,
      scrollTo,
      selectedIndex,
      totalSlides,
      hasFirstSlot,
      hasLastSlot
    }
  }
}
</script>

<style lang="scss" scoped>
.embla {
  position: relative;
  width: 100%;
  padding-bottom: 2rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  &__viewport {
    overflow: hidden;
    position: relative;
    // max-width: 1024px;
    width: 100%;

    &::before,
    &::after {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      width: 25%;
      z-index: 1;
      pointer-events: none;
    }

    &::before {
      left: 0;
      // background: linear-gradient(to right, #222222, transparent);
      background: linear-gradient(to right, #222222, transparent );
    }

    &::after {
      right: 0;
      // background: linear-gradient(to left, #222222, transparent);
      background: linear-gradient(to left, #222222 10%, transparent )
    }
  }

  &__container {
    display: flex;
    padding: 2rem 0px;
  }

  &__slide {
    flex: 0 0 80%;
    min-width: 0;
    transition: all 0.5s ease;
    opacity: 0.4;
    transform: scale(0.9);
    filter: blur(2px);

    &.is-selected {
      opacity: 1;
      transform: scale(1);
      filter: unset
    }

    &--empty {
      flex: 0 0 27%;
      min-width: 0;
    }
  }

  &__footer {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    margin-top: 20px;
    gap: 1rem;
  }

  &__arrows {
    display: flex;
    position: absolute;
    width: 100%;
    max-width: 940px;
    justify-content: space-between;
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
  }

  &__prev,
  &__next {
    background: rgba(255, 255, 255, 0.1);
    color: white;
    border: none;
    padding: 12px;
    cursor: pointer;
    border-radius: 50%;
    transition: all 0.3s ease;
    aspect-ratio: 1 / 1;
    display: flex;
    justify-content: center;
    align-items: center;
    border: 1px solid rgba(255, 255, 255, 0.2);
    // backdrop-filter: blur(10px);

    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  }

  &__dots {
    display: flex;
    gap: 8px;
  }

  &__dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background-color: rgba(255, 255, 255, 0.3);
    padding: 0;
    border: none;
    cursor: pointer;
    transition: all 0.3s ease;

    &.is-selected {
      background-color: white;
      transform: scale(1.2);
    }
  }
}
</style>
