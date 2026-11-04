<template>
    <UModal
      v-model:open="showImportBookmarksModal"
      :dismissible="!(true)"
    >
  <template #content>
        <div class="bookmarks-to-import-wrapper">
            <div class="flex flex-col gap-1">
                <h6 class="text-xl mb-3">
                    {{ $t('bookmarks.import_title') }}
                </h6>

                <!-- Add new file button -->
                <div class="mb-1">
                    <UButton
                        size="xs"
                        variant="soft"
                        color="neutral"
                        icon="i-heroicons-arrow-up-tray"
                        @click="store.clickId('importBookmarks')"
                    >
                    <input 
                        @change="store.importBookmarksFile()" 
                        id="importBookmarks" 
                        type="file" 
                        class="hidden absolute"
                        accept=".json,.txt,.html, .csv"
                        >
                        {{ bookmarksToImport.length > 0 ? $t('common.select_new_file') : $t('common.select_file') }}
                    </UButton>
                </div>

                <!-- Connected services -->
                <div v-if="services.length" class="well opacity-100 mt-2 flex flex-col gap-2 text-left">
                    <p class="text-sm font-medium m-0">{{ $t('import.connect_title') }}</p>

                    <div v-for="service in services" :key="service.id" class="flex flex-col gap-1">
                        <div v-if="service.auth === 'token' && service.available" class="flex gap-2">
                            <UInput
                                v-model="tokens[service.id]"
                                :placeholder="service.hint || service.name"
                                size="xs"
                                class="flex-1"
                                @keyup.enter="connect(service)"
                            />
                            <UButton
                                size="xs"
                                color="neutral"
                                variant="soft"
                                :loading="connecting === service.id"
                                :disabled="!tokens[service.id]"
                                @click="connect(service)"
                            >
                                {{ $t('import.connect_fetch') }}
                            </UButton>
                        </div>

                        <UButton
                            v-else-if="service.auth === 'oauth' && service.available"
                            size="xs"
                            color="neutral"
                            variant="soft"
                            class="w-fit"
                            icon="i-heroicons-link"
                            :loading="connecting === service.id"
                            @click="connect(service)"
                        >
                            {{ $t('import.connect_button', { name: service.name }) }}
                        </UButton>

                        <div v-else class="flex flex-col gap-0.5">
                            <UButton size="xs" color="neutral" variant="soft" class="w-fit" disabled>
                                {{ service.name }} · {{ $t('import.connect_unavailable') }}
                            </UButton>
                            <small v-if="service.note" class="opacity-60">{{ service.note }}</small>
                        </div>
                    </div>
                </div>

                <!-- Access Information Section -->
                <div v-if="isLoadingAccess" class="well opacity-100 mt-4">
                    <div class="flex items-center gap-2">
                        <UIcon name="i-tabler-loader-2" class="w-4 h-4 spinning" />
                        <p class="m-0">{{ $t('import_modal.checking_access') }}</p>
                    </div>
                </div>

                <!-- Remaining Quota -->
                <div v-if="!(importAccessData?.hasAccess && importAccessData?.accessType == 'paid-import')" class="well opacity-100 mt-2 mb-2">
                    <div v-if="bookmarkQuota && !bookmarkQuota.unlimited" class="mb-3">
                        <div class="flex justify-between items-end mb-2">
                            <div class="flex flex-col gap-0 items-start">
                                <p class="text-sm font-medium">
                                    {{ $t('import_modal.quota_title') }}
                                </p>
                                <p class="text-left text-xs text-gray-600 dark:text-gray-400">
                                    {{ bookmarkQuota.remaining ?? 0 }}  {{ $t('bookmarks.remaining') }}
                                </p>
                            </div>
                            <p class="text-sm">
                                {{ bookmarkQuota.used }}/{{ bookmarkQuota.limit }}  {{ $t('common.saved') }}
                            </p>
                        </div>

                        <UProgress
                            :value="quotaPercentage"
                            :max="100" :color="importAccessData?.hasAccess ? 'green' : 'red'" />
                    </div>

                    <div v-if="bookmarksToImport.length >= importAccessData?.quota?.remaining "
                        class="flex flex-col w-full gap-3 mt-6">
                        <small>
                            {{ $t('bookmarks.import_limit') }}
                        </small>

                        <div class="flex flex-row w-full justify-center gap-3">

                            <UButton @click="goToPayment" target="_blank" color="neutral"
                                :loading="isCreatingCheckoutSession" :disabled="isCreatingCheckoutSession">
                                {{ $t('bookmarks.payment_button') }}
                            </UButton>

                            <USeparator :label="$t('common.or')" size="xs" class="opacity-70" orientation="vertical" />

                            <UButton @click="showImportBookmarksModal = false; showUpgradeModal = true" target="_blank"
                                color="neutral" :disabled="isCreatingCheckoutSession">
                                {{ $t('pricing.upgrade_plan') }}
                            </UButton>
                        </div>
                    </div>
                </div>

                <!-- Single Import Plan Active -->
                <div v-if="importAccessData?.hasAccess && importAccessData?.accessType == 'paid-import'"
                    class="well text-left opacity-100 mb-2 !py-3">
                    <h6 class="text-lg font-medium m-0">
                        {{ $t('import_modal.plan_active_title') }}
                    </h6>

                    <i18n-t keypath="import_modal.plan_active_description" tag="p" class="text-sm mt-[2px] text-left opacity-80">
                        <template #date>
                            <span class="font-semibold">
                                {{ new Date(importAccessData.currentStatus.expiresAt).toLocaleDateString() }}
                            </span>
                        </template>
                    </i18n-t>
                </div>

                <!-- <div v-if="true" -->
                <div v-if="!importAccessData?.hasAccess && bookmarksToImport.length >= 100 && totalImportedBookmarks <= 100"
                    class="well flex flex-col gap-2 opacity-100 mt-4">
                    <p class="m-0 text-sm">
                        {{ $t('bookmarks.import_payment_message', { count: bookmarksToImport.length }) }}
                    </p>

                    <div class="flex flex-row w-full justify-center gap-3 my-2">
                        <UButton @click="goToPayment" target="_blank" color="neutral" :loading="isCreatingCheckoutSession"
                            :disabled="isCreatingCheckoutSession">
                            {{ $t('bookmarks.payment_button') }}
                        </UButton>

                        <USeparator :label="$t('common.or')" size="xs" class="opacity-70" orientation="vertical" />

                        <UButton @click="showImportBookmarksModal = false; showUpgradeModal = true" target="_blank"
                            color="neutral" :disabled="isCreatingCheckoutSession">
                            {{ $t('pricing.upgrade_plan') }}
                        </UButton>
                    </div>

                    <small class="mb-0">
                        {{ $t('bookmarks.free_import_message') }}
                    </small>
                </div>
            </div>

            <div class="absolute left-1/2 -translate-x-1/2 bottom-20 flex gap-2 w-full pr-4 justify-center z-10">
                <TransitionGroup name="slide-up">
                    <UButton
                        v-if="bookmarksToImport.length > 5 && !isAllSelected" 
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        class="shadow-lg"
                        @click="selectAllBookmarks"
                    >
                        <!-- :disabled="importLimit <= 0"  -->
                        {{ $t('bookmarks.select_all', { count: bookmarksToImport.length }) }} 
                    </UButton>

                    <UButton
                        v-if="bookmarksToImport.length > 5 && selectedBookmarksToImport.length > 0"
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        class="shadow-lg"
                        @click="selectedBookmarksToImport = []"
                    >
                        <!-- :disabled="importLimit <= 0"  -->
                        {{ $t('bookmarks.unselect_all') }}
                    </UButton>
                </TransitionGroup>
            </div>

            <!-- Bookmarks list -->
            <div class="relative h-full">
                <div class="bookmarks-to-import relative">
                    <div class="flex items-center justify-center gap-1 pb-1 opacity-80">
                        <UIcon name="i-tabler-info-circle" class="size-4 text-green-600" />
                        <p class="text-sm text-center">
                            {{ $t('bookmarks.deselect_hint') }}
                        </p>
                    </div>

                    <div 
                        v-if="bookmarksToImport.length > 0" 
                        v-for="bookmark in bookmarksToImport"
                        @click="toggleBookmarkSelection(bookmark)" 
                        :class="{
                            'import-card': true,
                            'shadow-sm': selectedBookmarksToImport.includes(bookmark),
                            'opacity-50': !selectedBookmarksToImport.includes(bookmark),
                            '!bg-neutral-50 dark:!bg-neutral-800': !selectedBookmarksToImport.includes(bookmark),
                        }"
                    >
                        <p>
                            {{ 
                                bookmark.replace('https://', '')
                                            .replace('http://', '')
                                                .replace('www.', '')
                                                    .replace(/\/$/, '') 
                            }}
                        </p>
                    </div>

                    <div v-else class="flex justify-center items-center p-4">
                        <UIcon name="i-tabler-loader-2" class="w-5 h-5 spinning" />
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-between p-4">
            <UButton variant="ghost" @click="showImportBookmarksModal = false">
                {{ $t('common.close') }}
            </UButton>

            <UButton variant="solid" color="primary" @click="importBookmarks()"
                :disabled="selectedBookmarksToImport.length == 0 || !importAccessData?.hasAccess || isLoadingAccess || (importAccessData?.accessType === 'completed-under-limit' && importAccessData?.quota?.remaining <= 0)"
                :loading="importingBookmarks">
                <span v-if="!importAccessData?.hasAccess && !isLoadingAccess">
                    {{ importBookmarksNowMessage }}
                </span>

                <span v-else-if="isLoadingAccess">
                    {{ $t('common.checking_access') }}
                </span>
                
                <span v-else>
                    {{ $t('common.import_bookmarks', { selected: selectedBookmarksToImport.length }) }}
                </span>
            </UButton>
        </div>
    
  </template>
