<template>
    <div>
        <LandingNavBar :isLandingPage="false"/>

        <div class="changes-page">

          <!-- TODO: Migrate to NuxtUI -->
            <!-- <FeedbackInfoModal/> -->

            <!-- Changes Info -->
            <div class="changes-side-bar">
                <div class="changes-header">
                    <div class="logo">
                        <Logo :isText="false" :isImage="true"/>
                    </div>

                    <h1 class="mt-0 mb-1 text-4xl font-black">
                      {{ $t('changes.title') }}
                    </h1>

                    <p class="mt-0 mb-2">
                      {{ $t('changes.body_1') }}
                      <NuxtLink class="text-link" to="/feedback">
                        {{ $t('changes.body_1_link') }}
                      </NuxtLink>
                      {{ $t('changes.body_2') }}
                    </p>

                    <!-- One changelog for every client; filter it down to the one you use -->
                    <div class="flex flex-wrap gap-1 mb-2">
                        <UButton
                            v-for="platform in platformFilters"
                            :key="platform"
                            size="xs"
                            color="neutral"
                            :variant="platformFilter === platform ? 'solid' : 'soft'"
                            class="rounded-full"
                            @click="platformFilter = platform"
                        >
                            {{ $t(`feedback.platform.${platform}`) }}
                        </UButton>
                    </div>

                    <div class="flex gap-2 w-full">
                        <UInput
                            v-model="emailToSignUp"
                            :placeholder="$t('settings.auth.email')"
                            class="w-full"
                            size="md"
                            @keyup.enter="isEmailValid ? signUpToUpdates() : null"
                        />

                        <UButton
                            @click="signUpToUpdates"
                            size="md"
                            :disabled="!isEmailValid"
                            class="rounded-xl"
                        >
                            <b>
                              {{ $t('common.get_updates') }}
                            </b>
                        </UButton>
                    </div>

                    <!-- The feed is served by server/routes/changelog.rss.get.ts -->
                    <a
                        href="/changelog.rss"
                        target="_blank"
                        class="text-link text-sm flex items-center gap-1 w-fit opacity-70 hover:opacity-100"
                    >
                        <UIcon name="i-tabler-rss" />
                        {{ $t('changes.rss') }}
                    </a>
                </div>
            </div>

            <!-- Changes list -->
            <Transition
                name="slide-up"
            >
                <TransitionGroup
                    tag="div"
                    name="slide-up"
                    v-if="feedback && feedback?.length > 0"
                    class="changes-body"
                >
                    <div
                        v-for="(changesDate, index) in changes"
                        :key="changesDate.date"
                        :class="{
                            'changes-date-group': true,
                            'index-array-0': index == feedback?.length - 1
                        }"
                    >
                        <div class="changes-date">
                          <div class="flex flex-col gap-0.5 items-start sticky top-[80px] bg-white dark:bg-neutral-900 z-[1]">
                            <small class="opacity-60">
                              {{ changesDate?.changes?.length }} {{ changesDate?.changes?.length === 1 ? $t('changes.change_label') : $t('changes.changes_label') }}
                            </small>
                            
                            <p class="mb-0 mt-0 text-sm whitespace-nowrap sticky">
                              {{ changesDate.dateFormatted }}
                            </p>
                          </div>
                        </div>

                        <div class="changes-list">
                            <div
                                v-for="change in changesDate.changes"
                                :key="change.id"
                                :class="{
                                    'changes-item': true,
                                    '!opacity-50': changeHovering != null ? change.id != changeHovering : false
                                }"
                                @mouseenter="changeHovering = change.id"
                                @mouseleave="changeHovering = null"
                            >
                                <div class="changes-item-body">
                                    <!-- <small :class="`small feedback-type`">
                                        <Icon :name="change.type.icon" />
                                        <span>
                                            {{ change.type.value == 'bug' ? change.type.label + ' Fix' : change.type.label }}
                                        </span>
                                    </small> -->
                                    <ClientOnly>
                                      <div class="flex flex-wrap gap-1">
                                        <UBadge
                                          variant="soft"
                                          :class="getBadgeColor(change.type, 'bg'), getBadgeColor(change.type, 'text')"
                                          class="w-fit capitalize"
                                          size="sm"
                                        >
                                          <UIcon :name="feedbackType(change.type).icon" />
                                          {{ feedbackType(change.type).label }}
                                        </UBadge>
                                        <UBadge
                                          v-if="change.platform && platformFilter === 'all'"
                                          variant="soft"
                                          color="neutral"
                                          class="w-fit"
                                          size="sm"
                                        >
                                          {{ $t(`feedback.platform.${change.platform}`) }}
                                        </UBadge>
                                      </div>
                                    </ClientOnly>

                                    <div class="changes-item-content">
                                      <div class="flex flex-row gap-1 items-center">
                                        <div v-if="change?.icon">{{ change.icon }}</div>
                                        <h6>
                                          {{ change.changelogTitle || change.title }}
                                        </h6>
                                      </div>

                                      <div
                                        v-if="change?.changelogBody || change?.body"
                                        class="changes-marked"
                                        v-html="markedText(change.changelogBody || change.body)"
                                      />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </TransitionGroup>

                <div v-else class="feedback-wrapper">
                    <p>
                        {{ $t('feedback.no_feedback') }}
                    </p>
                </div>
            </Transition>

            <!-- TODO: Migrate to NuxtUI -->
            <!-- <FeedbackForm/> -->
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
// `parse`, not `parse/dist/parse.min.js`: the minified UMD build resolves to a
// default export with no `User` under Vite, and `Parse.User.current()` throws.
import Parse from 'parse'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

