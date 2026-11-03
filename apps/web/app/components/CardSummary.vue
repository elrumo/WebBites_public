<template>
    <div
        :class="{
            'summary-card': true,
            'summary-card-compact': compact,
            'inline-summary': inLine,
        }"
    >
        <img
            v-if="
                showImage &&
                (
                    website.OGImage != undefined ||
                    website.OGImage != null &&
                    website.noEmbedCode == null ||
                    (website.subType && website.subType.includes('dribbble'))
                )
            "
            class="featured-image"
            :src="website.OGImage.replace('https://https://', 'https://')"
            @error="setScreenshotError()"
            alt=""
            placeholder
            format="webp"
            quality="40"
            loading="lazy"
        />
        <img
            v-else-if="
                !compact &&
                showImage &&
                website.siteScreenshot != undefined &&
                website.noEmbedCode == null
            "
            class="featured-image"
            :src="typeof website.siteScreenshot.url == 'function' ? website.siteScreenshot.url() : website.siteScreenshot.url"
            alt=""
            @error="setScreenshotError()"
            placeholder
            format="webp"
            quality="40"
            loading="lazy"
        />

        <div class="summary-card-content">
            <div>
                <span
                    v-if="isImage && !compact"
                    :class="isImage ? 'tldr-image' : 'tldr'"
                >
                    {{ $t('website_modal.summary') }}
                </span>

                <UBadge
                    size="xs"
                    variant="solid"
                    class="mb-2"
                    :color="compact ? 'white' : 'black'"
                >
                    {{ $t('website_modal.summary') }}
                </UBadge>

                <p v-if="summary?.whatIsThisPageAbout || summary?.tldr " class="card-summary-title">
                    {{ summary?.whatIsThisPageAbout || summary?.tldr }}
                </p>
            </div>

            <div v-if="summary?.pointsThatBestDescribeThePage && !compact">
                <div class="flex w-full justify-end -mt-1 md:-mt-5">
                    <UButton
                        v-if="summary.pointsThatBestDescribeThePage.length > 0"
                        size="xs"
                        variant="ghost"
                        :icon="isExpanded ? 'i-tabler-chevron-up' : 'i-tabler-chevron-down'"
                        @click="isExpanded = !isExpanded"
                    >
                        {{ isExpanded ? $t('common.show_less') : $t('common.show_more') }}
                    </UButton>
                </div>

                <!-- TODO: Make sure that the summary is always generated using the site's HTML, example of that not happenig: 7JpkAsqzwR -->
                <TransitionExpand>
                    <div v-if="isExpanded" class="summary-card-points mt-2">
                        <div
                            v-for="(point, index) in summary.pointsThatBestDescribeThePage"
                            class="summary-card-point"
                            :style="{
                                animation: `fadeSlideIn 0.3s ease-out forwards`,
                                animationDelay: `${index * 0.1}s`,
                                opacity: 0,
                                transform: 'translateY(10px)'
                            }"
                        >
                            <div class="flex items-start">
                                <div class="mr-1">
                                    {{ point.emojiThatBestRepresentsThePoint  }}
                                </div>
                                <b>
                                    {{ point.title }}
                                </b>
                            </div>

                            <p class="">
                                {{ point.oneLineDescription }}
                            </p>
                        </div>
                    </div>
                </TransitionExpand>
            </div>
        </div>
    </div>
</template>

<script setup>
const props = defineProps({
    website: {},
    summary: {},
    compact: {
        type: Boolean,
        default: false
    },
    inLine: {
        type: Boolean,
        default: false
    },
    showImage: {
        type: Boolean,
        default: false
    }
})

const isExpanded = ref(false);

const setScreenshotError = () => {
    console.log('error')
}


const isImage = computed(() => {
    let isImage =
        props.compact &&
        (
            props.showImage &&
            (
                (
                    props.website.OGImage != undefined ||
                    props.website.OGImage != null &&
                    props.website.noEmbedCode == null ||
                    (props.website.subType && props.website.subType.includes('dribbble'))
                )
            )
            ||
            (
                props.website.siteScreenshot != undefined &&
                props.website.noEmbedCode == null
            )
        )

    return isImage
})
</script>

<style>
@keyframes fadeSlideIn {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>
