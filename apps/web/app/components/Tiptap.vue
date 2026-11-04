<template>
  <div class="relative">

    <!-- Main Editor Container -->
    <div
      :class="[
        'transition-all duration-300 ease-in-out h-full',
        newBookmark ? 'new-bookmark-tiptap' : widePage ? 'max-w-6xl' : 'max-w-prose',
        'mx-auto rounded-lg'
      ]"
    >
      <editor-content
        :class="{ 'outline-when-focused': outlineWhenFocused }"
        :id="id"
        :editor="editor"
        @drop="onTipTapDrop"
        @drop.prevent
      />
        <!-- class="min-h-[200px] p-4" -->
    </div>

    <!-- Page Width Toggle -->
    <div
      v-if="!newBookmark && !store.isMobile"
      class="fixed bottom-6 right-6 flex flex-col gap-4"
    >
      
      <!-- TODO: Implement listening to -->
      <!-- <UButton
        color="neutral"
        variant="ghost"
        icon="i-heroicons-speaker-wave"
        @click="listenToText"
        class="shadow-lg hover:shadow-xl transition-shadow"
      >
        Listen
      </UButton> -->

      <UButton
        color="neutral"
        variant="ghost"
        :icon="widePage ? 'i-heroicons-arrows-pointing-in' : 'i-heroicons-arrows-pointing-out'"
        class="shadow-lg hover:shadow-xl transition-shadow"
        @click="widePage = !widePage"
        >
        {{ widePage ? $t('tiptap_editor.narrow_view') : $t('tiptap_editor.wide_view') }}
      </UButton>
    </div>

    <!-- Floating menu: the one thing an empty line has to offer that "/" does
         not — pasting a URL in as a bookmark card. Every other block now lives
         behind the slash palette, which is why this is a single button. -->
    <FloatingMenu
      v-if="editor"
      :editor="editor"
      :should-show="shouldShowFloatingMenu"
      :options="{ placement: 'top-start' }"
    >
      <div class="wb-floating-menu">
        <UButton
          color="primary"
          variant="ghost"
          size="xs"
          icon="i-heroicons-link"
          @click="pasteUrl()"
        >
          {{ $t('tiptap_editor.paste_url') }}
        </UButton>
      </div>
    </FloatingMenu>

    <!-- Bubble Menu -->
    <BubbleMenu
      v-if="editor"
      :editor="editor"
      :should-show="shouldShowBubbleMenu"
      :options="{ placement: 'bottom-start' }"
    >
      <div class="bubble-menu-wrapper wb-bubble-menu">
      <!-- Image Controls -->
      <template v-if="isImageSelected">
        <UFieldGroup size="xs">
          <UButton
            v-for="size in ['small', 'big', 'biggest']"
            :key="size"
            variant="ghost"
            @click="setImageWidth(size)"
          >
            {{ $t(`tiptap_editor.image_size.${size}`) }}
          </UButton>
        </UFieldGroup>
      </template>

      <!-- Text Controls -->
      <template v-else>
        <UFieldGroup size="xs">
          <UButton
            icon="i-heroicons-photo"
            @click="addImage()"
          />
          <UButton
            :color="editor?.isActive('codeBlock') ? 'black' : 'gray'"
            @click="editor.chain().focus().toggleCodeBlock().run()"
          >
            <span class="font-mono">
              &lt;/&gt;
            </span>
          </UButton>
          <UButton
            icon="i-heroicons-check-circle"
            :color="editor?.isActive('taskList') ? 'black' : 'gray'"
            @click="toggleTaskList()"
          />
        </UFieldGroup>

        <UFieldGroup size="xs">
          <UButton
            v-for="level in [1, 2, 3]"
            :key="level"
            :color="editor?.isActive('heading', { level }) ? 'black' : 'gray'"
            @click="editor.chain().focus().toggleHeading({ level }).run()"
          >
            H{{ level }}
          </UButton>
        </UFieldGroup>

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
            :color="editor?.isActive('link')? 'black' : 'gray'"
            @click="setLink()"
          />
        </UFieldGroup>
      </template>
      </div>
    </BubbleMenu>

    <!-- The "/" palette, and the menu behind the grip in the margin. Both are
         views over commands this editor already had; neither writes markup of
         its own, so the HTML stays what the native apps expect. -->
    <TiptapSlashMenu
      ref="slashMenu"
      :editor="editor"
      :state="slashState"
      :add-image="addImage"
    />

    <TiptapBlockMenu
      :editor="editor"
      :open="blockMenu.open"
      :rect="blockMenu.rect"
      :pos="blockMenu.pos"
      @close="blockMenu.open = false"
    />

    <!-- Link Dialog Modal -->
    <UModal v-model:open="showLinkDialog">
      <template #content>
        <UCard :ui="{ root: 'ring-0 divide-y divide-gray-100 dark:divide-gray-800' }">
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-2">
              {{ $t('tiptap_editor.url_to_link') }}
              {{ showLinkDialog }}
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
  import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
  import { storeToRefs } from 'pinia'
  import { useStore } from '~/stores/myStore'
  import Parse from 'parse'
  import { useI18n } from 'vue-i18n';
  const { t } = useI18n();

  import { StarterKit } from '@tiptap/starter-kit'
  import { Heading } from '@tiptap/extension-heading'
  import { Link } from '@tiptap/extension-link'
  import { TaskItem, TaskList, BulletList, OrderedList, ListItem } from '@tiptap/extension-list'
  import { Highlight } from '@tiptap/extension-highlight'
  import { Image } from '@tiptap/extension-image'
  import { Placeholder } from '@tiptap/extensions'
  import DragHandle from '@tiptap/extension-drag-handle'
  import NodeRange from '@tiptap/extension-node-range'
  import { BookmarkNode } from './extensions/BookmarkNode'
  import { ImageGallery } from './extensions/ImageGallery'
  import { SlashCommand } from './extensions/SlashCommand'
  import { matchSlashCommands } from './extensions/slashCommands'

  // Implement Global Drag Handle
  // import GlobalDragHandle from 'tiptap-extension-global-drag-handle'

  import css from 'highlight.js/lib/languages/css'
  import js from 'highlight.js/lib/languages/javascript'
  import ts from 'highlight.js/lib/languages/typescript'
  import html from 'highlight.js/lib/languages/xml'
  import { createLowlight } from 'lowlight'
  import { Editor, EditorContent } from '@tiptap/vue-3'
  import { BubbleMenu, FloatingMenu } from '@tiptap/vue-3/menus'

  const lowlight = createLowlight()
  lowlight.register({ html, css, js, ts })

  // Props
  const {
      modelValue,
      id,
      visible,
      newBookmark,
      showFloatingMenu,
      outlineWhenFocused,
      placeholder
    } = defineProps({
      modelValue: {
        type: String,
        default: '',
      },
      id: {
        type: String,
        default: 'tipTapEditor',
      },
      visible: {
        type: Boolean,
        default: true
      },
      newBookmark: {
        type: Boolean,
        default: false
      },
      showFloatingMenu: {
        type: Boolean,
        default: true
      },
      outlineWhenFocused: {
        type: Boolean,
        default: true
      },
      /** First-line prompt. Empty keeps the editor's own note prompt. */
      placeholder: {
        type: String,
        default: ''
      }
  })

  // Emits
  const emit = defineEmits([
    'update:modelValue',
    'pasteNewUrl'
  ])

  // Store
  const store = useStore()
  const {
    pasteBoard,
    hasFocusTipTap,
    typeOfNewBookmark,
    widePage,
    showLinkDialog
  } = storeToRefs(store)
  const { showAlert, getBase64 } = store

  // Refs
  const editor = ref(null)
  const isImageSelected = ref(false)
  const selectedNode = ref(null)

  // The "/" palette. `slashState` is published by the SlashCommand extension;
  // `slashMenu` is the component that draws it and owns the highlighted row.
  const slashMenu = ref(null)
  const slashState = ref({ active: false, query: '', from: null, to: null, rect: null })

  // The block the drag handle is currently pointing at, and the menu its grip
  // opens. `pos` is a document position, not a DOM node: the menu acts on the
  // block the pointer is over, which is rarely the one the caret is in.
  const handlePos = ref(null)
  const blockMenu = ref({ open: false, rect: null, pos: null })
  
  const linkUrl = ref('')

  // Watch handlers
  watch(() => modelValue, (value) => {
    if (editor.value != null) {
      const isSame = editor.value.getHTML() === value
      if (isSame) return
      editor.value.commands.setContent(value, false)
    }
  })

  watch(() => visible, (value) => {
    if (value) editor.value.commands.focus()
  })

  // The prompt is read while ProseMirror builds its decorations, and it only
  // rebuilds them on a transaction. An empty one is enough to repaint a prompt
  // that changed while the field sat untouched — which is exactly what happens
  // when the new-bookmark composer switches type.
  watch(() => placeholder, () => {
    if (!editor.value) return
    editor.value.view.dispatch(editor.value.state.tr)
  })

  // watch(() => typeOfNewBookmark.value, (value) => {
  //   if (value === 'game') {
  //     editor.value.commands.updatePlaceholder('Search for a game')
  //   } else if (value === 'movie') {
  //     editor.value.commands.updatePlaceholder('Search for a movie')
  //   }
  // })

  ////////// Methods

  const CustomImage = Image.extend({
    addAttributes() {
      return {
        ...this.parent?.() || {},
        size: {
          default: 'big',
          parseHTML: element => element.getAttribute('data-size'),
          renderHTML: attributes => {
            return {
              'data-size': attributes.size,
              'class': `tiptap-image ${attributes.size || 'big'}`
            }
          }
        }
      }
    }
  })

  const CustomTaskItem = TaskItem.extend({
    content: 'inline*',
    addInputRules() {
      return [
        {
          find: /^\s*-\s\[\s\]\s$/,
          handler: ({ state, range, match }) => {
            const { tr } = state
            const start = range.from
            const end = range.to
            
            tr.delete(start, end)
            tr.setBlockType(start, start, this.editor.schema.nodes.taskItem, { checked: false })
            
            // Wrap in task list if not already in one
            if (!this.editor.isActive('taskList')) {
              tr.wrapIn(this.editor.schema.nodes.taskList)
            }
            
            return tr
          }
        },
        {
          find: /^\s*-\s\[x\]\s$/,
          handler: ({ state, range, match }) => {
            const { tr } = state
            const start = range.from
            const end = range.to
            
            tr.delete(start, end)
            tr.setBlockType(start, start, this.editor.schema.nodes.taskItem, { checked: true })
            
            // Wrap in task list if not already in one
            if (!this.editor.isActive('taskList')) {
              tr.wrapIn(this.editor.schema.nodes.taskList)
            }
            
            return tr
          }
        }
      ]
    }
  })

  async function listenToText(){
    
  }

  const toggleTaskList = () => {
    const { selection, doc } = editor.value.state
    const { from, empty } = selection

    // If we have a selection or cursor position, check what we're dealing with
    if (!empty) {
      // If there's a selection, convert it to a task list
      editor.value.chain().focus().toggleTaskList().run()
    } else {
      // Check if cursor is in a paragraph or other node that can be converted
      const $pos = doc.resolve(from)
      
      // Check if we're already in a task list
      if (editor.value.isActive('taskList')) {
        // Toggle off task list
        editor.value.chain().focus().toggleTaskList().run()
      } else {
        // Check if we're in a paragraph or other convertible node
        const parentNode = $pos.parent
        
        if (parentNode && (parentNode.type.name === 'paragraph' || parentNode.type.name === 'heading')) {
          // Convert current paragraph/heading to a task list
          const nodeStart = $pos.start($pos.depth)
          const nodeEnd = nodeStart + parentNode.nodeSize
          
          // Select the current node and convert to task list
          editor.value.chain()
            .focus()
            .setTextSelection({ from: nodeStart, to: nodeEnd })
            .toggleTaskList()
            .run()
        } else {
          // Just create a new task list
          editor.value.chain().focus().toggleTaskList().run()
        }
      }
    }
  }

  async function pasteUrl() {
    if(newBookmark) return emit('pasteNewUrl')
    console.log('[Tiptap] text: ', text)

    try {
      if(showLinkDialog.value) return
      const text = await navigator.clipboard.readText();

      if (text) {
        editor.value.commands.insertContent(text);
        editor.value.commands.setLink({ href: text });
        editor.value.commands.focus();
        addPreviewNode(text);
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  }

  const selectionUpdated = (editorInstance) => {
    if (!editorInstance || !editorInstance.state) return

    const { from } = editorInstance.state.selection
    if (from === undefined) return

    const node = editorInstance.state.doc.nodeAt(from)
    selectedNode.value = node

    if (!node) {
      isImageSelected.value = false
      return
    }

    const type = node.type.name
    isImageSelected.value = type === 'image'
  }

const setImageWidth = (size) => {
    const { from } = editor.value.state.selection
    const node = editor.value.state.doc.nodeAt(from)

    if (!node || node.type.name !== 'image') return

    // Get current node attributes and update size
    const attrs = { ...node.attrs, size }

    // Update the image with new size
    editor.value.chain()
      .focus()
      .setImage(attrs)
      .run()
  }

  const saveFile = async (file) => {
    console.log('[Tiptap] saveFile: ', file)
    let parseFile = new Parse.File(file.name, file)
    const Files = Parse.Object.extend("files")
    let fileObject = new Files()
    fileObject.setACL(new Parse.ACL(Parse.User.current()))
    fileObject.set("file", parseFile)
    fileObject.set("user", Parse.User.current())
    await fileObject.save()
    return parseFile
  }

  const addImage = async (imageFile) => {
    try {
      let savedFile;
      let file;

      // If imageFile is provided, use it directly
      if (imageFile) {
        file = imageFile;
        savedFile = await saveFile(file)

        if (editor.value) {
          const imageAttrs = {
            src: savedFile.url(),
            alt: sanitizeFileName(file.name),
            size: 'big' // Default size
          }

          // Check if cursor is inside or next to an image gallery
          const { selection } = editor.value.state
          const gallery = editor.value.state.doc.nodeAt(selection.from)?.type.name === 'imageGallery'

          if (gallery) {
            // Add to existing gallery
            editor.value.chain()
              .focus()
              .addImageToGallery(imageAttrs)
              .run()
          } else {
            // Create new gallery with image
            editor.value.chain()
              .focus()
              .insertContent({
                type: 'imageGallery',
                content: [{
                  type: 'image',
                  attrs: imageAttrs
                }]
              })
              .run()
          }
        }
      } else {
        // Otherwise, create file input to let user select a file
        const input = createFileInput()
        input.click()
        input.onchange = async (event) => {
          file = event.target.files[0]
          if (!file) return

          savedFile = await saveFile(file)

          if (editor.value) {
            const imageAttrs = {
              src: savedFile.url(),
              alt: sanitizeFileName(file.name),
              size: 'big' // Default size
            }

            // Check if cursor is inside or next to an image gallery
            const { selection } = editor.value.state
            const gallery = editor.value.state.doc.nodeAt(selection.from)?.type.name === 'imageGallery'

            if (gallery) {
              // Add to existing gallery
              editor.value.chain()
                .focus()
                .addImageToGallery(imageAttrs)
                .run()
            } else {
              // Create new gallery with image
              editor.value.chain()
                .focus()
                .insertContent({
                  type: 'imageGallery',
                  content: [{
                    type: 'image',
                    attrs: imageAttrs
                  }]
                })
                .run()
            }
          }
        }
      }
    } catch (error) {
      throw new Error(t('tiptap_editor.errors.upload_failed', { error: error.message }))
    }
  }

  const createFileInput = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = false
    return input
  }

  const sanitizeFileName = (name) => {
    // Remove any characters that could cause issues in HTML attributes
    return name.replace(/['"<>]/g, '').trim()
  }

  const handleDirectFileUpload = async (file, position) => {
    // Validate file
    if (!file) {
      throw new Error(t('tiptap_editor.errors.no_file'))
    }

    // Check file size (10MB limit)
    const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB in bytes
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(t('tiptap_editor.errors.too_large'))
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      throw new Error(t('tiptap_editor.errors.not_image'))
    }

    try {
      // Update status
      showAlert({
        type: 'info',
        message: t('alerts.editor.image_upload_progress'),
        permanent: true
      })

      // Save file to Parse
      console.log('[Tiptap] handleDirectFileUpload: ', file)
      const savedFile = await saveFile(file)

      // Success notification
      showAlert({
        type: 'success',
        message: t('alerts.image_upload.success'),
        duration: 3000
      })

      // Insert image into editor
      if (editor.value) {
        if (position !== undefined) {
          // Insert at specific position
          const imageNode = editor.value.schema.nodes.image.create({
            src: savedFile.url(),
            alt: sanitizeFileName(file.name)
          })
          const transaction = editor.value.state.tr.insert(position, imageNode)
          editor.value.view.dispatch(transaction)
        } else {
          // Insert at current cursor position
          editor.value.chain()
            .focus()
            .setImage({
              src: savedFile.url(),
              alt: file.name
            })
            .run()
        }
      }

      return savedFile

    } catch (error) {
      throw new Error(t('tiptap_editor.errors.upload_failed', { error: error.message }))
    }
  }

  const onTipTapDrop = async (event) => {
    try {
      const files = event.dataTransfer.files
      if (files.length === 0) return

      // Get drop position
      const dropPos = editor.value.view.posAtCoords({
        left: event.clientX,
        top: event.clientY
      })

      if (!dropPos) return

      // Prevent default to handle drop ourselves
      event.preventDefault()

      // Map position through any existing transforms
      const mappedPos = editor.value.state.tr.mapping.map(dropPos.pos)

      // Handle the first dropped file
      await handleDirectFileUpload(files[0], mappedPos)

    } catch (error) {
      showAlert({
        type: 'error',
        message: t('alerts.editor.image_upload_error', { error: error.message })
      })
      console.error('Error in onTipTapDrop:', error)
    }
  }

  const pasteHandler = async (e) => {
    try {
      console.log('[Tiptap] pasteHandler: ', e)
      if (!editor.value || !hasFocusTipTap.value) return
      // Handle file uploads
      const file = e.clipboardData?.files?.[0]
      if (file) {
        console.log('[Tiptap] imageFile: ', file)
        await addImage(file)
        return
      }

      // Handle URL paste
      if(showLinkDialog.value || editor.value?.state.selection.content().size) return
      const text = e.clipboardData.getData('text')

      // Fix for RangeError: Manually handle URL paste to ensure text exists before addPreviewNode tries to delete it
      if (store.validateUrl(text) && !newBookmark) {
        e.preventDefault()
        await addPreviewNode(text)
      }
      
    } catch (err) {
      console.log("Error pasting to Tiptap: ", err)
    }
  }

  async function addPreviewNode(text) {
    if (store.validateUrl(text) && !newBookmark) {

      console.log('[Tiptap] addPreviewNode: ', text)

      try {
        const preview = await store.fetchWebsitePreview(text)

        if (preview && editor.value?.commands) {
          editor.value.chain()
            .focus()
            .insertContent({
              type: 'bookmarkPreview',
              attrs: {
                url: text,
                preview: preview
              }
            })
            .run()
        }
      } catch (err) {
        console.error('Error fetching preview:', err)
        if (editor.value?.commands) {
            editor.value.chain()
              .focus()
              .insertContent(text)
              .setLink({ href: text })
              .run()
        }
      }
    }
  }

  const setLink = () => {
    const previousUrl = editor.value.getAttributes('link').href

    // If it's already a link, remove it
    if (previousUrl) {
      editor.value
        .chain()
        .focus()
        .extendMarkRange('link')
        .unsetLink()
        .run()
      return
    }

    // Otherwise show dialog for new URL
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
      // Auto-prepend https:// if missing
      linkUrl.value = 'https://' + url
      return
    }

    // Set the new link
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

  // Computed
  const showMenu = computed(() => {
    try {
      return typeOfNewBookmark.value === 'empty' || typeOfNewBookmark.value === 'textNote'
    } catch (error) {
      console.log("error in showMenu in tiptap ", error)
      return false
    }
  })

  /**
   * When the floating menus are allowed to appear.
   *
   * These used to be `v-if`s. Both menus move their own element out of where
   * Vue rendered it — Floating UI reparents them — so mounting and unmounting
   * one mid-update leaves Vue patching a subtree whose parent has gone
   * ("Cannot read properties of null (reading 'insertBefore')"). The
   * new-bookmark composer made that constant: it re-reads the kind of bookmark
   * you are writing on every keystroke, and `showFloatingMenu` follows it, so
   * typing a URL into a note tore the menu down in the middle of a patch.
   *
   * They stay mounted for the life of the editor now, and the conditions move
   * into the plugins' own `shouldShow`, which is where a menu is asked whether
   * it belongs on screen.
   */
  const shouldShowBubbleMenu = ({ editor: instance, view, state }) => {
    if (!showFloatingMenu || !instance.isEditable) return false
    // Clicking a control inside the menu takes focus off the editor; the menu
    // must not vanish out from under the pointer when it does.
    const focusIsInMenu = !!document.activeElement?.closest?.('.wb-bubble-menu')
    if (!view.hasFocus() && !focusIsInMenu) return false
    // A bubble menu acts on a selection. A bare caret has nothing to act on;
    // a selected image is not empty, so the image controls still come up.
    return !state.selection.empty
  }

  const shouldShowFloatingMenu = ({ view, state }) => {
    // The one thing it offers is pasting the clipboard in as a bookmark card,
    // so it has nothing to say unless the clipboard holds a link.
    if (!showFloatingMenu || !pasteBoard.value || !store.isUrl(pasteBoard.value)) return false
    if (!editor.value?.isEditable || !view.hasFocus()) return false
    const { $anchor, empty } = state.selection
    return empty && $anchor.depth === 1 && $anchor.parent.isTextblock && $anchor.parent.childCount === 0
  }

  const getSelectedImageSize = computed(() => {
    if (!selectedNode.value) return 'big'

    const { from } = editor.value.state.selection
    const node = editor.value.state.doc.nodeAt(from)

    if (node.type.name !== 'image') return

    let img = document.querySelector('.ProseMirror-selectednode')

    if (img.classList.contains('big')) return 'big'
    if (img.classList.contains('small')) return 'small'
  })

  ////////// Block handle

  /**
   * The "+" in the margin: opens an empty paragraph under the block the handle
   * is pointing at and types the "/" into it, so the palette is already up.
   * The same two steps the native apps take, for the same reason — the button
   * is there to start a block, not to leave a blank line.
   */
  function insertBlockBelow() {
    if (!editor.value || handlePos.value === null) return
    const node = editor.value.state.doc.nodeAt(handlePos.value)
    if (!node) return

    const end = handlePos.value + node.nodeSize
    editor.value
      .chain()
      .insertContentAt(end, { type: 'paragraph' })
      .focus(end + 1)
      .insertContent('/')
      .run()
  }

  function openBlockMenu(rect) {
    if (handlePos.value === null) return
    blockMenu.value = { open: true, rect, pos: handlePos.value }
  }

  /**
   * The handle itself: a "+" that starts a block and a grip that both drags the
   * block and opens its menu. Built by hand rather than as a Vue component
   * because TipTap's DragHandle wants a plain element back.
   */
  function renderDragHandle() {
    const element = document.createElement('div')
    element.classList.add('custom-drag-handle')

    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'custom-drag-handle__add'
    add.title = t('tiptap_editor.insert_block_below')
    add.setAttribute('aria-label', t('tiptap_editor.insert_block_below'))
    // Only the grip drags; the "+" would otherwise pick the block up.
    add.draggable = false
    add.addEventListener('mousedown', (event) => event.stopPropagation())
    add.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      insertBlockBelow()
    })

    const grip = document.createElement('button')
    grip.type = 'button'
    grip.className = 'custom-drag-handle__grip'
    grip.title = t('tiptap_editor.block_actions_hint')
    grip.setAttribute('aria-label', t('tiptap_editor.block_actions'))
    grip.addEventListener('click', (event) => {
      // A click that ended a drag has no detail; only a real one opens.
      if (event.detail === 0) return
      event.preventDefault()
      event.stopPropagation()
      openBlockMenu(grip.getBoundingClientRect())
    })

    element.append(add, grip)
    return element
  }

  // Lifecycle hooks
  onMounted(() => {
    try {
      document.addEventListener('paste', pasteHandler)

      window.addEventListener('keydown', (e) => {
        // Tab belongs to the slash palette while it is open, not to the lists.
        if (e.code === 'Tab' && !slashState.value.active) {
          e.preventDefault()
          
          // Handle task list indentation
          if (editor.value.isActive('taskList')) {
            if (!e.shiftKey) {
              // Indent task item
              editor.value.chain().focus().sinkListItem('taskItem').run()
            } else {
              // Outdent task item
              editor.value.chain().focus().liftListItem('taskItem').run()
            }
          }
          // Handle bullet list indentation
          else if (editor.value.isActive('bulletList')) {
            if (!e.shiftKey) {
              // Indent bullet list item
              editor.value.chain().focus().sinkListItem('listItem').run()
            } else {
              // Outdent bullet list item
              editor.value.chain().focus().liftListItem('listItem').run()
            }
          }
          // Create bullet list if not in any list
          else if (!e.shiftKey) {
            editor.value.chain().focus().toggleBulletList().run()
          }
        }
      })

      editor.value = new Editor({
        onSelectionUpdate: ({ editor }) => selectionUpdated(editor),
        onCreate: ({ editor }) => {
          // Add drag event listeners for smooth animations
          const prosemirror = editor.view.dom
          
          // Listen for drag start
          prosemirror.addEventListener('dragstart', (e) => {
            prosemirror.classList.add('ProseMirror-dragging')
            // Add animation class to all nodes
            const nodes = prosemirror.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, div, .bookmark-preview-node')
            nodes.forEach(node => {
              node.style.transition = 'transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), margin 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
            })
          })
          
          // Listen for drag end
          prosemirror.addEventListener('dragend', (e) => {
            prosemirror.classList.remove('ProseMirror-dragging')
            // Reset transitions
            setTimeout(() => {
              const nodes = prosemirror.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, div, .bookmark-preview-node')
              nodes.forEach(node => {
                node.style.transition = ''
              })
            }, 300)
          })
          
          // Listen for drag over to animate surrounding nodes
          prosemirror.addEventListener('dragover', (e) => {
            e.preventDefault()
            prosemirror.classList.add('node-repositioning')
          })
        },
        extensions: [
          // Configure StarterKit to exclude conflicting list extensions
          StarterKit.configure({
            paragraph: {
              HTMLAttributes: {
                class: 'editor-paragraph'
              }
            },
            // Exclude the default list items to avoid conflicts
            bulletList: false,
            orderedList: false,
            listItem: false,
            // Exclude Link since we're using a standalone Link extension
            link: false,
          }),
          Link,
          Highlight,
          
          ListItem,
          BulletList,
          OrderedList,
          TaskList.configure({
            itemTypeName: 'taskItem',  // This links TaskList to TaskItem
          }),
          TaskItem.configure({
            nested: true,  // Allow nested task items
          }),

          CustomImage.configure({
            HTMLAttributes: {
              class: 'tiptap-image'
            }
          }),
          ImageGallery,
          BookmarkNode.configure({
            HTMLAttributes: {
              class: 'bookmark-preview-node'
            }
          }),
          // The margin handle is for a document with blocks to rearrange. The
          // new-bookmark composer is one field holding one link or one note,
          // and tippy renders the handle into the body — so hiding it with CSS
          // from inside the popover was never going to reach it. It simply is
          // not installed there.
          ...(newBookmark ? [] : [
          NodeRange.configure({
            key: null,
          }),
          DragHandle.configure({
            render: renderDragHandle,
            tippyOptions: {
              placement: 'left',
              offset: [0, 0],
            },
            onNodeChange: ({ node, editor, pos }) => {
              // Remember which block the handle is on, so the "+" and the grip
              // menu act on it rather than on wherever the caret happens to be.
              handlePos.value = node ? pos : null
              if (!node) blockMenu.value = { open: false, rect: null, pos: null }

              // Add smooth transitions when nodes change position
              if (editor && editor.view && editor.view.dom) {
                const prosemirror = editor.view.dom
                prosemirror.classList.add('node-repositioning')
                
                // Remove class after animation completes
                setTimeout(() => {
                  prosemirror.classList.remove('node-repositioning')
                }, 300)
              }
            },
          }),
          ]),
          // The note's own prompt on the very first line, and Notion's hint on
          // every other empty one — the whole of the editor's chrome while you
          // are simply writing.
          Placeholder.configure({
            placeholder: ({ node, pos }) =>
              pos === 0 && node.type.name === 'paragraph'
                ? (placeholder || t('common.tiptap_placeholder'))
                : 'Type \u2018/\u2019 for commands',
            showOnlyWhenEditable: true,
            includeChildren: false,
          }),
          SlashCommand.configure({
            // Mirrors the native rule: a query with a space in it is someone
            // writing a sentence, unless it still names a block ("/heading 1").
            shouldStay: (query) => !query.includes(' ') || matchSlashCommands(query).length > 0,
            onStateChange: (state) => { slashState.value = state },
            onKeyDown: (event) => slashMenu.value?.handleKeyDown(event) === true,
          }),
        ],
        content: modelValue,
        onFocus: () => hasFocusTipTap.value = true,
        onBlur: () => hasFocusTipTap.value = false,
        onDestroy: () => hasFocusTipTap.value = false,
        onUpdate: ({ editor }) => {
          const html = editor.getHTML()
          emit('update:modelValue', html)
        },
      })
    } catch (err) {
      console.log("error in mounted in tiptap ", err)
    }
  })

  onBeforeUnmount(() => {
    try {
      editor.value.destroy()
    } catch (error) {
      console.log("error in beforeUnmount in tiptap ", error)
    }
  })

