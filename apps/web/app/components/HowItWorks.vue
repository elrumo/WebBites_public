<template>
    <section class="how-it-works py-24 px-4 relative z-10">
        <div class="max-w-7xl mx-auto">
            <h2 class="text-4xl md:text-5xl font-bold text-center mb-16 bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-400">
                {{ t('landing.how_it_works.title') }}
            </h2>
            <div class="grid md:grid-cols-3 gap-12">
                <div v-for="(step, index) in steps" :key="index" class="step-card">
                    <div class="step-number">{{ index + 1 }}</div>
                    <h3 class="text-xl font-bold mb-4">{{ step.title }}</h3>
                    <p class="text-gray-400">{{ step.description }}</p>
                </div>
            </div>
        </div>
    </section>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
const { t } = useI18n();

const steps = computed(() => [
    {
        title: t('landing.how_it_works.steps.install.title'),
        description: t('landing.how_it_works.steps.install.description')
    },
    {
        title: t('landing.how_it_works.steps.save.title'),
        description: t('landing.how_it_works.steps.save.description')
    },
    {
        title: t('landing.how_it_works.steps.organize.title'),
        description: t('landing.how_it_works.steps.organize.description')
    }
])
</script>

<style scoped>
@reference "../assets/css/tailwind.css";
.how-it-works {
    background: linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--color-primary-600) 10%, transparent) 100%);
}

.step-card {
    @apply p-6 rounded-2xl border border-neutral-700 bg-neutral-800 relative transition-all duration-300;

    &:hover {
        transform: translateY(-5px);
        background: rgba(255, 255, 255, 0.05);
    }
}

.step-number {
    @apply w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white font-bold mb-6;
    box-shadow: 0 0 20px color-mix(in srgb, var(--color-primary-500) 30%, transparent);
}
</style>
