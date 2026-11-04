<template>
  <CardSpotlight
    :class="['relative', 'cursor-pointer', 'feature-card']"
    gradient-color="#41d97665"
    :gradientSize="200"
  >
    <div class="feature-icon-container" v-html="icon">
    </div>

    <h3 class="text-xl font-bold mb-2">{{ title }}</h3>
    <p class="text-gray-400 transition-all" v-html="description"></p>
  </CardSpotlight>
</template>

<script setup>
defineProps({
    icon: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    mousePosition:{
        type: Object,
        required: false,
        default: null
    },
    description: {
        type: String,
        required: true
    }
})
</script>

<style scoped>
@reference "../assets/css/tailwind.css";
  .feature-icon-container{
    @apply text-3xl mb-4 h-8;

    img {
      height: 2.5rem;
    }
  }
</style>