</script>

<style>
@reference "../assets/css/tailwind.css";
  /* Every empty block says what it is for — the note's own prompt on the first
     line, "Type / for commands" on the rest. The size is inherited, so the
     hint on an empty heading is heading-sized. */
  .tiptap .is-empty::before {
    @apply text-gray-400 dark:text-gray-600 font-light;
    content: attr(data-placeholder);
    float: left;
    height: 0;
    pointer-events: none;
  }

  /* The composer's field *is* the card, not a box dropped into one. The global
     `.ProseMirror` surface — white, rounded, its own shadowless panel — is what
     made it read as an input sitting inside the popover, so it is unset here;
     what is left is the equivalent of a Nuxt UI `variant="none"` input.

     The 3rem gutter every block carries is the drag handle's, and the composer
     does not install one (see the `newBookmark` branch of the extension list),
     so it is 3rem of nothing pushing the first line off to the right. */
  .new-bookmark-tiptap{
    @apply w-full relative;

    .tiptap{
      @apply pr-8 pl-0 max-h-[250px] bg-transparent dark:bg-transparent rounded-none;
    }

    .ProseMirror > * {
      margin-left: 0;
    }
  }


  .ProseMirror {
    > * {
      /* The margin is the handle's gutter: it has to hold a "+" and a grip. */
      margin-left: 3rem;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, div, .bookmark-preview-node {
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), 
                  margin 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                  padding 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                  top 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                  left 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                  opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      will-change: transform, margin, padding, top, left, opacity;
    }

    /* Enhanced transitions during drag state */
    &.ProseMirror-dragging {
      p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, div, .bookmark-preview-node {
        transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    top 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    left 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    opacity 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      }
    }

    /* Enhanced animations during node repositioning */
    &.node-repositioning {
      p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, div, .bookmark-preview-node {
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                    margin 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                    padding 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
    }

    /* Animate nodes being displaced during drag */
    .ProseMirror-drop-target {
      transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) !important;
    }

    /* Smooth animation for nodes moving out of the way */
    .ProseMirror-drag-placeholder {
      transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      opacity: 0.5;
    }
  }

  .ProseMirror-selectednode,
  .ProseMirror-selectednoderange {
    position: relative;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);

    &::before {
      position: absolute;
      pointer-events: none;
      z-index: -1;
      content: '';
      top: -0.25rem;
      left: -0.25rem;
      right: -0.25rem;
      bottom: -0.25rem;
      background-color: rgba(112, 207, 248, 0.31);
      border-radius: 0.2rem;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
  }

  /* Dragged node styling with smooth animation */
  .ProseMirror-dragging .ProseMirror-selectednode {
    transform: rotate(2deg);
    opacity: 0.8;
    transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                opacity 0.2s ease;
    z-index: 1000;
  }

  /* Drop zone indicator with smooth transitions */
  .ProseMirror .drop-cursor {
    border-left: 2px solid #3b82f6;
    transition: all 0.2s ease;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .new-bookmark-wrapper{
    .custom-drag-handle {
      display: none;
    }  
  }

  /* The margin handle: a "+" that starts a block and a grip that drags one or
     opens its menu. Both fade in with the handle itself, which TipTap only
     shows for the block under the pointer. */
  .custom-drag-handle {
    @apply flex items-center gap-px pr-2;

    button {
      @apply flex h-5 w-5 items-center justify-center rounded
             text-sm leading-none
             text-gray-400 dark:text-gray-500
             hover:bg-gray-100 hover:text-gray-700
             dark:hover:bg-gray-800 dark:hover:text-gray-200
             transition-colors;
    }
  }

  .custom-drag-handle__add::after {
    content: '+';
    font-weight: 500;
    font-size: 1rem;
  }

  .custom-drag-handle__grip {
    cursor: grab;

    &::after {
      content: '⠿';
      font-weight: 700;
    }

    &:active {
      cursor: grabbing;
    }
  }

  /* The bubble menu is the only formatting chrome left, so it reads as one
     floating control rather than a toolbar. */
  .wb-bubble-menu {
    @apply rounded-full px-1 shadow-xl shadow-black/10 dark:shadow-black/40;
  }

  .wb-floating-menu {
    @apply flex w-fit gap-1 rounded-full border border-gray-200 bg-white/95 p-1
           shadow-lg backdrop-blur
           dark:border-gray-700 dark:bg-gray-900/90;
  }

</style>
