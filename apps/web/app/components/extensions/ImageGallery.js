import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ImageGalleryComponent from '@/components/extensions/ImageGalleryComponent.vue'

export const ImageGallery = Node.create({
  name: 'imageGallery',
  
  group: 'block',
  
  content: 'image*',
  
  parseHTML() {
    return [
      {
        tag: 'div[data-type="image-gallery"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image-gallery' }), 0]
  },

  addNodeView() {
    return VueNodeViewRenderer(ImageGalleryComponent)
  },

  addCommands() {
    return {
      addImageToGallery: (attrs) => ({ chain, state }) => {
        // Find existing gallery or create new one
        const { selection } = state
        const gallery = state.doc.nodeAt(selection.from)?.type.name === 'imageGallery'
          ? selection.from
          : null

        if (gallery) {
          // Add to existing gallery
          return chain()
            .insertContentAt(gallery + 1, { type: 'image', attrs })
            .run()
        } else {
          // Create new gallery with image
          return chain()
            .insertContent({
              type: 'imageGallery',
              content: [{
                type: 'image',
                attrs
              }]
            })
            .run()
        }
      }
    }
  }
})
