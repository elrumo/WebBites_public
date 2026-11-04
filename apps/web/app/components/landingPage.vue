<template>
  <div>
    <LandingNavBar/>

    <img class="fixed top-0 left-0 w-screen h-screen mix-blend-multiply opacity-40 pointer-events-none" src="/images/grain_2.webp"/>

      <!-- Hero Section -->
      <div class="parallax relative">
        <div class="hero-wrapper">
          <div class="hero-content dark">
              <h1 class="hero-title">
                {{ $t('landing_page.hero.title') }}
                  <br>
                  <span class="block text-primary font-black">
                    {{ $t('landing_page.hero.title_emphasis') }}
                  </span>
              </h1>
              <p class="hero-subtitle">
                  {{ $t('landing_page.hero.subtitle') }}
              </p>

              <!-- v-if="!isLoggedIn" -->
              <div class="flex flex-col gap-3 items-center">
                <UButton
                  v-if="!currentUser"
                  color="neutral" variant="solid"
                  class="rounded-full font-bold"
                  size="xl"
                  @click="startAuthFlow"
                >
                  <!-- Join for free -->
                  {{ $t('landing.join_now_free') }}
                </UButton>

                <UButton
                  v-else
                  color="neutral" variant="solid"
                  class="rounded-full font-bold"
                  to="/app"
                  size="xl"
                >
                  {{ $t('landing.hero.app_button') }}
                </UButton>

                <!-- Sign in with Apple -->
                 <!-- <ClientOnly> -->
                  <SignInWithApple 
                    v-if="!currentUser"
                    :compact="true" 
                  />
                <!-- </ClientOnly> -->
              </div>
          </div>

          <!-- Hero Logo -->
          <div class="hero-logo-wrapper">
            <div class="hero-logo">
              <div v-tilt="tiltOptionsLogo">
                <NuxtImg
                  @click="startAuthFlow"
                  src="/images/WebBites-Icon.png"
                  :alt="$t('landing_page.hero.logo_alt')"
                  format="webp"
                  quality="90"
                  loading="eager"
                  fetchpriority="high"
                />
              </div>
            </div>
            <div class="hero-logo-blur">
            </div>
          </div>
        </div>

        <!-- Bookmark cards — decorative, so they never intercept taps meant
             for the hero buttons they overlap. -->
        <div class="absolute h-[78vh] w-full max-w-screen top-0 mx-auto pointer-events-none">
          <div class="images-sticky-wrapper">
              <div class="parallax-layer-1 parallax-layer'">
                <div v-tilt="tiltOptions">
                  <NuxtImg
                    id="bookmarksLanding"
                    src="/images/bookmarks/bookmark1.jpg"
                    alt="bookmarksLanding"
                    loading="eager"
                    fetchpriority="high"
                    format="webp"
                    quality="40"
                    placeholder
                    data-tilt
                  />
                </div>
              </div>

              <div class="parallax-layer-2 parallax-layer'">
                <div v-tilt="tiltOptions">
                  <NuxtImg
                    id="bookmarksLanding"
                    src="/images/bookmarks/bookmark2.jpg"
                    alt="bookmarksLanding"
                    loading="eager"
                    fetchpriority="high"
                    format="webp"
                    quality="40"
                    placeholder
                    data-tilt
                  />
                </div>
              </div>
              <div class="parallax-layer-3 parallax-layer'">
                  <div v-tilt="tiltOptions">
                      <NuxtImg
                          id="bookmarksLanding"
                          src="/images/bookmarks/bookmark3.jpg"
                          alt="bookmarksLanding"
                          loading="eager"
                          fetchpriority="high"
                          format="webp"
                          quality="40"
                          placeholder
                          data-tilt
                      />
                  </div>
              </div>
              <div class="parallax-layer-4 parallax-layer'">
                  <div v-tilt="tiltOptions">
                      <NuxtImg
                          id="bookmarksLanding"
                          src="/images/bookmarks/bookmark4.jpg"
                          alt="bookmarksLanding"
                          loading="eager"
                          fetchpriority="high"
                          format="webp"
                          quality="40"
                          placeholder
                          data-tilt
                      />
                  </div>
              </div>
          </div>
        </div>
        
        <div fetchpriority=high class="landing-bg"></div>

        <!-- App screenshot -->
        <ContainerScroll>
          <template #title>
            <h1 class="text-4xl font-semibold text-white mb-10">
              {{ $t('landing_page.scroll.title') }}
              <br />
              <span class="mt-1 text-4xl leading-none md:text-[6rem] landing-page-title">
                {{ $t('landing_page.scroll.title_emphasis') }}
              </span>
            </h1>
          </template>

          <template #card>
            <div ref="browserFrameRef">
              <motion.div class="browser-frame" :style="{ y: browserParallaxY }">
                <div class="browser-frame-bar">
                  <div class="browser-frame-dots">
                    <span></span><span></span><span></span>
                  </div>
                  <div class="browser-frame-url">webbites.io</div>
                </div>
                <NuxtImg
                  src="/images/WebBites_Screenshot.jpg"
                  class="browser-frame-image"
                  :alt="$t('landing_page.scroll.browser_alt')"
                  height="880"
                  width="1400"
                />
              </motion.div>
            </div>
          </template>
        </ContainerScroll>
      </div>

    <!-- <ClientOnly> -->
      <div class="flex flex-col items-center max-w-5xl w-[90%] m-auto relative z-0">

        <!-- Main Features -->
        <div id="features" class="features-section pt-10 pb-12" ref="featuresSectionRef">
          <div class="flex flex-col md:flex-row flex-wrap justify-center gap-10 max-w-4xl mx-auto">
            <motion.div
              v-for="(feature, index) in mainFeatures"
              :key="index"
              :style="{
                y: featureYPositions[index],
                scale: featureScaleValues[index],
              }"
              class="feature-card-wrapper"
              :ref="el => featureCardRefs[index] = el"
            >
              <CardSpotlight
                class="main-feature-card"
                gradient-color="#41d97665"
                :gradientSize="200"
              >
                <div class="p-6 pb-6 relative z-10">
                  <div class="text-3xl mb-4">
                    <div v-html="feature.icon"></div>
                  </div>

                  <h3 class="text-3xl font-bold mb-3">{{ feature.title }}</h3>
                  <p class="text-gray-400 font-medium text-lg transition-all">{{ feature.description }}</p>
                </div>

                <div class="main-feature-card-image">
                  <img :src="feature.image" />
                </div>
              </CardSpotlight>
            </motion.div>
          </div>
        </div>

        <!-- Save anything -->
        <ClientOnly>
          <div class="mx-auto h-[80vh] flex items-center justify-center z-[5]">
            <motion.div
              class="sticky md:top-[40vh] md:pb-24"
              :style="{
                scale: textScrollRevealProgress,
                opacity: textScrollRevealProgress,
                y: textScrollRevealY
              }"
            >
              <p
                ref="textScrollRevealRef"
                class="text-center text-5xl md:text-6xl font-bold text-neutral-200 leading-[115%] md:leading-normal transition opacity-100 -mt-16 relative"
                :class="{
                  'text-neutral-700': linkPreviewIndexHover !== null
                }"
              >
                <i18n-t keypath="landing_page.save_anything.sentence" tag="span">
                  <template
                    v-for="(bookmark, index) in [
                      {slot: 'websites', text: $t('landing_page.save_anything.websites') + ' ',  class:'shadow-primary from-primary-400 to-primary-600', img: '/images/websites.jpg', height: 370, width: 350},
                      {slot: 'images', text: $t('landing_page.save_anything.images') + ' ',  class:'shadow-purple from-purple-400 to-purple-600', img: '/images/images.jpg', height: 270, width: 320},
                      {slot: 'movies', text: $t('landing_page.save_anything.movies') + ' ',  class:'shadow-blue from-blue-400 to-blue-600', img: '/images/movies.jpg', height: 270, width: 350},
                      {slot: 'games', text: $t('landing_page.save_anything.games') + ' ', class:'shadow-lime from-lime-400 to-lime-600', img: '/images/games2.jpg', height: 270, width: 350},
                    ]"
                    #[bookmark.slot]
                  >
                    <span>
                      <LinkPreview
                        :image="bookmark.img"
                        :width="bookmark.width"
                        :height="bookmark.height"
                        :linkClass="`link-preview-word ${bookmark.class} ${index === 0 ? '!ml-1 md:!-ml-3' : '!ml-2 md:!ml-[2px]'} ${linkPreviewIndexHover == index || linkPreviewIndexHover == null ? '' : 'opacity-50' } ${index === 3? '!mr-[2px] md:!-mr-2' : ''}`"
                        @mouseenter="linkPreviewIndexHover = index"
                        @mouseleave="linkPreviewIndexHover = null"
                      >
                        {{ bookmark.text }}
                      </LinkPreview>
                      <span v-if="index != 3" :class="`ml-2 md:-ml-1.5 `">,</span>
                    </span>
                  </template>
                  <template #notes>
                    <LinkPreview
                      image="/images/notes.jpg"
                      :width="350"
                      :height="290"
                      :linkClass="`link-preview-word from-teal-400 to-sky-500 !mr-1 !ml-1 md:!ml-0 md:!-mr-3 ${linkPreviewIndexHover == 4 || linkPreviewIndexHover == null ? '' : 'opacity-50'}`"
                      @mouseenter="linkPreviewIndexHover = 4"
                      @mouseleave="linkPreviewIndexHover = null"
                    >
                      {{ $t('landing_page.save_anything.notes') }}
                    </LinkPreview>
                  </template>
                </i18n-t>
              </p>
            </motion.div>
          </div>
        </ClientOnly>

        <!-- <TextScrollReveal text="WebBites will then auto tag all your bookmarks using AI so you can focus on the finding, not the organising." /> -->

        <!-- Feeds — the second way things reach the library. The Mac reader is
             the same window as the native section below, so the two read as
             one app rather than a separate RSS product. -->
        <section id="feeds" class="native-section">
          <div class="flex flex-col items-center gap-3 text-center">
            <h2 class="landing-page-title text-3xl md:text-5xl">
              {{ $t('landing_page.feeds.title') }}
            </h2>
            <p class="hero-subtitle !max-w-xl">
              {{ $t('landing_page.feeds.description') }}
            </p>
          </div>

          <div class="native-stage !pb-0">
            <div class="native-mac">
              <div class="mac-frame-camera"></div>
              <NuxtImg
                src="/images/native/macos-reader.jpg"
                :alt="$t('landing_page.feeds.image_alt')"
                width="2400"
                height="1500"
                format="webp"
                quality="70"
                loading="lazy"
              />
            </div>
          </div>
        </section>

        <!-- Platforms — the same wall the browser shows, one section below it,
             so the captures read as the same library rather than a second
             product. Only the two native apps are pictured: the browser is the
             hero screenshot directly above, and a third window would be
             indistinguishable from the Mac one. The Mac and the phone overlap on
             purpose — two separate rounded cards side by side would say "two
             apps", which is the opposite of the point. -->
        <section id="native" class="native-section">
          <div class="flex flex-col items-center gap-3 text-center">
            <h2 class="landing-page-title text-3xl md:text-5xl">
              {{ $t('landing_page.native.title') }}
            </h2>
            <p class="hero-subtitle !max-w-xl">
              {{ $t('landing_page.native.description') }}
            </p>
          </div>

          <div class="native-stage" ref="nativeStageRef">
            <motion.div class="native-mac" :style="{ y: macParallaxY }">
              <div class="mac-frame-camera"></div>
              <NuxtImg
                src="/images/native/macos-dark.jpg"
                :alt="$t('landing_page.native.mac_alt')"
                width="2400"
                height="1181"
                format="webp"
                quality="70"
                loading="lazy"
              />
            </motion.div>

            <motion.div class="native-phone" :style="{ y: phoneParallaxY }">
              <div class="phone-frame-notch"></div>
              <NuxtImg
                src="/images/native/ios-dark.jpg"
                :alt="$t('landing_page.native.phone_alt')"
                width="506"
                height="1100"
                format="webp"
                quality="70"
                loading="lazy"
              />
            </motion.div>
          </div>
        </section>

        <!-- Plans cards -->
        <PlansCards
          id="pricing"
          class="md:pt-12 mb-0"
          :isSignUp="true"
          :showApplePlan="true"
        />

        <!-- Where the library lives — the one place the account / device split
             is explained (docs/POSITIONING.md). Said once, plainly, under the
             two cards it is about. -->
        <div class="where-section">
          <h3 class="text-xl md:text-2xl font-semibold text-white">{{ $t('landing_page.where.title') }}</h3>
          <p class="text-neutral-400">{{ $t('landing_page.where.separate') }}</p>
          <ul class="where-rules">
            <li><span class="text-white font-semibold">{{ $t('landing_page.where.account') }}</span> {{ $t('landing_page.where.account_when') }}</li>
            <li><span class="text-white font-semibold">{{ $t('landing_page.where.device') }}</span> {{ $t('landing_page.where.device_when') }}</li>
          </ul>
        </div>

        <!-- How it works timeline -->
        <!-- <div class="h-fit w-full relative -mt-10">
          <Timeline
            :items="timelineData"
            title="How it works"
            :offset="200"
          />
        </div> -->

        <!-- More Features -->
        <div class="how-it-works-section">
          <div class="flex flex-col md:flex-row gap-8 mx-auto pb-10 pt-0 md:pt-20 md:pb-20">
            <div class="sticky top-20 md:top-24 flex flex-col gap-2 md:gap-4 md:pt-4 md:pb-3 pb-2 pt-2 h-fit w-[90%] md:w-full mx-auto z-10 items-center md:items-start text-center md:!text-left bg-neutral-800/70 backdrop-blur-md border border-neutral-700 md:bg-transparent md:backdrop-blur-none md:border-none rounded-xl shadow-lg md:shadow-none">
              <h2 class="relative text-3xl md:text-5xl landing-page-title text-shadow-green">
                {{ $t('landing.more_features') }}
              </h2>
              <!-- <p class="hero-subtitle max-w-2xl"> -->
                <!-- And this is only getting started, more features like mobile apps are coming soon! -->
              <!-- </p> -->
            </div>

            <FeatureGrid :columnNumber="2" :features="moreFeatures" />
          </div>
        </div>
        
        <div class="how-it-works-section flex flex-col-reverse md:!flex-row gap-8 mx-auto pb-10 pt-0 md:pt-20 md:pb-20 w-full">
          <div class="sticky top-20 md:top-24 flex flex-col gap-2 md:gap-4 md:pt-4 md:pb-3 pb-2 pt-2 h-fit w-[90%] md:max-w-[31%] mx-auto z-10 items-center md:items-start text-center md:!text-right bg-neutral-800/70 backdrop-blur-md border border-neutral-700 md:bg-transparent md:backdrop-blur-none md:border-none rounded-xl shadow-lg md:shadow-none dark">
            <h2 class="relative text-3xl md:text-5xl landing-page-title text-shadow-green">
              {{ $t('landing.roadmap.title') }}
            </h2>
            <UButton
              color="neutral"
              to="/feedback"
              class="font-bold rounded-xl mt-2"
              size="xl"
            >
              {{ $t('landing.roadmap.viewFull') }}
            </UButton>
          </div>

          <div class="flex flex-col gap-14 items-stretch w-full">
            <div class="flex flex-col gap-2">
              <h2 class="relative text-2xl md:text-xl font-semibold text-white pb-1 w-full text-start">
                {{ $t('landing.roadmap.workingOn') }}
              </h2>

              <div class="feature-grid grid-cols-1 md:grid-cols-2">
              <!-- <div class="flex flex-row flex-wrap gap-4"> -->
                <FeatureCard
                  v-for="item in feedback.filter(item => item.status === 'in-progress')"
                  :key="item.title"
                  :title="item.title"
                  :icon="item.icon || '🔜'"
                  :description="item.changelogBody || item.body"
                  class="w-full h-fit"
                />
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <h2 class="relative text-2xl md:text-xl font-semibold text-white pb-1 w-full text-start">
                {{ $t('landing.roadmap.next') }}
              </h2>
              <div class="feature-grid grid-cols-1 md:grid-cols-2">
              <!-- <div class="flex flex-row gap-4 flex-wrap"> -->
                <FeatureCard
                  v-for="item in feedback.filter(item => item.status === 'backlog')"
                  :key="item.title"
                  :title="item.title"
                  :icon="item.icon || '🔜'"
                  :description="item.changelogBody || item.body"
                  class="w-full h-fit"
                />

                <FeatureCard
                  :title="$t('landing_page.roadmap_more.title')"
                  icon="➕"
                  :description="$t('landing_page.roadmap_more.description')"
                  class="w-full h-fit"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Development Roadmap -->

        <!-- Developers -->
        <div id="developers" class="dev-section w-full py-16 md:py-24">
          <div class="grid gap-8 md:gap-10 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start">
            <div class="flex flex-col gap-4 text-center md:!text-left items-center md:items-start">
              <h2 class="landing-page-title text-3xl md:text-4xl leading-tight">
                {{ $t('landing_page.developers.title') }}
              </h2>
              <p class="text-neutral-400 text-base md:text-lg max-w-md">
                {{ $t('landing_page.developers.description') }}
              </p>

              <ul class="flex flex-col gap-3 text-left mt-1">
                <li v-for="fact in devFacts" :key="fact.title" class="dev-fact">
                  <span class="font-semibold text-white">{{ fact.title }}</span>
                  <span class="text-neutral-400"> — {{ fact.text }}</span>
                </li>
              </ul>

              <UButton
                color="neutral"
                variant="solid"
                to="/developers"
                size="lg"
                class="rounded-full font-bold mt-2 w-fit"
              >
                {{ $t('landing_page.developers.docs_button') }}
              </UButton>
            </div>

            <div class="dev-panel">
              <div class="dev-panel-bar">
                <div class="flex gap-1">
                  <button
                    v-for="sample in devSamples"
                    :key="sample.id"
                    type="button"
                    class="dev-tab"
                    :class="{ 'dev-tab-active': devTab === sample.id }"
                    @click="devTab = sample.id"
                  >
                    {{ sample.label }}
                  </button>
                </div>
                <code class="hidden sm:block text-xs text-neutral-500 font-mono">{{ devSample.hint }}</code>
              </div>

              <pre class="dev-panel-code"><code v-html="highlightCode(devSample.code)"></code></pre>
            </div>
          </div>
        </div>

        <!-- Beta Access Section -->
        <div class="info-landing-wrapper py-40">
          <div class="flex flex-col gap-4 items-center pb-24">
            <h2 class="landing-page-title text-4xl md:text-5xl text-center pb-1">
                {{ $t('landing.beta_access.title') }}
            </h2>
            <p class="hero-subtitle max-w-2xl">
                {{ $t('landing.beta_access.description') }}
            </p>

            <div class="flex flex-col items-center gap-6">
              <div class="flex gap-4 dark pt-2">
                <UButton
                  color="neutral"
                  to="/feedback"
                  size="lg"
                  variant="soft"
                  class="font-bold rounded-full"
                >
                  {{ $t('landing.beta_access.feedback_button') }}
                </UButton>

                <UButton
                  color="neutral"
                  :to="'/changes'"
                  size="lg"
                  variant="soft"
                  class="font-bold rounded-full"
                >
                  {{ $t('landing.beta_access.changelog_button') }}
                </UButton>

                <UButton
                  color="neutral"
                  to="/developers"
                  size="lg"
                  variant="soft"
                  class="font-bold rounded-full"
                >
                  {{ $t('navigation.developers') }}
                </UButton>

                <!-- <UButton
                  color="neutral"
                  size="lg"
                  class="font-bold rounded-xl"
                  @click="showSentryReportDialog"
                >
                  Report Issue
                </UButton> -->
              </div>

              <UButton
                v-if="!isLoggedIn"
                color="neutral" variant="solid"
                class="rounded-full font-bold w-fit bg-white text-black hover:bg-primary hover:text-white hover:scale-105 mt-2"
                size="xl"
                @click="startAuthFlow"
              >
                {{ $t('landing.join_now_free') }}
              </UButton>

              <UButton
                v-else
                color="neutral" variant="solid"
                class="rounded-full font-bold w-fit bg-white text-black hover:bg-white hover:scale-105"
                to="/app"
                size="xl"
              >
                {{ $t('landing.hero.app_button') }}
              </UButton>
            </div>
          </div>
        </div>

        <!-- Testimonials Section -->
        <!-- <div class="testimonials-section">
          <Testimonials/>
        </div> -->

        <!-- TODO: Finish copy and images -->
        <!-- What's next? -->
        <!-- <div class="how-it-works-section">
          <div class="container mx-auto px-4 py-20">
            <h2 class="text-4xl md:text-5xl font-bold text-center mb-16 bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-400">
              {{ $t('landing.whats_next') }}
            </h2>

            <FeatureGrid :features="whatsNext" :columnNumber="3" />
          </div>
        </div> -->

        <!-- Why go premium -->
        <!-- TODO: Finish explaining wy go premium -->
        <!-- <div class="flex w-full justify-center">
          <div
            class="rounded-3xl border p-3 border-neutral-700 bg-neutral-900 shadow-xl"
          >
            <Compare
              first-image="https://images.vscodethemes.com/antfu.theme-vitesse/vitesse-light-soft-js-preview-4JM.svg"
              second-image="https://images.vscodethemes.com/antfu.theme-vitesse/vitesse-dark-soft-js-preview-4JM.svg"
              first-content-class="object-cover object-left-top rounded-xl overflow-hidden"
              second-content-class="object-cover object-left-top rounded-xl overflow-hidden"
              class="h-[250px] w-[200px] md:h-96 md:w-[500px]"
              slide-mode="hover"
            >
            </Compare>
          </div>
        </div> -->

        <!-- Newsletter Section -->
        <!-- <div class="newsletter-section">
            <div class="container mx-auto px-4 py-16">
                <div class="newsletter-card">
                    <h2 class="text-3xl font-bold mb-4">Stay Updated</h2>
                    <p class="mb-6">Subscribe to our newsletter for the latest features and updates.</p>
                    <div class="flex flex-col sm:flex-row gap-3">
                        <UInput placeholder="Enter your email" class="flex-1" size="lg" />
                        <UButton color="primary" size="lg" class="font-bold rounded-xl">
                            Subscribe
                        </UButton>
                    </div>
                </div>
            </div>
        </div> -->

        <!-- FAQ Section -->
        <!-- <div class="faq-section">
            <div class="container mx-auto px-4 py-20">
                <h2 class="text-4xl md:text-5xl font-bold text-center mb-16 bg-clip-text text-transparent bg-gradient-to-r from-white to-primary-400">
                    Frequently Asked Questions
                </h2>

                <div class="max-w-3xl mx-auto">
                    <UAccordion :items="faqs" class="bg-transparent">
                        <template #default="{ item, index, open }">
                            <div class="faq-item">
                                <h3 class="text-xl font-bold">{{ item.question }}</h3>
                                <p v-if="open" class="mt-2 text-gray-300">{{ item.answer }}</p>
                            </div>
                        </template>
                    </UAccordion>
                </div>
            </div>
        </div> -->

      </div>
    <!-- </ClientOnly> -->

    <LandingFooter />
  </div>