</UModal>
</template>

<script setup>
import Parse from 'parse';
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { computed, TransitionGroup, watch } from 'vue'
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
const { log } = useDevLog()

const store = useStore()

const {
    showImportBookmarksModal,
    showUpgradeModal,
    bookmarksToImport,
    selectedBookmarksToImport,
    totalImportedBookmarks,
    importingBookmarks,
    plans,
    importLimit,
    usage,
    importAccessData,
    showImportStatusModal
} = storeToRefs(store)

const {
    getBookmarksToImport,
    showAlert,
    fetchPlans,
    createCheckoutSession,
    setBookmarksToImport
} = store
const { backendFetch } = useBackendFetch()

const isCreatingCheckoutSession = ref(false)
const isLoadingAccess = ref(false)

// ── Connected services (Raindrop, Pinboard, Readwise, …) ──────────
const services = ref([])
const tokens = ref({})
const connecting = ref('')

const loadServices = async () => {
    if (services.value.length) return
    try {
        services.value = (await backendFetch('import/connect'))?.services || []
    } catch (error) {
        console.error('[ImportBookmarksModal] could not list services', error)
    }
}

const connect = async (service) => {
    connecting.value = service.id
    try {
        const body = service.auth === 'oauth' ? { client: 'web' } : { token: tokens.value[service.id] }
        const res = await backendFetch(`import/connect/${service.id}`, { method: 'POST', body })

        if (res?.authorizeUrl) {
            window.location.href = res.authorizeUrl
            return
        }

        const urls = (res?.bookmarks || []).map(b => b.url)
        if (!urls.length) {
            showAlert({ type: 'info', message: t('import.connect_empty', { name: service.name }) })
            return
        }
        setBookmarksToImport(urls)
    } catch (error) {
        console.error('[ImportBookmarksModal] connect error', error)
        showAlert({
            type: 'error',
            message: error?.data?.statusMessage || t('import.connect_error', { name: service.name }),
            timeOnScreen: 6000
        })
    } finally {
        connecting.value = ''
    }
}

