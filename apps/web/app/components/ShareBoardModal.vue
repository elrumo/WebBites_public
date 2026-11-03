<template>
  <UModal
    v-model:open="showShareBoardModal"
    :title="isOwner ? $t('boards.share.title', { name: board?.name ?? '' }) : $t('boards.share.people_with_access')"
    :description="isOwner ? $t('boards.share.description_owner') : $t('boards.share.description_member', { name: board?.name ?? $t('boards.share.this_board') })"
    :ui="{ content: 'max-w-lg', header: 'pe-14', body: 'flex flex-col gap-6' }"
  >
    <template #body>
      <div v-if="loading" class="flex justify-center py-8">
        <UIcon name="i-heroicons-arrow-path" class="w-5 h-5 animate-spin opacity-50" />
      </div>

      <div v-else-if="loadError" class="text-sm text-center text-muted py-6">
        {{ loadError }}
        <UButton class="mt-3" block variant="soft" color="neutral" :label="$t('boards.share.try_again')" @click="load" />
      </div>

      <template v-else-if="sharing">
        <!-- Invite -->
        <section v-if="isOwner" class="flex flex-col gap-2">
          <h3 class="text-[11px] font-medium uppercase tracking-wider text-muted">{{ $t('boards.share.invite_people') }}</h3>
          <div class="flex flex-col sm:flex-row sm:items-start gap-2">
            <UInputTags
              v-model="emails"
              class="flex-1 min-w-0"
              :placeholder="$t('boards.share.add_emails')"
              :delimiter="/[,;\s]/"
              add-on-paste
              add-on-blur
              :color="invalidEmails.length ? 'error' : undefined"
              :max="MAX_PER_INVITE"
            />
            <div class="flex gap-2">
              <USelect v-model="inviteRole" :items="ROLE_OPTIONS" value-key="value" class="w-32" />
              <UButton
                :label="$t('boards.share.invite')"
                :loading="inviting"
                :disabled="!validEmails.length"
                @click="invite"
              />
            </div>
          </div>
          <p v-if="invalidEmails.length" class="text-xs text-error">
            {{ $t('boards.share.invalid_emails', { emails: invalidEmails.join(', ') }, invalidEmails.length) }}
          </p>
          <p v-else class="text-xs text-muted">
            {{ $t('boards.share.invite_hint') }}
          </p>
        </section>

        <!-- Who has access -->
        <section class="flex flex-col gap-1">
          <h3 class="text-[11px] font-medium uppercase tracking-wider text-muted">{{ $t('boards.share.people_with_access') }}</h3>

          <div class="flex items-center gap-3 py-1.5">
            <UAvatar :alt="sharing.owner.name" size="sm" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate">{{ sharing.owner.name }}<span v-if="isOwner" class="text-muted font-normal"> {{ $t('boards.share.you') }}</span></p>
            </div>
            <span class="text-xs text-muted pr-2">{{ $t('boards.share.owner') }}</span>
          </div>

          <div v-for="member in sharing.members" :key="member.id" class="flex items-center gap-3 py-1.5">
            <UAvatar :alt="member.name || member.email" size="sm" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate">{{ member.name || member.email }}</p>
              <p v-if="member.email && member.name && member.name !== member.email" class="text-xs text-muted truncate">
                {{ member.email }}
              </p>
            </div>
            <UBadge v-if="member.status === 'pending'" :label="$t('boards.share.pending')" color="neutral" variant="subtle" size="sm" />
            <USelect
              v-if="isOwner"
              :model-value="member.role"
              :items="ROLE_OPTIONS"
              value-key="value"
              variant="ghost"
              size="sm"
              class="w-28 sm:w-32"
              :disabled="busyMember === member.id"
              @update:model-value="changeRole(member, $event)"
            />
            <span v-else class="text-xs text-muted pr-2">{{ member.role === 'editor' ? $t('boards.share.can_edit') : $t('boards.share.can_view') }}</span>
            <UButton
              v-if="isOwner"
              icon="i-tabler-x"
              size="xs"
              color="neutral"
              variant="ghost"
              square
              :aria-label="$t('boards.share.remove_member', { name: member.name || member.email })"
              :loading="busyMember === member.id"
              @click="removeMember(member)"
            />
          </div>

          <!-- Invites that could not be emailed (no mail server is set up): hand over the links. -->
          <div v-if="unsentInvites.length" class="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 my-2 flex flex-col gap-2">
            <p class="text-sm">Email is not set up on this server, so these invitations were not sent. Send each person their link yourself:</p>
            <div v-for="item in unsentInvites" :key="item.email" class="flex items-center gap-2">
              <span class="text-xs text-muted truncate w-40 shrink-0">{{ item.email }}</span>
              <input readonly :value="item.link" class="min-w-0 flex-1 text-xs rounded border border-neutral-200 dark:border-neutral-700 bg-transparent px-2 py-1" @focus="$event.target.select()" />
              <UButton size="xs" color="neutral" variant="soft" @click="copyInviteLink(item.link)">Copy</UButton>
            </div>
          </div>

          <p v-if="!sharing.members.length" class="text-sm text-muted px-1 py-2">
            {{ isOwner ? $t('boards.share.nobody_else') : $t('boards.share.only_other') }}
          </p>
        </section>

        <!-- General access -->
        <section v-if="isOwner" class="flex flex-col gap-2">
          <h3 class="text-[11px] font-medium uppercase tracking-wider text-muted">{{ $t('boards.share.general_access') }}</h3>
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center w-9 h-9 shrink-0 rounded-full bg-elevated text-muted">
              <UIcon :name="sharing.visibility === 'link' ? 'i-tabler-world' : 'i-tabler-lock'" class="w-4 h-4" />
            </div>
            <div class="min-w-0 flex-1">
              <USelect
                :model-value="sharing.visibility"
                :items="ACCESS_OPTIONS"
                value-key="value"
                variant="ghost"
                class="-ml-2.5"
                :disabled="savingAccess"
                @update:model-value="setVisibility"
              />
              <p class="text-xs text-muted">
                {{ sharing.visibility === 'link' ? $t('boards.share.link_on') : $t('boards.share.link_off') }}
              </p>
            </div>
          </div>

          <div v-if="sharing.visibility === 'link'" class="flex gap-2">
            <UInput
              :model-value="sharing.shareUrl ?? ''"
              readonly
              class="flex-1 min-w-0"
              :placeholder="sharing.needsRotate ? $t('boards.share.link_reset_to_show') : $t('boards.share.link_unavailable')"
              @focus="$event.target.select()"
            />
            <UButton
              v-if="sharing.shareUrl"
              icon="i-tabler-copy"
              color="neutral"
              variant="soft"
              :label="$t('boards.share.copy_link')"
              @click="copyLink"
            />
            <UButton
              :color="confirmingReset ? 'error' : 'neutral'"
              :variant="confirmingReset ? 'soft' : 'ghost'"
              :label="confirmingReset ? $t('boards.share.click_again') : sharing.needsRotate && !sharing.shareUrl ? $t('boards.share.create_link') : $t('boards.share.reset_link')"
              :loading="rotating"
              @click="resetLink"
            />
          </div>
        </section>
      </template>
    </template>

    <template #footer>
      <UButton
        v-if="!isOwner"
        color="error"
        variant="ghost"
        class="mr-auto"
        :label="$t('boards.leave')"
        @click="leave"
      />
      <UButton class="ml-auto" :label="$t('boards.share.done')" @click="showShareBoardModal = false" />
    </template>
  </UModal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'