</template>

<script setup>
import { useStore } from '~/stores/myStore'
import { ref, onMounted, onBeforeUnmount, onUnmounted, computed, watchEffect, nextTick } from 'vue'
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useScroll, useTransform, useSpring, motion, useMotionValue } from 'motion-v'
import landingPageData from './landingPageData.js'
import { vTilt } from '~/utils/vanillaTilt'
/* import * as Sentry from '@sentry/nuxt' */
const { t } = useI18n();

const route = useRoute();
const store = useStore()

const { 
  startAuthFlow,
  getBadgeColor,
} = store;

const { 
  currentUser, 
  isLoggedIn,
  feedback
} = storeToRefs(store)

const tiltOptionsLogo = ref({
  max: 5,
  speed: 400,
  glare: false,
  "mouse-event-element": ".parallax",
})

const tiltOptions = ref({
  max: 15,
  speed: 400,
  glare: false,
  "max-glare": 1,
})

// Icons and images live in landingPageData; the words come from the locale files.
// Two titles already exist under `landing.features`, so they are reused.
const sharedFeatureTitles = {
  ai_organisation: 'landing.features.ai_organization.title',
  cross_platform: 'landing.features.cross_platform.title',
}
const withText = (feature) => ({
  ...feature,
  title: t(sharedFeatureTitles[feature.id] ?? `landing_page.features.${feature.id}.title`),
  description: t(`landing_page.features.${feature.id}.description`),
})
const mainFeatures = computed(() => landingPageData.features.map(withText))
const moreFeatures = computed(() => landingPageData.moreFeatures.map(withText))
const whatsNext = landingPageData.whatsNext
const timelineData = landingPageData.timelineData;
const faqs = ref(landingPageData.faqs);
const scrollHandler = ref(null);
const linkPreviewIndexHover = ref(null);