/**
 * The bookmark allowance, straight from `GET /v1/me/entitlements`.
 *
 * The modal used to compute `plan.bookmarkCountLimit - usage.bookmarksTotal`
 * itself, pairing a limit read off the plan pointer with a count from the usage
 * column. The endpoint does that subtraction against the plan the backend
 * actually resolved, and says so when the allowance is unlimited.
 */
const bookmarkQuota = computed(() => usage.value?.bookmarks ?? null)

/** How much of the allowance is spent, clamped for the progress bar. */
const quotaPercentage = computed(() => {
    const quota = bookmarkQuota.value
    if (!quota || quota.unlimited || !quota.limit) return 0
    return Math.min(100, (quota.used / quota.limit) * 100)
})

/**
 * How many more bookmarks the plan allows. Import access is checked first by
 * the callers below; this is the fallback for a user with none.
 */
const remainingOnPlan = () => {
    const quota = bookmarkQuota.value
    if (!quota) return 0
    if (quota.unlimited) return Infinity
    return quota.remaining ?? 0
}


const isAllSelected = computed(() => {
    return bookmarksToImport.value.length > 0 &&
        (
            selectedBookmarksToImport.value.length === bookmarksToImport.value.length ||
            (selectedBookmarksToImport.value.length == importAccessData.value?.quota?.remaining)
        )
})

