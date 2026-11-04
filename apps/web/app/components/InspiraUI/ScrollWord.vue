<template>
  <span class="xl:lg-3 relative mx-1 lg:mx-2.5">
    <span class="absolute opacity-70">{{ word }}</span>
    <span class="flex">
      <span
        v-for="(letter, index) in word.split('')"
        :key="index"
        :style="{
          opacity: getLetterOpacity(index),
          filter: `blur(${getLetterBlur(index)}px)`,
          scale: getLetterScale(index),
          transition: `scale 0.1s ease-in-out`,
        }"
        :class="[
          hasGradient && getLetterOpacity(index) > 0.8
            ? 'bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-pink-500'
            : 'text-white'
        ]"
      >
        {{ letter }}
      </span>
    </span>
  </span>
</template>

<script lang="ts" setup>
import { computed } from "vue";

interface Props {
  word: string;
  progress: number;
  range: Array<number>;
  gradientWords?: string[];
}

const props = defineProps<Props>();

// Determine if this word should have a gradient
const hasGradient = computed(() => {
  if (!props.gradientWords || props.gradientWords.length === 0) return false;

  // Remove any punctuation at the end of the word for matching
  const cleanWord = props.word.toLowerCase().replace(/[.,!?;:]$/, '');
  return props.gradientWords.includes(cleanWord);
});

// Calculate the delay for each letter based on its position
const getLetterDelay = (index: number) => {
  const letterCount = props.word.length;
  const [start, end] = props.range;
  const rangeSize = end - start;
  const delayPerLetter = rangeSize / letterCount;
  return start + (index * delayPerLetter);
};

const getLetterScale = (index: number) => {
  const maxScale = 2; // Maximum scale factor for the letter animation
  const letterStart = getLetterDelay(index);
  const letterEnd = getLetterDelay(index + 1);
  const progress = props.progress;
  if (progress < letterStart) return 1;
  if (progress > letterEnd) return 1;
  // Linear interpolation for scale between 1 and maxScale
  return 1 + (maxScale - 1) * (progress - letterStart) / (letterEnd - letterStart);
};

const getLetterBlur = (index: number) => {
  const letterStart = getLetterDelay(index);
  const letterEnd = getLetterDelay(index + 1);
  const progress = props.progress;

  if (progress < letterStart) return 3;
  if (progress > letterEnd) return 0;

  // Linear interpolation for blur between 0 and 3
  return 4 * (1 - (progress - letterStart) / (letterEnd - letterStart));
};

const getLetterOpacity = (index: number) => {
  const letterStart = getLetterDelay(index);
  const letterEnd = getLetterDelay(index + 1);
  const progress = props.progress;

  if (progress < letterStart) return 0;
  if (progress > letterEnd) return 1;

  // Linear interpolation for opacity between 0 and 1
  return (progress - letterStart) / (letterEnd - letterStart);
};
</script>