// Developer section. The samples are the real /v1/api surface documented on
// /developers — keep them in step with ENDPOINTS there if the API moves.
const devFacts = computed(() => [
  { title: t('landing_page.developers.facts.rest.title'), text: t('landing_page.developers.facts.rest.text') },
  { title: t('landing_page.developers.facts.webhooks.title'), text: t('landing_page.developers.facts.webhooks.text') },
  { title: t('landing_page.developers.facts.keys.title'), text: t('landing_page.developers.facts.keys.text') },
])

const devSamples = computed(() => [
  {
    id: 'save',
    label: t('landing_page.developers.samples.save'),
    hint: 'POST /bookmarks',
    code: `curl -X POST https://api.webbites.io/v1/api/bookmarks \\
  -H "Authorization: Bearer $WEBBITES_KEY" \\
  -d url=https://example.com/article \\
  -d tags=reading,ai

# { "id": "abc123", "status": "processing" }`,
  },
  {
    id: 'search',
    label: t('landing_page.developers.samples.search'),
    hint: 'GET /bookmarks',
    code: `const res = await fetch(
  'https://api.webbites.io/v1/api/bookmarks?q=typography&limit=5',
  { headers: { Authorization: 'Bearer ' + process.env.WEBBITES_KEY } }
)

const { bookmarks, nextBefore } = await res.json()
// each one carries its AI summary, auto-tags and screenshot`,
  },
  {
    id: 'webhook',
    label: t('landing_page.developers.samples.webhook'),
    hint: 'bookmark.saved',
    code: `app.post('/webbites', (req, res) => {
  const { event, data } = req.body
  // "bookmark.saved" — the AI has finished with it
  console.log(data.title, data.tags, data.summary)
  res.sendStatus(200)
})`,
  },
])