const importBookmarksNowMessage = computed(() => {
    try {
        if (!importAccessData.value?.hasAccess && !isLoadingAccess.value) return t('common.import')
        if (isLoadingAccess.value) return t('common.checking_access')

        if (importAccessData.value?.accessType === 'completed-under-limit') {
            const remaining = importAccessData.value.quota.remaining;
            const selected = selectedBookmarksToImport.value?.length || 0;
            return t('common.import_bookmarks_remaining', { selected, remaining })
        }

        log('common.import_bookmarks')
        return t('common.import_bookmarks', { selected: selectedBookmarksToImport.value?.length })
    } catch (error) {
        console.log('Error in importBookmarksNowMessage: ', error);
        return t('common.import')
    }
})


// Validate import access when modal opens
const validateImportAccess = async () => {
    let response;

    try {
        isLoadingAccess.value = true
        const user = Parse.User.current()
        if (!user) return

        response = await $fetch('/api/callBackend', {
            method: 'POST',
            headers: { 'x-parse-session-token': user.getSessionToken() },
            body: {
                endpoint: 'validateImportAccess',
                data: { userId: user.id }
            }
        })

        if (response.success) {
            importAccessData.value = response.data;
            importLimit.value = importAccessData.value?.quota?.remaining;
            console.log('importLimit.value: ', importLimit.value)
            console.log('importAccessData.value 3: ', importAccessData.value)
        } else {
            showAlert({
                type: 'error',
                message: t('import_modal.validate_failed'),
                timeOnScreen: 5000
            })
        }
    } catch (error) {
        console.error('Error validating import access:', error)
        showAlert({
            type: 'error',
            message: t('import_modal.validate_failed'),
            timeOnScreen: 5000
        })
    } finally {
        isLoadingAccess.value = false
    }

    return response
}

const goToPayment = async () => {
    try {
        isCreatingCheckoutSession.value = true;

        const result = await createCheckoutSession({
            type: 'import'
        });

        if (!result.success) {
            console.error('goToPayment error:', result.error);
            showAlert({
                type: 'error',
                message: t('import_modal.checkout_failed'),
                timeOnScreen: 5000
            });
        }
    } catch (error) {
        console.error('goToPayment error:', error);
        showAlert({
            type: 'error',
            message: t('import_modal.checkout_failed'),
            timeOnScreen: 5000
        });
    } finally {
        isCreatingCheckoutSession.value = false;
    }
}

