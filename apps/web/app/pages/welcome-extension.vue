<template>
  <div class="welcome-extension-wrapper">
    <h1>
      {{ $t('shell.welcome_extension.heading') }}
    </h1>

    <Carousel
      class="h-full"
      :features="features"
    />

    <!-- <FeatureGrid :features="features" />  -->
  </div>
</template>

<script>
import { useStore } from '~/stores/myStore'
import { mapWritableState, mapActions } from 'pinia'

export default {
  name: 'WelcomeExtension',
  layout: 'empty',
  
  components: {
  },

  computed: {
    features() {
      const tagline = this.$t('shell.welcome_extension.tagline')
      return [
        {
          imageUrl: '/images/WebBites-Icon.png',
          title: 'WebBites',
          description: tagline,
          html:`
            <div class="hero-logo-wrapper small">
              <div class="hero-logo">
                <img
                  src="/images/WebBites-Icon.png"
                  alt="WebBites Logo"
                />

                <div class="hero-logo-blur">
                </div>
              </div>
            </div>

            <h1 class="text-6xl font-black">
              WebBites
            </h1>
            <p class="text-xl px-6 mt-4">
              ${tagline}
            </p>
        `
        },
        {
          imageUrl: 'https://picsum.photos/536/354',
          title: this.$t('shell.welcome_extension.right_click_title'),
          description: this.$t('shell.welcome_extension.right_click_description')
        },
        {
          imageUrl: 'https://picsum.photos/536/354',
          title: this.$t('shell.welcome_extension.quick_menu_title'),
          description: this.$t('shell.welcome_extension.quick_menu_description')
        },
        {
          imageUrl: 'https://picsum.photos/536/354',
          title: this.$t('shell.welcome_extension.reading_title'),
          description: this.$t('shell.welcome_extension.reading_description')
        },
        {
          imageUrl: 'https://picsum.photos/536/354',
          title: this.$t('shell.welcome_extension.summaries_title'),
          description: this.$t('shell.welcome_extension.summaries_description')
        },
        {
          imageUrl: 'https://picsum.photos/536/354',
          title: this.$t('shell.welcome_extension.listen_title'),
          description: this.$t('shell.welcome_extension.listen_description')
        }
      ]
    }
  },

  methods: {
    ...mapActions(useStore, [
        'startAuthFlow',
    ]),
  }
      

}
</script>
