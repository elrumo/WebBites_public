<template>
    <span v-bind="$attrs" class="inline-flex items-center gap-2">
      <!-- <img v-if="isImage || !isText" :class="!imageSize ? 'webbites-logo ' : '_width:'+imageSize" src="@/assets/images/WebBites-Icon.png" alt="">
      <span v-if="isText" class="webbites-logo-title">WebBites</span> -->

      <img
        v-if="isImage || !isText"
        :class="getImageSize()"
        src="@/assets/images/WebBites-Icon.png"
        style="transform: translateZ(20px)"
        alt="WebBites Logo"
      >
      <span v-if="isText || !isImage" class="webbites-logo-title">WebBites</span>
    </span>
</template>

<script setup>
    defineOptions({
        inheritAttrs: false
    })

    const { isImage, imageSize, isText } = defineProps({
        isImage: {
            type: Boolean,
            default: false
        },
        imageSize: {
            type: String,
        },
        isText: {
            type: Boolean,
            default: true
        },
    });

    const getImageSize = () => {
        switch (imageSize) {
            case 'sm':
                return 'w-[32px]'
            case 'md':
                return 'w-[48px]'
            case 'lg':
                return 'w-[64px]'
            default:
                return 'webbites-logo'
        }
    }
</script>

<style>

</style>