// TODO: Where I left things off: 
// 0.- Test flow when buying a one off. 
// 1.- Need to make sure the redirect from Stripe goes to url.com/app?importModal=true. 
// 2.- Open the Import bookmark status modal when importing bookmarks. 
// 3.- If user.importing is true when onMount, then open the import bookmark status moda.
// 4.- Test that the flow works when the user: 
// a) Has free plan. 
// b) Has free plan and upgradedes to one off. 
// c) Has free plan and upgrades to subscritpion.
// d) Already has subscription.

const selectAllBookmarks = () => {
    try {
        const access = importAccessData?.value;
        const totalToImport = bookmarksToImport.value.length;
        const remaining = Number.isFinite(access?.quota?.remaining) ? access.quota.remaining : 0;

        if (access?.hasAccess) {
            // Determine if the user has unlimited import access via quota or restrictions
            const isUnlimited = Boolean(access?.quota?.unlimited) || Boolean(access?.restrictions?.unlimited);

            if (isUnlimited || totalToImport <= remaining) {
                // Unlimited access (e.g., paid import/subscription)
                selectedBookmarksToImport.value = [...bookmarksToImport.value];
                return
            } else {
                // Limited access (e.g., free tier or under-limit paid import)
                const maxSelectable = Math.max(0, Math.min(totalToImport, remaining));
                selectedBookmarksToImport.value = bookmarksToImport.value.slice(0, maxSelectable);
            }
        } else {
            // No import access granted: fall back to what the plan still allows
            const maxSelectable = Math.min(totalToImport, remainingOnPlan());
            selectedBookmarksToImport.value = bookmarksToImport.value.slice(0, maxSelectable);
        }

        showAlert({
            type: 'success',
            message: t('import.import_quota_exceeded'),
            description: t('import.import_quota_exceeded_description'),
            position: 'top-center',
            showCloseButton: false,
            timeOnScreen: 8000
        })
    } catch (error) {
        console.log('Error in selectAllBookmarks: ', error);
        selectedBookmarksToImport.value = bookmarksToImport.value.slice(0, 100);
    }
}

const toggleBookmarkSelection = (bookmark) => {
    const index = selectedBookmarksToImport.value.indexOf(bookmark)
    if (index > -1) {
        selectedBookmarksToImport.value.splice(index, 1)
    } else {
        // Apply access/quota limits before adding
        const access = importAccessData?.value;

        if (access?.hasAccess) {
            // Determine if unlimited import is granted
            const isUnlimited = Boolean(access?.quota?.unlimited) || Boolean(access?.restrictions?.unlimited);

            if (!isUnlimited) {
                const remaining = Number.isFinite(access?.quota?.remaining) ? access.quota.remaining : 0;
                if (selectedBookmarksToImport.value.length >= remaining) {
                    showAlert({
                        type: 'success',
                        message: t('import.import_quota_exceeded'),
                        description: t('import.import_quota_exceeded_description'),
                        position: 'top-center',
                        showCloseButton: false,
                        timeOnScreen: 8000
                    });
                    return;
                }
            }

            selectedBookmarksToImport.value.push(bookmark);
        } else {
            // Fallback to what the plan still allows when there is no import access
            if (selectedBookmarksToImport.value.length >= remainingOnPlan()) {
                showAlert({
                    type: 'error',
                    message: t('import.import_quota_exceeded'),
                    timeOnScreen: 5000
                });
                return;
            }

            selectedBookmarksToImport.value.push(bookmark);
        }
    }
}