const devTab = ref('save')
const devSample = computed(() => devSamples.value.find(s => s.id === devTab.value) || devSamples.value[0])

// ponytail: three-token highlighter over these fixed samples. Line-anchored so
// the `//` in an https:// URL is not mistaken for a comment. Swap in Shiki only
// if code ever arrives from outside this file.
const highlightCode = (code) => code
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(
    /(^\s*(?:#|\/\/).*$|\s\/\/.*$)|("[^"]*"|'[^']*')|\b(curl|await|const|function|return)\b/gm,
    (match, comment, string) =>
      `<span class="${comment ? 'tok-comment' : string ? 'tok-string' : 'tok-keyword'}">${match}</span>`
  )

const textScrollRevealRef = ref(null);
const scrollHandlerRef = ref(null)

const featuresSectionRef = ref(null)
const featureYPositions = ref([])
const featureScaleValues = ref([])
const featureCardRefs = ref([])

const nativeStageRef = ref(null)
const browserFrameRef = ref(null)
const macParallaxY = ref(0)
const phoneParallaxY = ref(0)
const browserParallaxY = ref(0)

const textScrollRevealProgress = ref()
const textScrollRevealY = ref()
const scrollYProgress = ref()
const motionY = ref([])
const motionScale = ref([])

const isFeedbackLoading = ref(false)
const feedbackApi = useFeedbackApi()


/* function showSentryReportDialog() { */
/*   Sentry.showReportDialog({ */
/*     user: { */
/*       email: currentUser.value?.get('email') || '', */
/*       name: currentUser.value?.get('username') || '' */
/*     }, */
/*     title: 'Reportar un problema', */
/*     subtitle: 'Ayudanos a mejorar reportando cualquier problema que encuentres', */
/*     subtitle2: 'Tu retroalimentación es valiosa para nosotros!', */
/*     labelName: 'Nombre', */
/*     labelComments: 'Describe el problema', */
/*     labelSubmit: 'Enviar Reporte', */
/*     labelClose: 'Cerrar', */
/*     errorGeneric: 'Ocurrió un error al enviar tu reporte. Por favor, inténtalo de nuevo.', */
/*     errorFormEntry: 'Algunos campos son inválidos. Por favor, corrige ellos y inténtalo de nuevo.', */
/*     successMessage: 'Gracias por tu reporte! Nosotros lo revisaremos pronto.' */
/*   }) */
/* } */


function setupParallaxEffects() {
  const parallax = document.querySelector('.parallax')
  const bookmarkImgs = document.querySelectorAll('#bookmarksLanding')
  const logoImg = document.querySelector('.hero-logo')
  const logoImgBlur = document.querySelector('.hero-logo-blur')
  const landingBg = document.querySelector('.landing-bg')
  const imagesStickyWrapper = document.querySelector('.images-sticky-wrapper')
  const windowHeight = window.innerHeight

  if (!parallax) {
    console.log("no parallax")
    return
  }

  // Initialize images-sticky-wrapper position immediately
  if (imagesStickyWrapper) {
    const initialScrolled = window.scrollY
    const stickyImagesScale = Math.max(0, 1 - (initialScrolled * 0.5) / 100)
    const stickyImagesY = Math.max(0, ((initialScrolled / windowHeight) * 4) * 100)
    const stickyImagesTranslate = `-50%, ${stickyImagesY}%`
    imagesStickyWrapper.style.transform = `scale(${stickyImagesScale}) translate(${stickyImagesTranslate})`
  }

  // Setup scroll handler for other elements
  const scrollHandler = () => {
    const scrolled = window.scrollY

    let scaleNum = Math.max(0, 1 - (scrolled * 0.2) / 100)

    if(scaleNum < 0.1) {
      if (imagesStickyWrapper) {
        imagesStickyWrapper.style.opacity = 0
      }
      return
    } else {
      if (imagesStickyWrapper) {
        imagesStickyWrapper.style.opacity = 1
      }
    }

    let blur = `blur(${scrolled < 150 ? (scrolled * 0.2) / 10 : 4}px)`
    let opacity = `${Math.max(0, 1 - (scrolled * 0.2) / 100)}`

    if (imagesStickyWrapper) {
      const stickyImagesScale = Math.max(0, 1 - (scrolled * 0.5) / 100)
      const stickyImagesY = Math.max(0, ((scrolled / windowHeight) * 4) * 100)
      const stickyImagesTranslate = `-50%, ${stickyImagesY}%`
      imagesStickyWrapper.style.transform = `scale(${stickyImagesScale}) translate(${stickyImagesTranslate})`
    }

    if(landingBg){
      landingBg.style.translate = `0px ${scrolled * 0.2}px 0px`
    }

    if(logoImg && logoImgBlur){
      let yLogoTranslate = ((scrolled / windowHeight) * 0.55) * 100

      let logoTranslate = `0px ${yLogoTranslate}% 0px`
      let logoScale = Math.max(0, 1 - (scrolled * 0.1) / 100)
      logoImg.style.translate = logoTranslate
      logoImg.style.scale = logoScale

      logoImgBlur.style.translate = logoTranslate
      logoImgBlur.style.scale = logoScale
    }

    bookmarkImgs.forEach((layer, index) => {
      const direction = index < 2 ? 1 : -1
      // Add slight speed difference based on index
      const speedMultiplier = 0.05 + (index * 0.05)
      const rotate = `${scrolled * speedMultiplier * direction}deg`

      layer.style.opacity = opacity
      layer.style.rotate = rotate
    })
  }

  // Add the event listener to window scroll
  window.addEventListener('scroll', scrollHandler)

  // Store the handler for cleanup
  scrollHandlerRef.value = scrollHandler
}

const fetchFeedback = async () => {
  isFeedbackLoading.value = true;
  try {
    // Featured posts from the HelpBites board that are being worked on or next up.
    const result = await feedbackApi.list({ status: 'in-progress,backlog', featured: 1, sort: 'top', limit: 100 }, 'none');
    feedback.value = result.posts;
  } catch (error) {
    console.log("error: ", error);
  } finally{
    isFeedbackLoading.value = false;
  }
};


onMounted(() => {
  // Initialize all motion-v composables FIRST in onMounted, before any other operations
  // This ensures lifecycle hooks are registered before any async operations

  const showLogin = Boolean(route.query.login);
  if(showLogin) startAuthFlow()

  // Setup text scroll reveal
  const { scrollYProgress: textScrollProgress } = useScroll({
    target: textScrollRevealRef,
    offset: ["-0.5 end", "0.5 0.65"],
  })

  const textScrollYPosition = useTransform(
    textScrollProgress,
    [0.9, 1.5],
    [0, 200],
  );

  textScrollRevealY.value = textScrollYPosition;
  textScrollRevealProgress.value = textScrollProgress;

  // Initialize section scroll for features
  const { scrollYProgress: featuresScrollProgress } = useScroll({
    target: featuresSectionRef,
    offset: ["start end", "50% 30%"],
  })

  // Pre-initialize transforms for all feature cards
  for (let i = 0; i < mainFeatures.value.length; i++) {
    const cardStartThreshold = 0.1 + (i * 0.1)
    const cardEndThreshold = 0.5 + (i * 0.1)
    const startingOffset = 200 + (i * 100)

    featureYPositions.value[i] = useTransform(
      featuresScrollProgress,
      [cardStartThreshold, cardEndThreshold],
      [startingOffset, 0]
    )

    featureScaleValues.value[i] = useTransform(
      featuresScrollProgress,
      [cardStartThreshold, cardEndThreshold],
      [0.6, 1]
    )
  }

  scrollYProgress.value = useScroll().scrollYProgress

  // Native apps + hero screenshot parallax — the browser, Mac and phone
  // captures drift at different speeds as their section crosses the
  // viewport, so "same library, three surfaces" reads as depth rather than
  // a flat row of screenshots.
  const { scrollYProgress: nativeScrollProgress } = useScroll({
    target: nativeStageRef,
    offset: ["start end", "end start"],
  })
  macParallaxY.value = useTransform(nativeScrollProgress, [0, 1], [-35, 35])
  phoneParallaxY.value = useTransform(nativeScrollProgress, [0, 1], [-70, 70])

  const { scrollYProgress: browserScrollProgress } = useScroll({
    target: browserFrameRef,
    offset: ["start end", "end start"],
  })
  browserParallaxY.value = useTransform(browserScrollProgress, [0, 1], [-20, 20])

  // Defer non-critical animations until browser is idle
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => {
      setupParallaxEffects()
    }, { timeout: 2000 })
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      setupParallaxEffects()
    }, 100)
  }

  fetchFeedback()
})

