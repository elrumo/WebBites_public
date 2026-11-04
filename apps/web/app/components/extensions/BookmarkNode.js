import { Node } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import PreviewBookmarkCard from '~/components/PreviewBookmarkCard.vue'

export const BookmarkNode = Node.create({
  name: 'bookmarkPreview',
  
  group: 'block',
  
  atom: true,

  addAttributes() {
    return {
      url: {
        default: null,
        parseHTML: element => element.getAttribute('data-url'),
        renderHTML: attributes => {
          if (!attributes.url) return {}
          return { 'data-url': attributes.url }
        }
      },
      preview: {
        default: null,
        parseHTML: element => {
          try {
            const previewData = element.getAttribute('data-preview')
            return previewData ? JSON.parse(previewData) : null
          } catch (e) {
            console.error('Error parsing preview data:', e)
            return null
          }
        },
        renderHTML: attributes => {
          if (!attributes.preview) return {}
          try {
            return { 'data-preview': JSON.stringify(attributes.preview) }
          } catch (e) {
            console.error('Error stringifying preview data:', e)
            return {}
          }
        }
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="bookmark-preview"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // Remove the content hole (0) since this is an atom node
    return ['div', { 'data-type': 'bookmark-preview', ...HTMLAttributes }]
  },

  addNodeView() {
    return VueNodeViewRenderer(PreviewBookmarkCard, {
      // Pass additional props to the component
      props: {
        editor: this.editor
      }
    })
  }
})