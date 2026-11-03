import { useStore } from '~/stores/myStore'

/**
 * The "Hide" menu, in one place.
 *
 * Three surfaces offer it — the card dropdown, the bookmark modal's own menu,
 * and the multi-select bar — and they are three separate `items` arrays that
 * have already drifted once (the modal's menu is a hand-maintained copy of the
 * card's). A builder means the wording, the icons and the rules for which
 * entries apply live somewhere singular.
 */
export type HiddenFrom = '' | 'library' | 'everywhere'

export const useHideBookmarks = () => {
  const store = useStore()
  const { t } = useI18n()

  /** What every bookmark in the selection shares, or '' if they disagree. */
  const commonHiddenFrom = (websites: any[]): HiddenFrom => {
    const values = new Set(websites.map((site) => (site?.hiddenFrom || '') as HiddenFrom))
    return values.size === 1 ? [...values][0]! : ''
  }

  const hideMenuItems = (websites: any | any[]) => {
    const list = (Array.isArray(websites) ? websites : [websites]).filter(Boolean)
    if (list.length === 0) return []

    const current = commonHiddenFrom(list)
    const apply = async (value: HiddenFrom) => {
      const result = await store.setHiddenFrom(list, value)
      if (result !== 'done') return
      store.showAlert({
        message: value === ''
          ? t('bookmarks.hide.unhidden')
          : t(value === 'library' ? 'bookmarks.hide.hidden_from_library' : 'bookmarks.hide.hidden_everywhere')
      })
    }

    const children = []

    // A bookmark already hidden from the library can still be promoted to
    // hidden everywhere, and vice versa, so both entries stay available —
    // only the one that matches the current state drops out.
    if (current !== 'library') {
      children.push({
        label: t('bookmarks.hide.from_library'),
        // The distinction the two entries have to carry is boards, so say it.
        icon: 'i-tabler-eye-off',
        onSelect: () => apply('library')
      })
    }
    if (current !== 'everywhere') {
      children.push({
        label: t('bookmarks.hide.everywhere'),
        icon: 'i-tabler-lock',
        onSelect: () => apply('everywhere')
      })
    }
    if (current !== '') {
      children.push({
        label: t('bookmarks.hide.unhide'),
        icon: 'i-tabler-eye',
        onSelect: () => apply('')
      })
    }

    return [{
      label: current === '' ? t('bookmarks.hide.label') : t('bookmarks.hide.label_hidden'),
      icon: current === '' ? 'i-tabler-eye-off' : 'i-tabler-lock',
      children
    }]
  }

  return { hideMenuItems, commonHiddenFrom }
}