onBeforeUnmount(() => {
  if (scrollHandlerRef.value) {
    window.removeEventListener('scroll', scrollHandlerRef.value)
  }

  if (scrollHandler.value) {
    window.removeEventListener('scroll', scrollHandler.value)
    scrollHandler.value = null
  }

  try {
    const parallax = document.querySelector('.parallax')
    if (parallax) {
        parallax.removeEventListener('scroll', () => {})
    }
  } catch (error) {
      console.log("error removing parallax: ", error)
  }

  try {
      const landingPageWrapper = document.getElementsByClassName('landing-page-wrapper')[0]
      if (landingPageWrapper) {
          landingPageWrapper.parentNode.removeChild(landingPageWrapper)
      }
  } catch (error) {
      console.log("error removing landingPageWrapper: ", error)
  }
})
</script>


<style scoped>
@reference "../assets/css/tailwind.css";

/* Native apps section.

   The bezels are drawn in CSS rather than baked into the captures so the two
   raw App Store screenshots stay reusable, and so the phone's corner radius
   still looks right when the image scales down. */
/* "Where your library lives", under the pricing cards. */
.where-section {
  @apply w-full max-w-3xl flex flex-col gap-3 text-left mt-6 mb-10 px-6 py-5 rounded-2xl border border-neutral-700 bg-neutral-900/60;
}