const store = useStore()
const { t } = useI18n()
const { showShareBoardModal, boardToShare: board } = storeToRefs(store)

const ROLE_OPTIONS = computed(() => [
  { label: t('boards.share.can_view'), value: 'viewer' },
  { label: t('boards.share.can_edit'), value: 'editor' }
])
const ACCESS_OPTIONS = computed(() => [
  { label: t('boards.share.access_private'), value: 'private' },
  { label: t('boards.share.access_link'), value: 'link' }
])
// The server takes 20 per request; a longer paste would be refused wholesale.
const MAX_PER_INVITE = 20
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

const sharing = ref(null)
const loading = ref(false)
const loadError = ref('')
const emails = ref([])
const inviteRole = ref('viewer')
const inviting = ref(false)
/** Invite links for people the server could not email. */
const unsentInvites = ref([])
const savingAccess = ref(false)
const rotating = ref(false)
const busyMember = ref(null)

const isOwner = computed(() => (board.value?.role ?? 'owner') === 'owner')
const validEmails = computed(() => [...new Set(emails.value.map(e => e.trim().toLowerCase()).filter(e => EMAIL.test(e)))])
const invalidEmails = computed(() => emails.value.map(e => e.trim()).filter(e => e && !EMAIL.test(e)))

const errorMessage = (error, fallback) => error?.data?.message || error?.data?.statusMessage || fallback

const load = async () => {
  if (!board.value?.id) return
  loading.value = true
  loadError.value = ''
  try {
    sharing.value = await useBoards().getBoardSharing(board.value.id)
  } catch (error) {
    console.error('Error loading board sharing:', error)
    loadError.value = t('boards.share.load_error')
  } finally {
    loading.value = false
  }
}

