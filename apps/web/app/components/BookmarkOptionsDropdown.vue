<template>
    <UDropdownMenu :items="actionsItems">
        <UButton
            size="xs"
            variant="ghost"
            icon="i-tabler-dots"
            square
            class=""
        />
    </UDropdownMenu>
</template>

<script setup>
import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useStore } from '~/stores/myStore';
import { useI18n } from 'vue-i18n';
const { t } = useI18n();

const store = useStore();
const {
    showWebsiteModal,
    webToShow,
    activeBoard,
    boards,
} = storeToRefs(store);

const {
    showAlert,
    deleteItems,
    saveUpdatedSite
 } = store;

const { hideMenuItems } = useHideBookmarks();

 const props = defineProps({
    website: {
        type: Object,
        required: true
    }
})

const showAddToBoard = ref(false)

const removeFromBoardItem = () => ({
    label: t('bookmark_options.remove_from_board'),
    icon: 'i-tabler-layout-board-split',
    onSelect: async () => {
        try {
            const { removeBookmarkFromBoard } = useBoards()
            await removeBookmarkFromBoard(activeBoard.value.id, props.website.objectId)
            // Remove from local arrays
            store.activeBoardBookmarks = store.activeBoardBookmarks.filter(
                b => b.objectId !== props.website.objectId
            )
            store.filteredSites = store.activeBoardBookmarks
            store.activeBoardTotalBookmarks -= 1
            // Update board count in boards list
            const boardInList = boards.value.find(b => b.id === activeBoard.value.id)
            if (boardInList && boardInList.bookmarkCount > 0) boardInList.bookmarkCount -= 1
            showAlert({ message: t('bookmark_options.removed_from_board') })
        } catch (error) {
            showAlert({ message: t('bookmark_options.remove_error'), type: 'danger' })
        }
    }
})

const actionsItems = computed(() => {
    // Someone else's bookmark on a shared board: its row isn't ours to tag,
    // hide or delete, so the menu shrinks to what works on any page.
    if (store.isForeignBoardItem(props.website)) {
        const board = activeBoard.value
        return [[
            {
                label: t('common.view_more'),
                icon: 'i-tabler-external-link',
                onSelect: () => { if (/^https?:\/\//i.test(props.website.url || '')) window.open(props.website.url, '_blank', 'noopener') }
            },
            {
                label: t('bookmarks.copy_url'),
                icon: 'i-tabler-copy',
                onSelect: () => {
                    navigator.clipboard.writeText(props.website.url);
                    showAlert({ message: t('bookmarks.url_copied') });
                }
            },
            // Only the owner takes out what an editor added.
            ...(board?.role === 'owner' || !board?.role ? [removeFromBoardItem()] : [])
        ]]
    }

    const mainGroup = [
        {
            label: t('common.view_more'),
            icon: 'i-tabler-eye',
            onSelect: () => {
                showWebsiteModal.value = true;
                webToShow.value = props.website;
            }
        },
        {
            label: t('bookmarks.copy_url'),
            icon: 'i-tabler-copy',
            onSelect: () => {
                navigator.clipboard.writeText(props.website.url);
                showAlert({ message: t('bookmarks.url_copied') });
            }
        },
        {
            label: props.website.tags?.some(tag => tag.toLowerCase() === 'read-later')
                ? t('bookmark_options.remove_read_later')
                : t('bookmark_options.read_later'),
            icon: 'i-tabler-bookmark',
            onSelect: async () => {
                const tags = Array.isArray(props.website.tags) ? props.website.tags : []
                const isReadLater = tags.some(tag => tag.toLowerCase() === 'read-later')
                const updatedTags = isReadLater
                    ? tags.filter(tag => tag.toLowerCase() !== 'read-later')
                    : [...tags, 'read-later']
                props.website.tags = updatedTags
                await saveUpdatedSite(props.website.objectId, 'tags', updatedTags)
                showAlert({ message: isReadLater ? t('bookmark_options.removed_read_later') : t('bookmark_options.saved_read_later') })
            }
        }
    ]

    // Add board-related items
    if (boards.value.length > 0) {
        // Show board submenu items for quick add
        boards.value.filter(board => board.kind !== 'folder' && board.role !== 'viewer').forEach(board => {
            mainGroup.push({
                label: t('bookmark_options.add_to_board', { board: board.name }),
                icon: 'i-tabler-layout-board',
                onSelect: async () => {
                    try {
                        const { addBookmarksToBoard } = useBoards()
                        await addBookmarksToBoard(board.id, [props.website.objectId])
                        const boardInList = boards.value.find(b => b.id === board.id)
                        if (boardInList) boardInList.bookmarkCount += 1
                        showAlert({ message: t('bookmark_options.added_to_board', { board: board.name }) })
                    } catch (error) {
                        showAlert({ message: t('bookmark_options.add_error'), type: 'danger' })
                    }
                }
            })
        })
    }

    mainGroup.push(...hideMenuItems(props.website))

    const dangerGroup = []

    // "Remove from Board" when viewing a board; a viewer can't change one.
    if (activeBoard.value && activeBoard.value.role !== 'viewer') dangerGroup.push(removeFromBoardItem())

    dangerGroup.push({
        label: t('common.delete'),
        icon: 'i-tabler-trash',
        onSelect: () => deleteItems([props.website.objectId])
    })

    return [mainGroup, dangerGroup]
})
</script>