const importBookmarks = async () => {
    const user = Parse.User.current()
    importingBookmarks.value = true
    // A new import: forget any earlier cancel so its completion is announced
    store.importCancelled = false

    const bookmarks = selectedBookmarksToImport.value.length > 0
        ? selectedBookmarksToImport.value
        : await getBookmarksToImport()

    // Save bookmarks to user
    user.set('bookmarksToImport', bookmarks)
    await user.save()

    showAlert({
        title: t('bookmarks.import_progress_title'),
        message: t('bookmarks.import_progress_message'),
        type: 'success',
        showCloseButton: false,
        timeOnScreen: 8000
    })

    try {
        showImportBookmarksModal.value = false
        // Goes through the proxy that checks the session, not the generic one
        const response = await $fetch('/api/importBookmarks', {
            method: 'POST',
            headers: { Authorization: `Bearer ${user.getSessionToken()}` },
            body: { userId: user.id }
        })

        if (response.success) {
            console.log('Done: ', response)
            // The user cancelled from the status modal while bookmarks were queuing
            if (!response.data?.cancelled) showImportStatusModal.value = true
        } else {
            showAlert({
                type: 'error',
                message: t('bookmarks.import_error'),
                timeOnScreen: 5000
            })
        }
    } catch (error) {
        showAlert({
            type: 'error',
            message: t('bookmarks.import_error'),
            timeOnScreen: 5000
        })
        throw new Error(error)
    } finally {
        importingBookmarks.value = false
    }
}

// Watch for modal visibility to validate access when opened
watch(showImportBookmarksModal, async (newValue) => {
    if (newValue) {
        loadServices()
        if (Object.keys(importAccessData.value || {}).length === 0) await validateImportAccess()
        const url = new URL(window.location.href);
        url.searchParams.set('importModal', true);
        window.history.pushState({}, '', url);
    } else {
        const url = new URL(window.location.href);
        url.searchParams.delete('importModal');
        window.history.pushState({}, '', url);
    }
})

// Watch for importAccessData changes to trim bookmarks when quota-limited
watch(importAccessData, (newAccessData) => {
    if (newAccessData?.hasAccess && newAccessData?.accessType === 'completed-under-limit') {
        const remainingQuota = newAccessData.quota.remaining;
        if (selectedBookmarksToImport.value.length > remainingQuota) {
            selectedBookmarksToImport.value = selectedBookmarksToImport.value.slice(0, remainingQuota);
        }
    }
}, { deep: true })

onMounted(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    let hasImportParam = urlParams.get('importModal') === 'true';
    //   console.log('hasImportParam: ', hasImportParam)

    // Back from an OAuth connector (Raindrop sends us to /app?importConnect=raindrop[&error=denied])
    const importConnect = urlParams.get('importConnect');
    if (importConnect) {
        const url = new URL(window.location.href);
        url.searchParams.delete('importConnect');
        url.searchParams.delete('error');
        window.history.replaceState({}, '', url);

        if (urlParams.get('error') === 'denied') {
            showAlert({ type: 'info', message: t('import.connect_denied') })
        } else {
            await loadServices()
            showImportBookmarksModal.value = true
            const service = services.value.find(s => s.id === importConnect) || { id: importConnect, name: importConnect, auth: 'oauth' }
            await connect(service)
        }
    }

    if (hasImportParam) {
        console.log('importAccessData.value 1: ', importAccessData.value)
        if (Object.keys(importAccessData.value || {}).length === 0) await validateImportAccess()
        console.log('importAccessData.value 2: ', importAccessData.value)
        const bookmarks = await getBookmarksToImport()
        console.log('bookmarks: ', bookmarks)

        // Save bookmarks to user
        // user.set('bookmarksToImport', bookmarks)
        // await user.save()
        // showImportBookmarksModal.value = true;
    }

})

</script>

<style>
@reference "../assets/css/tailwind.css";
.import-card {
    @apply cursor-pointer py-2 px-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm font-light flex items-center transition-all;

    p {
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        word-break: break-all;
    }
}
</style>