watch(showShareBoardModal, (open) => {
  if (!open) return
  sharing.value = null
  emails.value = []
  inviteRole.value = 'viewer'
  load()
}, { immediate: true })

/** Keep the sidebar's "shared" marker in step with what this dialog just changed. */
const syncShared = () => {
  store.replaceBoard({
    id: board.value.id,
    visibility: sharing.value.visibility,
    shared: sharing.value.visibility === 'link' || sharing.value.members.length > 0
  })
}

const invite = async () => {
  if (!validEmails.value.length || inviting.value) return
  inviting.value = true
  try {
    const { members, inviteLinks } = await useBoards().inviteToBoard(
      board.value.id,
      validEmails.value.map(email => ({ email, role: inviteRole.value }))
    )
    sharing.value.members = members
    unsentInvites.value = Array.isArray(inviteLinks) ? inviteLinks : []
    syncShared()
    store.showAlert({ message: t('boards.share.invited', validEmails.value.length) })
    // What was sent is cleared; a typo stays in the box for the user to fix.
    emails.value = emails.value.filter(e => !EMAIL.test(e.trim()))
  } catch (error) {
    console.error('Error inviting to board:', error)
    store.showAlert({ message: errorMessage(error, t('boards.share.invite_error')), type: 'danger' })
  } finally {
    inviting.value = false
  }
}

const copyInviteLink = async (link) => {
  try {
    await navigator.clipboard.writeText(link)
    store.showAlert({ message: t('boards.share.link_copied') })
  } catch (error) {
    console.error('Could not copy the invite link:', error)
  }
}

const changeRole = async (member, role) => {
  if (role === member.role) return
  busyMember.value = member.id
  try {
    await useBoards().updateBoardMember(board.value.id, member.id, role)
    member.role = role
  } catch (error) {
    console.error('Error changing member role:', error)
    store.showAlert({ message: errorMessage(error, t('boards.share.role_error')), type: 'danger' })
  } finally {
    busyMember.value = null
  }
}

const removeMember = async (member) => {
  busyMember.value = member.id
  try {
    await useBoards().removeBoardMember(board.value.id, member.id)
    sharing.value.members = sharing.value.members.filter(m => m.id !== member.id)
    syncShared()
  } catch (error) {
    console.error('Error removing member:', error)
    store.showAlert({ message: errorMessage(error, t('boards.share.remove_error')), type: 'danger' })
  } finally {
    busyMember.value = null
  }
}

const setVisibility = async (visibility) => {
  if (visibility === sharing.value.visibility) return
  savingAccess.value = true
  try {
    const response = await useBoards().updateBoardSharing(board.value.id, visibility)
    sharing.value.visibility = visibility
    sharing.value.shareUrl = response.shareUrl ?? null
    // A link switched on again after an old one was reset needs no reset.
    if (visibility === 'link' && response.shareUrl) sharing.value.needsRotate = false
    store.replaceBoard(response.board)
    syncShared()
  } catch (error) {
    console.error('Error updating board access:', error)
    store.showAlert({ message: errorMessage(error, t('boards.share.access_error')), type: 'danger' })
  } finally {
    savingAccess.value = false
  }
}

const copyLink = async () => {
  try {
    await navigator.clipboard.writeText(sharing.value.shareUrl)
    store.showAlert({ message: t('boards.share.link_copied') })
  } catch (error) {
    console.error('Error copying link:', error)
    store.showAlert({ message: t('boards.share.link_copy_error'), type: 'danger' })
  }
}

// Confirmed in place: an alert raised from here would sit under the modal's overlay.
const confirmingReset = ref(false)
const resetLink = async () => {
  // Creating the first re-showable link breaks nothing; resetting a working one does.
  if (sharing.value.shareUrl && !confirmingReset.value) {
    confirmingReset.value = true
    setTimeout(() => { confirmingReset.value = false }, 4000)
    return
  }
  confirmingReset.value = false
  rotating.value = true
  try {
    const { shareUrl } = await useBoards().rotateShareLink(board.value.id)
    sharing.value.shareUrl = shareUrl
    sharing.value.needsRotate = false
    store.showAlert({ message: t('boards.share.new_link') })
  } catch (error) {
    console.error('Error resetting link:', error)
    store.showAlert({ message: errorMessage(error, t('boards.share.reset_error')), type: 'danger' })
  } finally {
    rotating.value = false
  }
}

// The confirmation is an alert, which would sit under this modal's overlay:
// step aside for it, and come back if the answer was no.
const leave = async () => {
  showShareBoardModal.value = false
  if (!await store.leaveBoardAction(board.value)) showShareBoardModal.value = true
}
</script>
