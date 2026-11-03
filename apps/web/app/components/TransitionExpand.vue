<template>
    <Transition
        name="expand"
        @enter="enter"
        @after-enter="afterEnter"
        @leave="leave"
    >
        <slot/>
    </Transition>
</template>

<script setup>
function enter(element) {
    const width = getComputedStyle(element).width;
    element.style.width = width;
    element.style.position = 'absolute';
    element.style.visibility = 'hidden';
    element.style.height = 'auto';

    // const height = '250px';
    let height = getComputedStyle(element).height;

    element.style.width = null;
    element.style.position = null;
    element.style.visibility = null;
    element.style.height = 0;

    // Force repaint
    getComputedStyle(element).height;

    requestAnimationFrame(() => {
        element.style.height = height;
    });
}

function afterEnter(element) {
    element.style.height = 'auto';
}

function leave(element) {
    const height = getComputedStyle(element).height;

    element.style.height = height;

    // Force repaint
    getComputedStyle(element).height;

    requestAnimationFrame(() => {
        element.style.height = 0;
    });
}
</script>

<style>
.expand-enter-active,
.expand-leave-active {
    transition: height 0.3s ease-in-out;
    overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
    height: 0;
}
</style>
