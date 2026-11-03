<template>
    <section class="statistics py-24 px-4 relative z-10">
        <div class="max-w-7xl mx-auto">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
                <div v-for="stat in stats" :key="stat.label" class="stat-card">
                    <div class="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-400 mb-2">
                        {{ stat.value }}
                    </div>
                    <div class="text-gray-400">{{ stat.label }}</div>
                </div>
            </div>
        </div>
    </section>
</template>

<script setup>
const { t } = useI18n()

const stats = computed(() => [
    {
        value: "10K+",
        label: t('marketing.statistics.active_users')
    },
    {
        value: "1M+",
        label: t('marketing.statistics.bookmarks_saved')
    },
    {
        value: "99%",
        label: t('marketing.statistics.accuracy_rate')
    },
    {
        value: "24/7",
        label: t('marketing.statistics.support')
    }
])
</script>

<style scoped>
@reference "../assets/css/tailwind.css";
.statistics {
    background: linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--color-primary-600) 10%, transparent) 100%);
}

.stat-card {
    @apply p-6 rounded-2xl border border-neutral-700 bg-neutral-800 text-center transition-all duration-300;
    
    &:hover {
        transform: translateY(-5px);
        background: rgba(255, 255, 255, 0.05);
    }
}
</style>
