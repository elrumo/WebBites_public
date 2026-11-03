<template>
  <div class="tiptap-comment-editor">
    <editor-content
      :editor="editor"
      class="comment-editor-content"
    />

    <!-- Simple Bubble Menu for text formatting -->
    <BubbleMenu
      v-if="editor"
      :editor="editor"
      :options="{ placement: 'top' }"
    >
      <div class="bubble-menu-wrapper">
        <UFieldGroup size="xs">
          <UButton
            :color="editor?.isActive('bold') ? 'black' : 'gray'"
            @click="editor.chain().focus().toggleBold().run()"
          >
            B
          </UButton>
          <UButton
            icon="i-heroicons-italic"
            :color="editor?.isActive('italic') ? 'black' : 'gray'"
            @click="editor.chain().focus().toggleItalic().run()"
          />
          <UButton
            icon="i-heroicons-strikethrough"
            :color="editor?.isActive('strike') ? 'black' : 'gray'"
            @click="editor.chain().focus().toggleStrike().run()"
          />
          <UButton
            icon="i-heroicons-list-bullet"
            :color="editor?.isActive('bulletList') ? 'black' : 'gray'"
            @click="editor.chain().focus().toggleBulletList().run()"
          />
          <UButton
            icon="i-heroicons-link"
            :color="editor?.isActive('link') ? 'black' : 'gray'"
            @click="setLink()"
          />
        </UFieldGroup>
      </div>
    </BubbleMenu>

    <!-- Link Dialog Modal -->
    <UModal v-model:open="showLinkDialog">
      <template #content>
        <UCard :ui="{ root: 'ring-0 divide-y divide-gray-100 dark:divide-gray-800' }">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-2">
              {{ $t('tiptap_editor.url_to_link') }}
            </label>
            <UInput
              class="md:min-w-[280px]"
              v-model="linkUrl"
              placeholder="https://example.com"
              @keydown.enter="handleLinkSubmit"
              @keydown.escape="handleLinkCancel"
              autofocus
            />
          </div>
        </div>

        <template #footer>
          <div class="flex justify-between w-full">
            <UButton color="neutral" variant="ghost" @click="handleLinkCancel">
              {{ $t('common.cancel') }}
            </UButton>
            <UButton color="primary" @click="handleLinkSubmit" :disabled="!linkUrl.trim()">
              {{ $t('tiptap_editor.add_link') }}
            </UButton>
          </div>
        </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { StarterKit } from '@tiptap/starter-kit'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// Props
const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  placeholder: {
    type: String,
    default: '',
  }
})

// Emits
const emit = defineEmits(['update:modelValue', 'submit'])

// Refs
const editor = ref(null)
const showLinkDialog = ref(false)
const linkUrl = ref('')

// Watch for external changes
watch(() => props.modelValue, (value) => {
  if (editor.value != null) {
    const isSame = editor.value.getHTML() === value
    if (isSame) return
    editor.value.commands.setContent(value, false)
  }
})

// Link handling
const setLink = () => {
  const previousUrl = editor.value.getAttributes('link').href

  if (previousUrl) {
    editor.value
      .chain()
      .focus()
      .extendMarkRange('link')
      .unsetLink()
      .run()
    return
  }

  linkUrl.value = ''
  showLinkDialog.value = true
}

const handleLinkSubmit = () => {
  const url = linkUrl.value.trim()

  if (!url) {
    showLinkDialog.value = false
    return
  }

  // Validate URL format
  if (!url.match(/^https?:\/\//)) {
    linkUrl.value = 'https://' + url
    return
  }

  editor.value
    .chain()
    .focus()
    .extendMarkRange('link')
    .setLink({ href: url })
    .run()

  showLinkDialog.value = false
  linkUrl.value = ''
}

const handleLinkCancel = () => {
  showLinkDialog.value = false
  linkUrl.value = ''
}

// Keyboard shortcuts handler
const handleKeyDown = (e) => {
  // Ctrl/Cmd + Enter to submit
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    emit('submit')
  }
}

// Lifecycle
onMounted(() => {
  editor.value = new Editor({
    extensions: [
      StarterKit.configure({
        // Disable link in StarterKit to avoid duplication
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary-500 underline',
        },
      }),
      Placeholder.configure({
        placeholder: props.placeholder || t('feedback.comments.placeholder'),
      }),
    ],
    content: props.modelValue,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      emit('update:modelValue', html)
    },
  })

  // Add keyboard listener
  if (editor.value?.view?.dom) {
    editor.value.view.dom.addEventListener('keydown', handleKeyDown)
  }
})

onBeforeUnmount(() => {
  if (editor.value?.view?.dom) {
    editor.value.view.dom.removeEventListener('keydown', handleKeyDown)
  }
  editor.value?.destroy()
})

// Expose methods for parent component
defineExpose({
  focus: () => editor.value?.commands.focus(),
  clear: () => editor.value?.commands.clearContent(),
  getHTML: () => editor.value?.getHTML() || '',
})
</script>

<style scoped>
@reference "../assets/css/tailwind.css";
.tiptap-comment-editor {
  @apply w-full;
}

/* Flat, not nested in the rule above: nested, the :deep() compiled to
   `.tiptap-comment-editor [data-v] .comment-editor-content`, which never
   matched because the content element carries the data-v attribute itself. */
.tiptap-comment-editor :deep(.comment-editor-content) {
    @apply 
      min-h-[100px] max-h-[300px] overflow-y-auto
      p-0.5
    ;

    .ProseMirror {
      @apply 
        min-h-[100px]
        p-3 rounded-lg outline-none
        bg-white dark:bg-neutral-900
        border border-gray-300 dark:border-neutral-700
        focus:ring-2 focus:ring-green-500 focus:border-emerald-500;

      /* Plain declarations: @apply here nests a `& {}` inside ::before,
         which browsers drop, so the placeholder never showed. */
      p.is-editor-empty:first-child::before {
        color: var(--color-neutral-500);
        font-size: var(--text-sm);
        content: attr(data-placeholder);
        float: left;
        height: 0;
        pointer-events: none;
      }

      /* Basic text formatting */
      p {
        @apply mb-2 text-sm;
      }

      strong {
        @apply font-bold;
      }

      em {
        @apply italic;
      }

      a {
        @apply text-green-500 underline cursor-pointer;
      }

      ul {
        @apply list-disc pl-1 mb-0.5;
      }

      ol {
        @apply list-decimal pl-1 mb-0.5;
      }

      li {
        @apply mb-1;
      }

      code {
        @apply bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm font-mono;
      }

      pre {
        @apply bg-gray-100 dark:bg-gray-800 p-3 rounded mb-2;

        code {
          @apply bg-transparent p-0;
        }
      }

      blockquote {
        @apply border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic mb-2;
      }
    }
}

:deep(.bubble-menu-wrapper) {
  @apply flex gap-1 p-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700;
}
</style>