const route = useRoute()
const { t } = useI18n()
const store = useStore()

// Store actions and state
const { showAlert, getDate, markedText, feedbackType } = store
const { userId, feedback, isAdmin } = storeToRefs(store)

// Component state
const changeHovering = ref(null)
const emailToSignUp = ref('')
const loading = ref(false)
const showFeedbackInfoModal = ref(false)
const feedbackToShow = ref(null)
const showFeedbackToDeleteModal = ref(false)
const feedbackToDelete = ref([])

// Computed
const isEmailValid = computed(() => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailToSignUp.value)
})

useHead({
  link: [
    { rel: 'alternate', type: 'application/rss+xml', title: 'Webbites Changelog', href: '/changelog.rss' }
  ]
})

// The changelog is the done posts on our HelpBites feedback board that are
// marked for it, newest completion first. Public, so it renders on the server.
const feedbackApi = useFeedbackApi()
const { data: doneFeedback } = await useAsyncData('feedback-changelog', () =>
  feedbackApi.configured ? feedbackApi.list({ view: 'changelog', limit: 500 }, 'none') : Promise.resolve({ posts: [] })
)

if (doneFeedback.value) {
  store.feedback = doneFeedback.value.posts
}

// Methods
const getBadgeColor = (status, type) =>{
  if(status == undefined) return ''

  const baseClass = 'shadow-sm';
  status = status?.toLowerCase() || status
  const statusValue = status.toLowerCase();

  if (statusValue.includes('feature')) {
    if(type == 'text') return 'text-green-700'
    if(type == 'bg') return `bg-green-50 dark:bg-green-400 ${baseClass}`
    if(type == 'border') return 'border-green-500 dark:bg-green-400'
  }

  if(statusValue.includes('improvement')) {
    if(type == 'text') return 'text-cyan-700'
    if(type == 'bg') return `bg-cyan-50 dark:bg-cyan-400 ${baseClass}`
    if(type == 'border') return 'border-cyan-500 dark:bg-cyan-400'
  }

  if(statusValue.includes('bug')) {
    if(type == 'text') return 'text-yellow-700'
    if(type == 'bg') return `bg-yellow-50 dark:bg-yellow-400 ${baseClass}`
    if(type == 'border') return 'border-yellow-500 dark:bg-yellow-400'
  }

  // Default case
  if(type == 'text') return 'text-gray-700'
  if(type == 'bg') return `bg-gray-100 dark:bg-gray-400 ${baseClass}`
  if(type == 'border') return 'border-gray-500 dark:bg-gray-400'
};

const checkIfAdmin = async () => {
  if (Parse.User.current()) {
    try {
      let isAdminRes = await $fetch('/api/auth/isAdmin')
      console.log('isAdminRes: ', isAdminRes)
      isAdmin.value = isAdminRes.isAdmin
    } catch (error) {
      isAdmin.value = false
      console.error("[changes] Error checking admin role: ", error)
    }
  } else {
    isAdmin.value = false
  }
}

const signUpToUpdates = async () => {
  loading.value = true

  try {
    const signedUp = await $fetch('/api/subscribeUserTo', {
      method: 'post',
      body: {
        emailToSignUp: emailToSignUp.value,
        subscribeTo: 'changes'
      }
    })

    if (signedUp.error) throw new Error(signedUp.error)

    let message = t('changes.signup_thanks')
    if (signedUp.alreadySubscribed) message = t('changes.already_subscribed')

    emailToSignUp.value = ''
    showAlert({ message })
  } catch (error) {
    console.log("error: ", error)
    showAlert({ type: 'error', message: t('changes.signup_failed') })
  } finally {
    loading.value = false
  }
}