.where-rules {
  @apply flex flex-col gap-2 text-neutral-400;
}

.native-section {
  @apply w-full flex flex-col items-center gap-8 md:gap-10 pt-16 pb-6 md:pt-24 md:pb-10;
}

.native-stage {
  @apply relative w-full max-w-4xl;
  /* Room at the bottom for the part of the phone that hangs past the Mac. */
  @apply pb-16 md:pb-20;
}

.native-mac {
  /* Thicker border reads as the MacBook's screen bezel rather than a plain
     card outline. */
  @apply relative rounded-xl md:rounded-2xl overflow-hidden shadow-2xl bg-neutral-800;
  @apply border-[6px] md:border-[10px] border-neutral-800;
}

.native-mac img {
  @apply block w-full h-auto rounded-[2px];
}

/* The camera notch dot at the top-center of the bezel — the one detail that
   sells "laptop screen" instead of "screenshot in a rounded box". */
.mac-frame-camera {
  @apply absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-black z-10;
}

/* Sits on the Mac's lower-right corner, the way the two actually sit on a desk
   — right rather than left so it covers a repeating column of cards instead of
   the sidebar, which is the part of the Mac window worth reading. Width follows
   the stage so the overlap holds at every breakpoint instead of at one
   designed-for size. */
.native-phone {
  @apply absolute right-4 md:right-12 bottom-0 w-[32%] max-w-[215px];
  @apply rounded-[1.6rem] md:rounded-[2rem] p-[3px] md:p-1;
  @apply bg-neutral-700;
  /* Two shadows: a hard dark rim so the phone separates from the Mac window it
     overlaps (both are near-black), then the soft cast shadow underneath. */
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.9), 0 28px 56px rgb(0 0 0 / 0.65);
}

