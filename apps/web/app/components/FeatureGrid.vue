<template>
    <div
      class="feature-grid"
      :class="{
        'grid-cols-1 md:grid-cols-1': columnNumber === 1,
        'grid-cols-1 md:grid-cols-2': columnNumber === 2,
        'grid-cols-1 md:grid-cols-3': columnNumber === 3
      }"
      @mousemove="handleMouseMove"
    >
        <FeatureCard
          v-for="feature in features"
          :key="feature.title"
          :icon="feature.icon"
          :title="feature.title"
          :description="feature.description"
          :mousePosition="mousePosition"
        />
    </div>
</template>

<script setup>
defineProps({
    columnNumber: {
        type: Number,
        required: true,
        default: 3
    },
    features: {
        type: Array,
        required: true,
        default: () => []
    }
})

const mousePosition = reactive({
  x: 0,
  y: 0
});

function handleMouseMove(event) {
  mousePosition.x = event.clientX;
  mousePosition.y = event.clientY;
}

</script>

<style scoped>
@reference "../assets/css/tailwind.css";
</style>