// Entries from the native repo land as `app`, from this repo as `web`, and a
// change that reaches every client (backend, billing, data) as `all`.
const platformFilters = ['all', 'web', 'app', 'extension']
const platformFilter = ref('all')

const changes = computed(() => {
  const items = (Array.isArray(feedback.value) ? feedback.value : []).filter((item) => {
    const platform = item?.platform || 'all'
    return platformFilter.value === 'all' || platform === 'all' || platform === platformFilter.value
  })

  const grouped = items.reduce((acc, item) => {
    const iso = item?.completedAt || item?.createdAt || item?.updatedAt
    if (!iso) return acc

    const d = new Date(iso)
    const dayKey = d.toISOString().slice(0, 10) // YYYY-MM-DD (UTC)

    if (!acc[dayKey]) {
      const groupDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
      acc[dayKey] = {
        date: groupDate,
        dateFormatted: getDate(groupDate, { showYear: true }),
        changes: []
      }
    }
    acc[dayKey].changes.push(item)
    return acc
  }, {})

  return Object.values(grouped).sort((a, b) => b.date.getTime() - a.date.getTime())
})

// Lifecycle hooks
onMounted(async () => {
  // await checkIfAdmin()
  userId.value = Parse.User.current() ? Parse.User.current().id : ''

  // Register ScrollTrigger plugin
  gsap.registerPlugin(ScrollTrigger)

  // Animate changes items
  const items = document.querySelectorAll('.changes-item')
  items.forEach((item) => {
    gsap.fromTo(item,
      {
        opacity: 0,
        scale: 0.8,
        filter: 'blur(4px)',
      },
      {
        opacity: 1,
        scale: 1,
        filter: 'blur(0px)',
        duration: 0.2,
        scrollTrigger: {
          trigger: item,
          start: 'top bottom-=100',
          toggleActions: 'play none none reverse'
        }
      }
    )
  })

  // check if URL contains feedbackId
  if (route.query.feedbackId) {
    showFeedbackInfoModal.value = true
    feedbackToShow.value = feedback.value.find(f => f.id === route.query.feedbackId)
  }
})
</script>


<style>
@reference "../assets/css/tailwind.css";
.changes-page {
    @apply mx-auto max-w-[1200px] p-8 py-10 flex;

    .logo {
        img {
           @apply w-[62px];
        }
    }

    .changes-side-bar {
        @apply fixed max-w-sm pr-8 translate-x-[17%];
    }

    .changes-header {
        @apply flex flex-col justify-start pt-40 gap-2 w-full;
    }
}

.changes-marked{
  p{
    @apply text-sm;
  }

  a{
    @apply text-green-600 underline;
  }
}

.changes-body{
    @apply flex flex-col w-full ml-[43%] gap-0;

    @media screen and (max-width: 768px) {
        @apply gap-4;
    }

    .changes-date-group{
        @apply p-6 w-full grid relative gap-8;

        grid-template-columns: 75px 1fr;

        &.index-array-0{
            .changes-date {
                &::after {
                    @apply hidden;
                }
            }
        }

        @media screen and (max-width: 768px) {
            @apply grid-cols-1 gap-4 p-2;
        }

        .changes-date {
            @apply w-full relative;

            &::after {
                @apply
                  absolute
                  block
                  w-[1px] h-[calc(100%-15px)]
                  border-r border-dashed border-r-neutral-700 dark:border-r-white
                  left-1/2
                  -translate-x-1/2
                  top-[52px]
                  opacity-30
                ;

                content: "";
            }
        }
    }

    .changes-list {
        @apply flex flex-col w-full;

        > *:not(:last-child) {
            @apply mb-2;
        }

        @media screen and (max-width: 768px) {
            @apply gap-2;
        }
    }

    .changes-item {
        @apply
          opacity-100
          flex flex-col gap-1
          p-4
          border border-transparent
          w-full
          rounded-xl
          transition-all duration-200
          bg-transparent
        ;

        @media screen and (max-width: 768px) {
            border-color: var(--card-border-color);
        }

        .changes-item-body {
            @apply flex flex-col gap-2;
        }

        .feedback-type {
            @apply opacity-60;
        }

        .changes-item-content {
            @apply flex flex-col gap-0;
        }

        &:hover{
            @media (hover: hover) and (pointer: fine) {
                @apply
                    opacity-100
                    !scale-105
                    z-[1]
                    shadow-xl
                    border border-neutral-100 dark:border-neutral-700/50
                    bg-white dark:bg-neutral-900
                ;

                .feedback-type {
                    @apply opacity-100;
                }
            }
        }
    }
}
</style>
