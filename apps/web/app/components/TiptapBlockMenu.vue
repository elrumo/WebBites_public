<template>
  <Teleport to="body">
    <div v-if="open && rect" class="block-menu__scrim" @mousedown="$emit('close')" />
    <div
      v-if="open && rect"
      class="block-menu"
      :style="position"
      @mousedown.prevent
    >
      <button type="button" class="block-menu__row" @click="duplicate">
        <UIcon name="i-heroicons-square-2-stack" class="block-menu__icon" />
        <span>{{ $t('editor.block_menu.duplicate') }}</span>
      </button>
      <button type="button" class="block-menu__row" @click="copyText">
        <UIcon name="i-heroicons-document-duplicate" class="block-menu__icon" />
        <span>{{ $t('editor.block_menu.copy_text') }}</span>
      </button>
      <button type="button" class="block-menu__row block-menu__row--danger" @click="remove">
        <UIcon name="i-heroicons-trash" class="block-menu__icon" />
        <span>{{ $t('common.delete') }}</span>
      </button>

      <p class="block-menu__heading">{{ $t('editor.block_menu.turn_into') }}</p>
      <button
        v-for="command in turnInto"
        :key="command.id"
        type="button"
        class="block-menu__row"
        @click="convert(command)"
      >
        <UIcon :name="command.icon" class="block-menu__icon" />
        <span>{{ command.title }}</span>
        <UIcon
          v-if="isCurrent(command)"
          name="i-heroicons-check"
          class="block-menu__check"
        />
      </button>
    </div>
  </Teleport>
</template>

<script setup>
  import { computed } from 'vue'
  import { SLASH_COMMANDS } from './extensions/slashCommands'

  /**
   * The menu behind the grip in the margin — Notion's block handle.
   *
   * It acts on one node, named by its document position, rather than on the
   * caret: the pointer is rarely in the block it is hovering. Everything it
   * offers runs ordinary editor commands, so the stored HTML is unchanged.
   */
  const props = defineProps({
    editor: { type: Object, default: null },
    open: { type: Boolean, default: false },
    /** Where the grip is, in viewport coordinates. */
    rect: { type: Object, default: null },
    /** The document position of the block the grip belongs to. */
    pos: { type: Number, default: null },
  })

  const emit = defineEmits(['close'])

  const PANEL_WIDTH = 208
  const PANEL_MAX_HEIGHT = 380

  // A picture can't become a paragraph and a divider has nothing to convert,
  // so neither is offered — the same two exclusions the native apps make.
  const turnInto = computed(() =>
    SLASH_COMMANDS.filter((command) => !['image', 'horizontalRule'].includes(command.id))
  )

  const position = computed(() => {
    const rect = props.rect
    if (!rect) return {}
    const gap = 6
    const left = Math.min(Math.max(gap, rect.left), window.innerWidth - PANEL_WIDTH - gap)
    const room = window.innerHeight - rect.bottom
    return room < PANEL_MAX_HEIGHT + gap && rect.top > room
      ? { left: `${left}px`, bottom: `${window.innerHeight - rect.top + gap}px` }
      : { left: `${left}px`, top: `${rect.bottom + gap}px` }
  })

  function node() {
    if (!props.editor || props.pos === null) return null
    return props.editor.state.doc.nodeAt(props.pos)
  }

  const isCurrent = (command) => {
    try {
      return props.editor ? command.isActive(props.editor) : false
    } catch {
      return false
    }
  }

  function duplicate() {
    const target = node()
    if (target) {
      props.editor
        .chain()
        .focus()
        .insertContentAt(props.pos + target.nodeSize, target.toJSON())
        .run()
    }
    emit('close')
  }

  function copyText() {
    const target = node()
    if (target) navigator.clipboard?.writeText(target.textContent)
    emit('close')
  }

  function remove() {
    const target = node()
    if (target) {
      props.editor
        .chain()
        .focus()
        .deleteRange({ from: props.pos, to: props.pos + target.nodeSize })
        .run()
    }
    emit('close')
  }

  function convert(command) {
    const target = node()
    if (target) {
      // Put the caret inside the block first: the conversions are all
      // selection-based, and this is the block the grip is pointing at.
      command.run(props.editor.chain().focus().setTextSelection(props.pos + 1), {})
    }
    emit('close')
  }
</script>

<style scoped>
@reference "../assets/css/tailwind.css";

.block-menu__scrim {
  @apply fixed inset-0 z-[69];
}

.block-menu {
  @apply fixed z-[70] w-[208px] max-h-[380px] overflow-y-auto p-1
         rounded-xl border border-gray-200 dark:border-gray-800
         bg-white/95 dark:bg-gray-900/95 backdrop-blur
         shadow-xl shadow-black/10 dark:shadow-black/40;
}

.block-menu__heading {
  @apply px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide
         text-gray-400 dark:text-gray-500;
}

.block-menu__row {
  @apply flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm
         text-gray-800 dark:text-gray-200
         hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors;
}

.block-menu__row--danger {
  @apply text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40;
}

.block-menu__icon {
  @apply shrink-0 text-gray-400 dark:text-gray-500;
}

.block-menu__check {
  @apply ml-auto shrink-0 text-gray-400 dark:text-gray-500;
}
</style>