.native-phone img {
  @apply block w-full h-auto rounded-[1.45rem] md:rounded-[1.75rem];
}

/* Dynamic Island stand-in — the detail that reads "iPhone" at a glance. */
.phone-frame-notch {
  @apply absolute top-2.5 md:top-3.5 left-1/2 -translate-x-1/2 w-8 md:w-11 h-2.5 md:h-3.5 rounded-full bg-black z-10;
}

/* Hero screenshot — a real browser chrome (traffic lights + URL pill) around
   the wall capture, so the top of the page reads as "your library in a
   browser tab" rather than a bare cropped image. */
.browser-frame {
  @apply w-full rounded-md overflow-hidden bg-neutral-900 shadow-xl;
}

.browser-frame-bar {
  @apply flex items-center gap-3 px-3 py-2 bg-neutral-800 border-b border-neutral-700;
}

.browser-frame-dots {
  @apply flex gap-1.5;
}

.browser-frame-dots span {
  @apply block w-2.5 h-2.5 rounded-full;
}

.browser-frame-dots span:nth-child(1) { background: #ff5f57; }
.browser-frame-dots span:nth-child(2) { background: #febc2e; }
.browser-frame-dots span:nth-child(3) { background: #28c840; }

.browser-frame-url {
  @apply mx-auto px-4 py-1 rounded-full bg-neutral-700/60 text-[11px] text-neutral-400;
}

.browser-frame-image {
  @apply mx-auto h-full w-full object-cover object-left-top block;
}

/* Developer section — the code panel is the one loud thing here, so the copy
   beside it stays quiet: hairline rules instead of another row of cards. */
.dev-fact {
  @apply pl-4 border-l-2 border-primary-500/40 max-w-md leading-relaxed;
}

.dev-panel {
  @apply rounded-2xl border border-neutral-700 bg-neutral-900/80 backdrop-blur-sm overflow-hidden shadow-xl;
  /* The page forces `.dark` without touching color-scheme, so the code
     block's overflow scrollbar would otherwise render light-on-dark. */
  color-scheme: dark;
}

.dev-panel-bar {
  @apply flex items-center justify-between gap-2 px-3 py-2 border-b border-neutral-800 bg-neutral-800/50;
}

.dev-tab {
  @apply px-3 py-1 rounded-full text-xs font-medium text-neutral-400 transition-colors duration-150;

  &:hover {
    @apply text-neutral-200;
  }
}

.dev-tab-active {
  @apply bg-neutral-700/70 text-white;
}

.dev-panel-code {
  /* Fixed height so switching tabs never shifts the copy beside it. */
  @apply p-4 md:p-5 min-h-[170px] font-mono text-[11px] md:text-xs leading-relaxed text-neutral-400 overflow-x-auto whitespace-pre;
}

.dev-panel-code :deep(.tok-comment) { @apply text-neutral-600; }
.dev-panel-code :deep(.tok-string) { @apply text-primary-400; }
.dev-panel-code :deep(.tok-keyword) { @apply text-white font-semibold; }


.hero-logo-blur {
  @apply absolute top-0 left-0 w-full h-full blur-3xl opacity-30 pointer-events-none;
  background: radial-gradient(circle at center, var(--color-primary-500) 0%, transparent 70%);
  animation: pulse 4s ease-in-out infinite;
}

.features-section {
  @apply px-4 relative;
}

/* How It Works Section */
.how-it-works-section {
  @apply relative z-10;
  /* Fades on every side so the tint doesn't cut off at the container's box. */
  background: radial-gradient(ellipse closest-side at 50% 45%, color-mix(in srgb, var(--color-primary-600) 8%, transparent) 0%, transparent 100%);
}

.how-it-works-card {
  @apply bg-gray-900/50 p-8 rounded-2xl backdrop-blur-sm border border-gray-800 hover:border-emerald-500/30 transition-all duration-300;
}

.icon-wrapper {
  @apply bg-gray-800 rounded-full p-4 inline-flex items-center justify-center mb-6;
}

/* Statistics Section */
.statistics-section {
  @apply relative z-10;
}

.stats-grid {
  @apply grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6;
}

.stat-card {
  @apply bg-gray-900/50 p-8 rounded-2xl backdrop-blur-sm border border-gray-800 text-center;
}

/* Testimonials Section */
.testimonials-section {
  @apply relative z-10;
  background: linear-gradient(to bottom, transparent 0%, color-mix(in srgb, var(--color-primary-600) 5%, transparent) 100%);
}

.testimonial-card {
  @apply bg-gray-900/50 p-8 rounded-2xl backdrop-blur-sm border border-gray-800 max-w-2xl mx-auto;
}

/* Newsletter Section */
.newsletter-section {
  @apply relative z-10;
}

.newsletter-card {
  @apply bg-gray-900/50 p-8 rounded-2xl backdrop-blur-sm border border-gray-800 max-w-2xl mx-auto;
}

/* FAQ Section */
.faq-section {
  @apply relative z-10;
}

.faq-item {
  @apply p-6 border-b border-gray-800 last:border-b-0;
}

/* Footer */
.landing-footer {
  @apply relative z-10 bg-gray-900/80 backdrop-blur-lg border-t border-gray-800;
  width: calc(100vw - 1rem);
}

@keyframes float {
  0%, 100% {
      transform: translateY(0);
  }
  50% {
      transform: translateY(-20px);
  }
}

@keyframes pulse {
  0%, 100% {
      opacity: 0.2;
  }
  50% {
      opacity: 0.4;
  }
}
</style>
