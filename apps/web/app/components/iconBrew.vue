<template>
    <div
        :class="{
            'iconbrew': true,
            'iconbrew-small': true,
            'hover-enabled': hoverEnabled,
        }"
    >
        <UIcon
            :name="mappedIconName"
            :style="{
                width: size + 'px',
                height: size + 'px',
                color: color
            }"
        />
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { getIconForName } from '@/utils/iconBrewMapping'

const props = defineProps({
    icon: {
        type: String,
        required: true
    },
    hoverEnabled: {
        type: Boolean,
        required: false,
        default: false
    },
    filled: {
        type: Boolean,
        required: false,
        default: false
    },
    color: {
        type: String,
        required: false,
        default: "currentColor"
    },
    size: {
        type: Number,
        required: false,
        default: 24
    },
})

const mappedIconName = computed(() => getIconForName(props.icon))
</script>

<style>
.iconbrew {
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
</style>
