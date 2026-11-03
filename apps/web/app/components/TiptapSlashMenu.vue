<template>
  <Teleport to="body">
    <div
      v-if="state.active && state.rect"
      ref="panel"
      class="slash-menu"
      :style="position"
      @mousedown.prevent
    >
      <template v-if="matches.length">
        <div v-for="group in groups" :key="group" class="slash-menu__group">
          <p class="slash-menu__heading">{{ $t(`editor.slash.groups.${group}`) }}</p>
          <button
            v-for="entry in entriesFor(group)"
            :key="entry.command.id"
            type="button"
            class="slash-menu__row"
            :class="{ 'slash-menu__row--on': entry.index === selected }"
            @mouseenter="selected = entry.index"
            @click="run(entry.command)"
          >
            <span class="slash-menu__icon" :class="{ 'slash-menu__icon--on': entry.index === selected }">
              <UIcon :name="entry.command.icon" />
            </span>
            <span class="slash-menu__text">
              <span class="slash-menu__title">{{ entry.command.title }}</span>
              <span class="slash-menu__subtitle">{{ entry.command.subtitle }}</span>
            </span>
            <UIcon
              v-if="isCurrent(entry.command)"
              name="i-heroicons-check"
              class="slash-menu__check"
            />
          </button>
        </div>
      </template>

      <p v-else class="slash-menu__empty">
        {{ $t('editor.slash.no_match', { query: state.query }) }}
      </p>
    </div>
  </Teleport>
</template>

<script setup>
  import { computed, nextTick, ref, watch } from 'vue'
  import { matchSlashCommands, SLASH_GROUPS } from './extensions/slashCommands'
  import { dismissSlashCommand } from './extensions/SlashCommand'

  /**
   * The "/" palette.
   *
   * A view only: it filters the catalogue, tracks which row is highlighted and
   * runs the entry that is taken. The trigger itself — where the slash is and
   * what has been typed after it — belongs to the `SlashCommand` extension.
   */
  const props = defineProps({
    editor: { type: Object, default: null },
    /** `{ active, query, from, to, rect }`, straight from the extension. */
    state: { type: Object, required: true },
    /** Called when the Image entry is taken; the picker is the editor's. */
    addImage: { type: Function, default: null },
  })

  const PANEL_WIDTH = 292
  const PANEL_MAX_HEIGHT = 320

  const panel = ref(null)
  const selected = ref(0)

  const matches = computed(() => (props.state.active ? matchSlashCommands(props.state.query) : []))

  const groups = computed(() =>
    SLASH_GROUPS.filter((group) => matches.value.some((command) => command.group === group))
  )

  /** Rows carry their index in the flat list, which is what the keys move. */
  const entriesFor = (group) =>
    matches.value
      .map((command, index) => ({ command, index }))
      .filter((entry) => entry.command.group === group)

  const isCurrent = (command) => {
    try {
      return props.editor ? command.isActive(props.editor) : false
    } catch {
      return false
    }
  }

  // A new query is a new list: keeping the old row highlighted would leave
  // Enter taking whatever happened to land in that position.
  watch(() => props.state.query, () => { selected.value = 0 })
  watch(() => props.state.active, (active) => { if (active) selected.value = 0 })

  const position = computed(() => {
    const rect = props.state.rect
    if (!rect) return {}

    const gap = 8
    const room = window.innerHeight - rect.bottom
    const flip = room < PANEL_MAX_HEIGHT + gap && rect.top > room

    const left = Math.min(
      Math.max(gap, rect.left - gap),
      Math.max(gap, window.innerWidth - PANEL_WIDTH - gap)
    )

    return flip
      ? { left: `${left}px`, bottom: `${window.innerHeight - rect.top + gap}px` }
      : { left: `${left}px`, top: `${rect.bottom + gap}px` }
  })

  function move(delta) {
    if (!matches.value.length) return
    const count = matches.value.length
    selected.value = ((selected.value + delta) % count + count) % count
    nextTick(() => {
      panel.value
        ?.querySelector('.slash-menu__row--on')
        ?.scrollIntoView({ block: 'nearest' })
    })
  }

  function run(command) {
    if (!props.editor || props.state.from === null) return
    const chain = props.editor
      .chain()
      .focus()
      .deleteRange({ from: props.state.from, to: props.state.to })
    command.run(chain, { addImage: props.addImage })
  }

  /**
   * First refusal on keys while the menu is open. Returns true when the key was
   * taken, in which case the editor must not also act on it.
   */
  function handleKeyDown(event) {
    if (!props.state.active) return false

    switch (event.key) {
      case 'ArrowDown':
        move(1)
        return true
      case 'ArrowUp':
        move(-1)
        return true
      case 'Enter':
        if (event.shiftKey) return false
        if (!matches.value.length) return false
        run(matches.value[selected.value])
        return true
      case 'Escape':
        dismissSlashCommand(props.editor)
        return true
      default:
        return false
    }
  }

  defineExpose({ handleKeyDown })
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.slash-menu {
  @apply fixed z-[70] w-[292px] max-h-[320px] overflow-y-auto p-1
         rounded-xl border border-gray-200 dark:border-gray-800
         bg-white/95 dark:bg-gray-900/95 backdrop-blur
         shadow-xl shadow-black/10 dark:shadow-black/40;
}

.slash-menu__heading {
  @apply px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide
         text-gray-400 dark:text-gray-500;
}

.slash-menu__row {
  @apply flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left
         transition-colors;
}

/* The accent lives in Nuxt UI's theme layer, which `@reference "tailwindcss"`
   does not load — so `@apply bg-primary-500` fails to resolve here even though
   the same class works in markup. The variable does. */
.slash-menu__row--on {
  background-color: color-mix(in oklab, var(--color-primary-500) 12%, transparent);
}

.slash-menu__icon {
  @apply flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg
         bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400;
}

.slash-menu__icon--on {
  background-color: color-mix(in oklab, var(--color-primary-500) 20%, transparent);
  color: var(--color-primary-600);
}

:global(.dark) .slash-menu__icon--on {
  color: var(--color-primary-400);
}

.slash-menu__text {
  @apply flex min-w-0 flex-col;
}

.slash-menu__title {
  @apply truncate text-sm font-medium text-gray-900 dark:text-gray-100;
}

.slash-menu__subtitle {
  @apply truncate text-xs text-gray-500 dark:text-gray-400;
}

.slash-menu__check {
  @apply ml-auto shrink-0 text-gray-400 dark:text-gray-500;
}

.slash-menu__empty {
  @apply px-3 py-2 text-xs text-gray-500 dark:text-gray-400;
}
</style>
