import Parse from 'parse';
import pkg from 'file-saver';
import { nextTick } from 'vue';
const { log } = useDevLog()
const { saveAs } = pkg;

import { bookmarkUrlVariants } from '~/utils/bookmarkUrl'
import { vaporize } from '~/utils/vaporize'
import { expandImageMarkers } from '~/utils/imageMarkers'
import { applyMove } from '~/utils/boardTree'
import Fuse from 'fuse.js'

// Meilisearch needs the value quoted: a tag with a space broke `tags IN [x]`.
const tagFilter = (tag) => `tags = "${String(tag).replace(/["\\]/g, '\\$&')}"`
import { micromark } from 'micromark'
import {
  feedbackStatusOptions,
  feedbackTypeOptions,
  feedbackPlatformOptions,
  filterOptions,
  defaultUserOptions,
  readerOptions as readerOptionsDefault,
} from '~/composables/useStoreConstants'
import { toUploadableImages, unreadableImageMessage } from '~/composables/useImageUploads'
import { splitByKind, unsupportedFileMessage } from '~/composables/useFileKinds'
import { useFeedbackApi, mergeFeedbackPost } from '~/composables/useFeedbackApi'

/** `options` with each label translated from `<ns>.<value>` (hyphens become underscores). */
const localisedOptions = (options, ns) => options.map(option => ({
  ...option,
  label: useNuxtApp().$i18n.t(`${ns}.${option.value.replace(/-/g, '_')}`)
}))

// const toaster = createToaster({ /* options */ });
/**
 * The one shape the store works in: `{ search: { hits } }`.
 *
 * `/api/v1/search` normalises Algolia's and Meilisearch's answers into that,
 * but a caller that reaches the backend directly (server-side render) gets
 * Meilisearch's own `{ results }` back — so accept both rather than silently
 * treating a perfectly good response as "no data" and keeping stale bookmarks
 * on screen.
 */
const normalizeSearchResponse = (response) => {
  if (!response) return null;
  const hits = response.search?.hits
    || response.hits
    || response.results
    || response.search?.results;
  if (!Array.isArray(hits)) return null;
  const source = response.search || response;
  return {
    search: {
      hits,
      nbHits: source.nbHits ?? source.totalHits ?? hits.length,
      page: source.page ?? 0,
      hitsPerPage: source.hitsPerPage ?? hits.length,
    }
  };
};

const Websites = Parse.Object.extend('websites');

/**
 * The row a card's hover is warming, if any. One slot and not a cache: the only
 * hover worth keeping is the one the user is about to click, and a map of every
 * card the pointer crossed would pin whole bookmark rows in memory for a
 * session. Module-level so Pinia does not make a Parse object reactive.
 */
let prefetchedWebsite = null;
const UserOptions = Parse.Object.extend("userOptions");
const BookmarksToImport = Parse.Object.extend('bookmarksToImport');

// Alert messages are rendered as Markdown, and shared boards carry other people's names.
const mdEscape = (text) => String(text ?? '').replace(/[\\`*_{}[\]()<>#+!|~-]/g, '\\$&')

// Notification polling lives outside the state: a timer is not something to serialise.
let notificationsTimer = null
const onNotificationsVisible = () => {
  if (!document.hidden) useStore().fetchNotifications()
}

export const useStore = defineStore('websitesStore', {
  state: () => ({
    modalState: {
      activeTab: 'readerMode',
      showSideBarOptions: false,
      fullPageScreenshotSize: {
        width: 0,
        height: 0
      },
      isCommentBeingDragged: false,
      commentBeingDragged: '',
      audioLoading: false,
      audio: null
    },
    savedSites: [],
    filteredSites: [],
    trashedSites: [],
    trashLoading: false,
    showTrashModal: false,
    // The Private section. A scope like `activeBoard` and `rssScope` rather than
    // a modal like the trash: the grid, the sorting, the search box and the
    // bookmark modal all work inside it that way, for free.
    privateScope: false,
    // Per-tab and never persisted. Reloading the page asks for the password
    // again, which is the point of asking at all.
    privateUnlocked: false,
    showPrivateUnlockModal: false,
    showTagManagerModal: false,
    webToShow: {},
    hasFocusTipTap: false,
    isEditingDrawing: false,

    // Last known server version of the text note for three-way merge.
    // Set when a note is opened or when a non-conflicting LiveQuery update arrives.
    lastServerTextNote: null,
    widePage: false,
    sitesSelected: [],
    currentUser: null,
    isLoggedIn: false,
    searchValue: '',
    draggedWebsite: null,
    draggedBoardId: null,        // a sidebar row mid-drag; keeps the file-upload overlay away
    collapsedBranches: [],       // folders closed in the sidebar (per tab; not persisted)

    pageNotesFocused: false,

    importAccessData: {},

    startLoadingSettings: false,
    startLoadingTipTap: false,

    loadingSignInWithApple: false,

    /**
     * Plan state comes from `GET /v1/me/entitlements` and nowhere else.
     *
     * Reading it off the Parse user row is what these three used to do, and
     * `user.get('currentPlan')` on a query that did not include the pointer
     * returns an unfetched stub whose every `.get()` answers `undefined` — so
     * a free user's limits read as `undefined` and nothing ever blocked.
     */
    entitlements: null, // the whole `/v1/me/entitlements` response
    userPlan: {},   // entitlements.plan — display only, never gate on planId
    usage: null,    // entitlements.usage — counts *with* the limits attached
    features: {},   // entitlements.features — gate on these
    importing: false,
    importCancelled: false, // set by cancelImport so the user update isn't announced as a completed import
    importLimit: 100,
    length: [],
    totalImportedBookmarks: 0,
    bookmarksToImport: [],
    selectedBookmarksToImport: [],
    showImportBookmarksModal: false,
    bookmarksToImportSubscription: null,
    importSessionSubscription: null,

    // Centralized import status used by ImportStatusModal and other components
    importStatus: {
      status: 'inactive',
      isActive: false,
      session: null,
      remaining: 0,
      failures: [],
      history: []
    },

    globalAudioInstance: null,

    // Guard flag to prevent double initialization
    _isInitializing: false,
    _hasInitialized: false,
    _lastSearchKey: null,
    /** The search request identical callers join instead of re-issuing. */
    _inFlightSearch: null,
    _lastInitialFetchRunId: null,
    _lastInitialFetchStartedAt: null,
    allSitesLoaded: false,

    // Board state
    boards: [],
    automationToEdit: null,      // board id whose automation Settings → Automations should open
    typeIsActive: 'all',
    activeBoard: null,           // null = "All Bookmarks" view; object = board view
    activeBoardBookmarks: [],
    activeBoardTotalBookmarks: 0,
    activeBoardPage: 0,
    activeBoardAllLoaded: false,
    boardsLoaded: false,
    boardsLoading: false,
    showBoardModal: false,
    boardToEdit: null,           // null = create mode, object = edit mode
    newBoardParentId: null,      // folder a board made from its menu starts in
    showFolderModal: false,
    folderToEdit: null,          // null = create mode, object = rename
    folderParentId: null,        // folder a new folder starts in
    showShareBoardModal: false,
    boardToShare: null,

    // Notification history (board shared with you, items added, people joining…).
    // The bell only exists once there is something to show: `notificationsTotal`
    // counts every row, read or not, so reading them all does not hide it.
    notifications: [],
    notificationsUnread: 0,
    notificationsTotal: 0,

    // RSS reader state
    //
    // `rssScope` is the one switch: null means the bookmark grid is showing,
    // anything else means the feed reader has taken over the content area.
    // Feeds and bookmarks are separate reading surfaces, not two filters over
    // one list, so selecting either clears the other.
    rssSubscriptions: [],
    rssSubscriptionsLoaded: false,
    rssSubscriptionsLoading: false,
    rssTotalUnread: 0,
    rssScope: null,              // null | 'all' | 'unread' | subscription id
    rssItems: [],
    rssCursor: null,
    rssAllLoaded: false,
    rssLoading: false,
    rssLoadingMore: false,
    activeRssItem: null,         // the full detail object, not the list row
    activeRssItemLoading: false,
    rssItemDetails: {},          // detail payloads by item id, prefetched after each page
    rssUnreadOnly: false,
    rssFilterText: '',
    showAddFeedModal: false,
    showFeedSettingsModal: false,
    feedToEdit: null,

    userColumnsToExclude: [
      'usage',
      'importedBookmarksArr',
      'failedToImport',
      'loginSessions',
      'dateImportStarted',
      'websiteUrls',
      'savedSites',
      'emailVerified',
      'emailSubscriptions',
      'categories',
      'authData',
      'tokenUsage'
    ],
    websiteColumnsToExclude: [
      'categories',
      'containsAdultContent',
      'done',
      // A Quickdraw snapshot is the whole document — every stroke, every point. Cards
      // render the exported PNG in OGImage and never need it, so it stays out of list
      // queries and is pulled per-row by fetchSingleWebsite when a modal opens.
      'drawing',
      'fromCache',
      // Per-image metadata for a multi-image bookmark. Cards only ever need the
      // cover (OGImage always mirrors it) and the count, which rides in from
      // the search document as imageCount. fetchSingleWebsite pulls the array
      // when the modal opens.
      'images',
      // The timestamped segments of an audio bite's transcript. A card shows
      // an excerpt of `siteBody` and never the segments, and an hour-long
      // recording's are thousands of rows — so they are pulled per-row when
      // the modal opens, the same way the drawing document is.
      'audioTranscript',
      // An app page's listing: description, release notes and screenshot URLs.
      // Cards never need it; queryModalWebsite pulls it when the modal opens.
      'appListing',
      'savedFrom',
      'siteBodyFile',
      'siteHtmlFile',
      'tokenUsage',
      'updatedAt',
      'user'
    ],

    /**
     * What the in-app recorder knows about the take in `filesToUpload` and a
     * picked file does not: how long it is, the waveform it drew, and that it
     * was recorded rather than chosen. Cleared with the upload.
     */
    audioMeta: null,

    audioStatus: '',

    isOffline: false,

    parseConfig: {showMessageModal: false},

    readClipboardPermission: false,
    readGeoPermission: false,

    typeOfNewBookmark: 'empty',

    showSideBarOptions: false,
    activeTab: 'readerMode',
    showWebsiteModal: false,
    cardPosition: { x: null, y: null },

    totalAverageCost: 0,
    geoLocation: {
      latitude: null,
      longitude: null,
    },
    mousePosition: {
      x: null,
      y: null,
    },

    clipboardIsUrl: false,
    newUrlValue: '',

    userId: '',

    isAdmin: false,
    feedback: [],
    feedbackToDelete: [],
    feedbackToShow: {},
    

    showNewFeedbackModal: false,
    showFeedbackInfoModal: false,
    showFeedbackToDeleteModal: false,
    showUpgradeModal: false,
    // Whether this deployment bills at all (from the entitlements). Off by default, so pricing and
    // upgrade prompts never flash up on an install that has none.
    billingEnabled: false,
    showImportStatusModal: false,
    importingBookmarks: false,
    deleteModal: false,

    textNote: '',
    textNoteContent: '',

    showCommandBar: false,
    showWelcomeModal: false,
    showQuestionnaireModal: false,
    showAuthModal: false,
    shortcutsModal: false,
    dragImageModal: false,
    showSettingsModal: false,
    settingsLoader: false,
    isExportingBookmarksLoading: false,

    selectedTags: [],
    selectedColors: [],

    typesFilter: [],
    subTypesFilter: [],
    
    currentSearchType: null,

    recentSearches: [],
    pinnedSites: [],

    userApiKey: '',

    alert:{
      show: false,
      type: 'success',
      title: '',
      message: '',
      description: '',
      permanent: false,
      loader: false,
      position: 'top-right',
      onClickFunction: null,
      timeOnScreen: 3000,
      showCloseButton: true,
      confirm: null,
    },

    scrolled: false,
    scrolledToBottom: false,
    isMobile: false,
    
    showSideBar: false,

    displayMode: { id: 'grid', label: 'Grid', isMount: true },
    imageRatio: { id: 'original', label: 'Original', isMount: true },

    userOptions: { ...defaultUserOptions },

    isFirstTime: false,

    userInfo:{
      username: '',
      email: '',
    },

    useEmbeddings: false,
    isSearching: false,

    websiteCount: 0,

    activeElement: null,
    pasteBoard: null,

    isLoadingMore: false,

    loading: true,
    filesToUpload: [],
    imageTags: [],
    fileUrl: '',
    hitsPerPage: 40,

    currentPage: 0,

    readerOptions: { ...readerOptionsDefault },
    typeOptions: [
      { label: 'Website', value: 'website', icon: 'i-heroicons-link' },
      { label: 'Text Note', value: 'textNote', icon: 'i-heroicons-pencil' },
      { label: 'Drawing', value: 'drawing', icon: 'i-heroicons-paint-brush' },
      { label: 'Image', value: 'image', icon: 'i-heroicons-photo' },
      { label: 'PDF', value: 'pdf', icon: 'i-heroicons-document-text' },
      { label: 'Audio', value: 'audio', icon: 'i-heroicons-microphone' },
      { label: 'Movie', value: 'movie', icon: 'i-heroicons-film' },
      { label: 'Game', value: 'game', icon: 'i-tabler-device-gamepad' },
    ],
    bookmarkTypes: [
      { label: 'Website', value: 'website', icon: 'link', filterType: 'mainType' },
      { label: 'Article', value: 'article', icon: 'news', filterType: 'subType' },
      { label: 'Text Note', value: 'textNote', icon: 'pencil', filterType: 'mainType' },
      { label: 'Drawing', value: 'drawing', icon: 'brush', filterType: 'mainType' },
      { label: 'Image', value: 'image', icon: 'photo', filterType: 'mainType' },
      { label: 'PDF', value: 'pdf', icon: 'file-text', filterType: 'mainType' },
      { label: 'Audio', value: 'audio', icon: 'microphone', filterType: 'mainType' },
      { label: 'Music', value: 'music', icon: 'music', filterType: 'mainType' },
      { label: 'Movie', value: 'movie', icon: 'movie', filterType: 'mainType' },
      { label: 'Game', value: 'game', icon: 'games', filterType: 'mainType' },
    ],
    filterOptions: [...filterOptions],
    viewingOptions: [
      { id: 'Grid', label: 'Grid' },
      { id: 'List', label: 'List' },
      // { id: 'Compact', label: 'Compact' },
    ],
    imageRatioOptions: [
      { id: 'original', label: 'Original' },
      { id: '4-3', label: '4/3' },
      { id: '16-9', label: '16/9' },
    ],

    // The catalogue, from `GET /v1/plans` via `fetchPlans()`. One entry per
    // plan row (plus_monthly, plus_yearly, …), not per pricing card.
    plans: [],
    
    showLinkDialog: false,

    // Flag set by SSR when bookmarks were pre-fetched server-side
    _ssrHydrated: false,

  }),

  getters: {
    // Read, not stored: the labels are translated each time so they follow the
    // locale. The constants carry only the values and icons.
    feedbackStatusOptions: () => localisedOptions(feedbackStatusOptions, 'feedback.options.status'),
    feedbackTypeOptions: () => localisedOptions(feedbackTypeOptions, 'feedback.options.type'),
    feedbackPlatformOptions: () => localisedOptions(feedbackPlatformOptions, 'feedback.options.platform'),

    /** The boards bookmarks can be filed into: `boards` minus the folders that only hold them. */
    plainBoards() {
      return this.boards.filter(b => b.kind !== 'folder');
    },

    isListView() {
      return this.userOptions.displayMode === 'list';
    },

    // ── RSS reader getters ──────────────────────────────────────────

    /** True whenever the feed reader has taken over the content area. */
    isRssActive() {
      return this.rssScope !== null
    },

    /**
     * True when a sidebar scope (board / feed / type / private) owns the
     * content area. The unfiltered library search must not run underneath one
     * — it would replace the scoped rows with every bookmark.
     */
    scopeOwnsView() {
      return Boolean(
        this.rssScope !== null ||
        this.activeBoard ||
        this.privateScope ||
        this.typesFilter.length > 0 ||
        this.subTypesFilter.length > 0
      )
    },

    /**
     * The subscription id the current scope restricts to, or null for the
     * 'all' and 'unread' scopes which span every feed.
     */
    rssSubscriptionId() {
      if (!this.rssScope || this.rssScope === 'all' || this.rssScope === 'unread') return null
      return this.rssScope
    },

    rssActiveSubscription() {
      return this.rssSubscriptions.find(sub => sub.id === this.rssSubscriptionId) || null
    },

    /**
     * In-memory filtering of both lists. Never a request: typing should narrow
     * what is on screen instantly, and the backend has no article search in v1.
     */
    filteredRssSubscriptions() {
      const needle = (this.rssFilterText || '').trim().toLowerCase()
      if (!needle) return this.rssSubscriptions
      return this.rssSubscriptions.filter(sub => (sub.title || '').toLowerCase().includes(needle))
    },

    filteredRssItems() {
      const needle = (this.rssFilterText || '').trim().toLowerCase()
      if (!needle) return this.rssItems
      return this.rssItems.filter(item =>
        (item.title || '').toLowerCase().includes(needle) ||
        (item.feedTitle || '').toLowerCase().includes(needle) ||
        (item.excerpt || '').toLowerCase().includes(needle)
      )
    },

    rssScopeTitle() {
      if (this.rssScope === 'all') return 'All Articles'
      if (this.rssScope === 'unread') return 'Unread'
      return this.rssActiveSubscription?.title || 'Feed'
    },

    // ── End RSS reader getters ──────────────────────────────────────

    isDesktop() {
      if(!window) return true;
      return window.innerWidth > 720;
    },

    /**
     * What is left of each metered allowance.
     *
     * The endpoint has already done this subtraction against the right limit,
     * including the unlimited case — which the old `limit - used` arithmetic
     * turned into `NaN`. `Infinity` here keeps `> 0` checks reading true.
     */
    usageLeft() {
      const remaining = (quota) => {
        if (!quota) return 0;
        if (quota.unlimited) return Infinity;
        return quota.remaining ?? 0;
      };

      return {
        audio: remaining(this.usage?.audio),
        bookmarks: remaining(this.usage?.bookmarks),
      };
    },

    isDark() {
      if(process.client){
          return window.matchMedia("(prefers-color-scheme: dark)").matches;
      }
      return false;
    },

    isGridView() {
      return this.userOptions.displayMode === 'grid';
    },

    /**
     * Import access is bought separately from any subscription and survives a
     * downgrade, so it is reported in its own block rather than as a plan the
     * user once held — `userPlan.history` never existed on the plan row.
     */
    hasPreviouslyPayedToImport(){
      return Boolean(this.entitlements?.importAccess?.hasUsedAccess);
    }
  },

  actions: {
    clickId(id){
      document.getElementById(id).click();
    },

    /** The type option (label, icon) for a post's type key; unknown keys read as their own label. */
    feedbackType(key) {
      return this.feedbackTypeOptions.find(option => option.value === key)
        || { label: key || useNuxtApp().$i18n.t('feedback.options.type.other'), value: key || 'other', icon: 'octicon:megaphone-16' };
    },

    /** Put a post fresh from HelpBites into the list and the open detail modal. */
    applyFeedbackPost(post) {
      if (!post?.id) return;
      if (!Array.isArray(this.feedback)) this.feedback = [];
      const index = this.feedback.findIndex(f => f.id === post.id);
      if (index === -1) this.feedback.push(post);
      else this.feedback[index] = mergeFeedbackPost(this.feedback[index], post);
      if (this.feedbackToShow?.id === post.id) {
        this.feedbackToShow = mergeFeedbackPost(this.feedbackToShow, post);
      }
    },

    removeHtml(html) {
      try{
        if(typeof html !== 'string') return ''
        return html.replace(/<\/?[^>]+(>|$)/g, '')
      }catch(error){
        return html
      }
    },

    randomGradient(seed = '') {
      const gradientCount = 35

      if (!seed) {
        return '/gradients/gradient' + (Math.floor(Math.random() * gradientCount) + 1) + '.jpg'
      }

      const normalizedSeed = String(seed)
      let hash = 0

      for (let i = 0; i < normalizedSeed.length; i++) {
        hash = ((hash << 5) - hash) + normalizedSeed.charCodeAt(i)
        hash |= 0
      }

      const gradientIndex = Math.abs(hash) % gradientCount + 1
      return '/gradients/gradient' + gradientIndex + '.jpg'
    },

    getUrl(url) {
      try {
        return url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];
      } catch (e) {
        return url;
      }
    },

    createDebounce() {
      let timeout = null;
      return async function (fnc, delayMs) {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
          await fnc();
        }, delayMs || 50);
      };
    },

    setFilterType(type) {
      // only add if it does not already exist
      this.searchValue = this.searchValue.replace(':', '')
      this.typesFilter.push(type)
      this.searchSites(this.searchValue)
    },

    setSearchType(type, removeAllFilters = false) {
      // Type filters apply to the library, so picking one leaves the Private
      // section the same way it clears an active board.
      this.privateScope = false
      // Clear active board when using type filters — they apply globally
      if (this.activeBoard) {
        this.activeBoard = null
        this.activeBoardBookmarks = []
        this.activeBoardTotalBookmarks = 0
      }
      this.leaveReader()

      let filter = {
        label: type.label,
        value: type.value,
        icon: type.icon,
        filterType: type.filterType
      }

      log('type: ', type)

      if(removeAllFilters) {
        this.typesFilter = []
        this.subTypesFilter = []
        this.searchSites(this.searchValue)
        return
      }


      // Check if filter already exists in the appropriate array
      let existsInTypes = this.typesFilter.find((item) => {
        return item.value === type.value
      })
      let existsInSubTypes = this.subTypesFilter.find((item) => {
        return item.value === type.value
      })

      // If filter exists, remove it
      if (existsInTypes || existsInSubTypes) {
        this.removeFilter(filter)
        return
      }
      
      // Clear filters and add the new one to the appropriate array
      this.typesFilter = [];
      this.subTypesFilter = [];

      if(type.filterType == 'mainType') {
        this.typesFilter.push(filter)
      } else if(type.filterType == 'subType') {
        this.subTypesFilter.push(filter)
      }

      this.searchSites(this.searchValue)
    },

    getBadgeColor(status, type) {
      const baseClass = 'shadow-sm';
      status = status?.toLowerCase() || status
      const statusValue = (status.value || status).toLowerCase();

      if (statusValue.includes('done')) {
        if(type == 'text') return 'text-white'
        if(type == 'bg') return `bg-green-500 dark:bg-green-400 ${baseClass}`
        if(type == 'border') return 'border-green-500 dark:bg-green-400'
      }

      if(statusValue.includes('in-progress')) {
        if(type == 'text') return 'text-white'
        if(type == 'bg') return `bg-cyan-500 dark:bg-cyan-400 ${baseClass}`
        if(type == 'border') return 'border-cyan-500 dark:bg-cyan-400'
      }

      if(statusValue.includes('backlog')) {
        if(type == 'text') return 'text-white'
        if(type == 'bg') return `bg-yellow-500 dark:bg-yellow-400 ${baseClass}`
        if(type == 'border') return 'border-yellow-500 dark:bg-yellow-400'
      }

      if(statusValue.includes('pending')) {
        if(type == 'text') return 'text-neutral-700 dark:text-neutral-200'
        if(type == 'bg') return `bg-white dark:bg-neutral-900 ${baseClass}`
        if(type == 'border') return 'border-white dark:bg-neutral-400'
      }

      if(statusValue.includes('closed')) {
        if(type == 'text') return 'text-white'
        if(type == 'bg') return `bg-red-500 dark:bg-red-400 ${baseClass}`
        if(type == 'border') return 'border-red-500 dark:bg-red-400'
      }

      // Default case
      if(type == 'text') return 'text-white'
      if(type == 'bg') return `bg-gray-500 dark:bg-gray-400 ${baseClass}`
      if(type == 'border') return 'border-gray-500 dark:bg-gray-400'
    },

    async setPin(website, pinValue) {
      try {

        if (!website) return

        pinValue = pinValue !== undefined ? pinValue : !website.pinned;
        website.pinned = pinValue;

        const exists = this.pinnedSites.find((item) => item.objectId === website.objectId);

        if (website.pinned && !exists) {
          this.pinnedSites.push(website);
        } else if (!website.pinned) {
          this.pinnedSites = this.pinnedSites.filter((site) => site.objectId !== website.objectId);
        }

        this.pinnedSites.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        await this.saveUpdatedSite(website.objectId, 'pinned', website.pinned);
        return 'done';
      } catch (error) {
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.bookmark.pin_error'), type: 'danger'});
        log("error: ", error);
        return 'error';
      }
    },

    /**
     * Hide bookmarks, or unhide them.
     *
     * `'library'` takes them out of the grid, out of search and out of every
     * type/tag/colour filter, but leaves them in any board they're already in.
     * `'everywhere'` takes them out of the boards too. `''` puts them back.
     *
     * Goes through the backend rather than `saveUpdatedSite`, because a client
     * Parse write reaches the search index by way of the afterSave trigger and
     * a full re-index — seconds during which a bookmark the user just hid is
     * still turning up in search.
     */
    async setHiddenFrom(websites, hiddenFrom) {
      const list = (Array.isArray(websites) ? websites : [websites]).filter(Boolean);
      const ids = list.map((site) => site.objectId).filter(Boolean);
      if (ids.length === 0) return 'error';

      const previous = list.map((site) => site.hiddenFrom || '');
      const leavingView = this.privateScope ? hiddenFrom === '' : hiddenFrom !== '';

      // Snapshot before the arrays change, the way deleteItems does, so the
      // card animates out rather than blinking.
      if (process.client && leavingView) {
        vaporize(ids.flatMap((id) => [...document.querySelectorAll(`[id^="bookmarkCard-${id}"]`)]));
      }

      const filteredSitesCopy = this.filteredSites;
      const pinnedSitesCopy = this.pinnedSites;
      const savedSitesCopy = this.savedSites;

      list.forEach((site) => { site.hiddenFrom = hiddenFrom; });

      if (leavingView) {
        this.filteredSites = this.filteredSites.filter((site) => !ids.includes(site.objectId));
        this.savedSites = this.savedSites.filter((site) => !ids.includes(site.objectId));
        this.pinnedSites = this.pinnedSites.filter((site) => !ids.includes(site.objectId));
        this.cacheSitesLocally();
      }

      try {
        const { backendFetch } = useBackendFetch();
        const response = await backendFetch('bookmarks/visibility', {
          method: 'POST',
          body: { ids, hiddenFrom }
        });

        // The route reports whether the search index actually took the change.
        // Saying nothing here would leave the user believing a bookmark is out
        // of sight while search still returns it.
        if (response && response.indexed === false) {
          this.showAlert({
            message: useNuxtApp().$i18n.t('alerts.bookmark.hide_index_lag'),
            type: 'warning'
          });
        }
        return 'done';
      } catch (error) {
        list.forEach((site, index) => { site.hiddenFrom = previous[index]; });
        this.filteredSites = filteredSitesCopy;
        this.pinnedSites = pinnedSitesCopy;
        this.savedSites = savedSitesCopy;
        this.cacheSitesLocally();
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.bookmark.hide_error'), type: 'danger' });
        log('error setting bookmark visibility: ', error);
        return 'error';
      }
    },

    /** Show the Private section. The caller is responsible for the unlock. */
    async enterPrivateScope() {
      this.leaveReader();
      // Cleared directly rather than through clearActiveBoard, which fires a
      // library search of its own — the wrong one, and a wasted round trip.
      this.activeBoard = null;
      this.activeBoardBookmarks = [];
      this.activeBoardTotalBookmarks = 0;
      this.activeBoardPage = 0;
      this.activeBoardAllLoaded = false;
      this.typesFilter = [];
      this.subTypesFilter = [];
      this.privateScope = true;
      this.searchValue = '';
      this.currentPage = 0;
      this.allSitesLoaded = false;
      this.loading = true;
      // Whatever is on screen belongs to the library; drop it before the
      // private bookmarks arrive so the two never appear in one grid.
      this.filteredSites = [];
      this.savedSites = [];
      const results = await this.search({ searchTerm: '' });
      this.filteredSites = results?.search?.hits || [];
      this.savedSites = this.filteredSites;
      this.websiteCount = results?.search?.nbHits ?? this.filteredSites.length;
      this.loading = false;
    },

    /** Back to the library. */
    async exitPrivateScope() {
      if (!this.privateScope) return;
      this.privateScope = false;
      this.currentPage = 0;
      this.allSitesLoaded = false;
      this.loading = true;
      this.filteredSites = [];
      this.savedSites = [];
      const results = await this.search({ searchTerm: '' });
      this.filteredSites = results?.search?.hits || [];
      this.savedSites = this.filteredSites;
      this.websiteCount = results?.search?.nbHits ?? this.filteredSites.length;
      this.loading = false;
    },

    async loadMoreSites() {
      // Delegate to board-specific pagination when a board is active
      if (this.activeBoard) {
        return this.loadMoreBoardBookmarks()
      }

      this.isLoadingMore = true;

      // Build filters so pagination respects the active type/tag/color filters
      let meilisearchFilters = [];
      this.typesFilter.forEach(filter => {
        meilisearchFilters.push(`type = ${filter.value}`);
      });
      this.subTypesFilter.forEach(filter => {
        meilisearchFilters.push(`subType = ${filter.value}`);
      });
      this.selectedTags.forEach(tag => {
        meilisearchFilters.push(tagFilter(tag));
      });
      this.selectedColors.forEach(color => {
        meilisearchFilters.push(`colorDescription CONTAINS ${color.name}`);
      });
      const hasFilters = meilisearchFilters.length > 0;

      try {
        // Check if we already have all sites (only reliable when unfiltered and count is known).
        // `websiteCount` is the library total, so it says nothing about the
        // Private section — trusting it there stops paging after page one.
        if (!hasFilters && !this.privateScope && this.websiteCount > 0 && this.filteredSites.length >= this.websiteCount) {
          log('[MYSTORE] loadMoreSites: All sites loaded, skipping');
          this.allSitesLoaded = true;
          return 'all_loaded';
        }

        // Check if there are any sites to load more FROM
        if (this.filteredSites.length === 0) {
          log('[MYSTORE] loadMoreSites: No sites to load more from, skipping');
          return 'empty';
        }

        // Prevent race condition with initialFetch
        if (this._isInitializing) {
          log('[MYSTORE] loadMoreSites: Initializing, skipping');
          return 'initializing';
        }

        // Prevent concurrent calls
        if (this._isLoadingMore) {
          log('[MYSTORE] loadMoreSites: Already loading, skipping');
          return 'loading';
        }

        this._isLoadingMore = true;

        // Increment page BEFORE calling search
        this.currentPage += 1;
        log('[MYSTORE] loadMoreSites: Loading page', this.currentPage);

        let response = await this.search(
          hasFilters
            ? { filters: meilisearchFilters.join(' AND ') }
            : undefined
        )

        if (Array.isArray(response?.search?.hits)) {
          const newItems = response.search.hits;

          // If no new items returned, we've reached the end
          if (newItems.length === 0) {
            log('[MYSTORE] loadMoreSites: No more items available');
            this._isLoadingMore = false;
            this.allSitesLoaded = true;
            return 'no_more';
          }

          this.filteredSites.push(...newItems);
          log('[MYSTORE] loadMoreSites: Added', newItems.length, 'sites. Total:', this.filteredSites.length);
          this._isLoadingMore = false;
          return 'done';
        }

        throw new Error('No search results found');
      } catch (error) {
        console.error(error);
        this._isLoadingMore = false;
        throw error;
      } finally{
        this.isLoadingMore = false;
      }
    },

    // ── Board actions ─────────────────────────────────────────────────

    async fetchBoards() {
      if (this.boardsLoading) return
      this.boardsLoading = true
      try {
        const { fetchBoards: useFetchBoards } = useBoards()
        // console.log('[MYSTORE] fetchBoards: ', useFetchBoards)
        const response = await useFetchBoards()
        this.boards = response.boards || []
        this.boardsLoaded = true
        // A board someone shared with you can vanish between two fetches.
        if (this.activeBoard && !this.boards.some(b => b.id === this.activeBoard.id)) this.clearActiveBoard()
      } catch (error) {
        console.error('[MYSTORE] Error fetching boards:', error)
        return
      } finally {
        this.boardsLoading = false
      }
      // Boards loading is the first sign of a signed-in session.
      this.startNotificationsPolling()
      await this.acceptPendingInvite()
    },

    /**
     * Finish an invitation that was opened from an emailed link while signed
     * out. `/invite/<token>` only parks the token; the account it belongs to
     * is whoever signs in next, so the accepting happens here.
     */
    async acceptPendingInvite() {
      if (!import.meta.client) return
      let token = null
      try { token = localStorage.getItem('pendingInviteToken') } catch { /* storage blocked */ }
      if (!token || !Parse.User.current()) return
      // Cleared first: a second fetchBoards mid-request must not accept it twice.
      try { localStorage.removeItem('pendingInviteToken') } catch { /* storage blocked */ }
      try {
        const { acceptBoardInvite } = useBoards()
        const { board } = await acceptBoardInvite(token)
        if (board && !this.boards.some(b => b.id === board.id)) this.boards.push(board)
        this.showAlert({ message: board?.name ? useNuxtApp().$i18n.t('alerts.core_store.board_joined', { name: mdEscape(board.name) }) : useNuxtApp().$i18n.t('alerts.core_store.invite_accepted') })
        if (board) await this.selectBoard(board)
        this.fetchNotifications()
      } catch (error) {
        console.error('[MYSTORE] Error accepting board invite:', error)
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.invite_invalid'), type: 'danger' })
      }
    },

    async selectBoard(board) {
      if (!board?.id) return
      // Toggle off if clicking the same board
      if (this.activeBoard?.id === board?.id) {
        this.clearActiveBoard()
        return
      }

      this.activeBoard = board
      this.leaveReader()
      // A board and the Private section are two different places; picking one
      // leaves the other.
      this.privateScope = false
      this.activeBoardBookmarks = []
      this.activeBoardPage = 0
      this.activeBoardAllLoaded = false
      this.loading = true
      this.typesFilter = []
      this.subTypesFilter = []

      try {
        const { fetchBoard } = useBoards()
        const response = await fetchBoard(board.id, this.hitsPerPage, 0)

        this.activeBoardBookmarks = (response.items || [])
          .filter(item => item?.website?.id)
          .map(item => ({
            ...item.website,
            objectId: item.website.id,
            _boardMembership: {
              membershipId: item.membershipId,
              source: item.source,
              aiTopic: item.aiTopic,
              aiConfidence: item.aiConfidence,
              addedAt: item.addedAt,
              addedBy: item.addedBy
            }
          }))
        this.activeBoardTotalBookmarks = response.totalBookmarks || 0
        this.filteredSites = this.activeBoardBookmarks
        this.websiteCount = this.activeBoardTotalBookmarks
      } catch (error) {
        console.error('[MYSTORE] Error selecting board:', error)
      } finally {
        this.loading = false
      }
    },

    clearActiveBoard() {
      this.activeBoard = null
      this.activeBoardBookmarks = []
      this.activeBoardTotalBookmarks = 0
      this.activeBoardPage = 0
      this.activeBoardAllLoaded = false
      // Reload all bookmarks
      this.searchSites(this.searchValue)
    },

    async loadMoreBoardBookmarks() {
      if (this.activeBoardAllLoaded || this.isLoadingMore) return
      if (!this.activeBoard?.id) return
      this.isLoadingMore = true

      try {
        this.activeBoardPage += 1
        const { fetchBoard } = useBoards()
        const skip = this.activeBoardPage * this.hitsPerPage
        const response = await fetchBoard(this.activeBoard.id, this.hitsPerPage, skip)

        const newItems = (response.items || [])
          .filter(item => item?.website?.id)
          .map(item => ({
            ...item.website,
            objectId: item.website.id,
            _boardMembership: {
              membershipId: item.membershipId,
              source: item.source,
              aiTopic: item.aiTopic,
              aiConfidence: item.aiConfidence,
              addedAt: item.addedAt,
              addedBy: item.addedBy
            }
          }))

        if (newItems.length === 0) {
          this.activeBoardAllLoaded = true
          return
        }

        this.activeBoardBookmarks.push(...newItems)
        this.filteredSites = this.activeBoardBookmarks
      } catch (error) {
        console.error('[MYSTORE] Error loading more board bookmarks:', error)
      } finally {
        this.isLoadingMore = false
      }
    },

    // ── Board menu actions (sidebar context menu and the edit modal share these) ──

    openShareBoard(board) {
      this.boardToShare = board
      this.showShareBoardModal = true
    },

    /** Replace a board in the sidebar list (and the open view) with a fresher copy. */
    replaceBoard(board) {
      if (!board?.id) return
      const idx = this.boards.findIndex(b => b.id === board.id)
      if (idx !== -1) this.boards[idx] = { ...this.boards[idx], ...board }
      if (this.activeBoard?.id === board.id) this.activeBoard = { ...this.activeBoard, ...board }
    },

    /** Drop a board and everything under it from the sidebar, closing its view if open. */
    forgetBoard(boardId) {
      // Sub-collections go with the parent on the server, so they have to go
      // here too — otherwise the sidebar keeps drawing boards that no longer
      // exist until the next fetch.
      const gone = new Set([boardId])
      for (const board of this.boards) {
        if ((board.path ?? []).includes(boardId)) gone.add(board.id)
      }
      this.boards = this.boards.filter(b => !gone.has(b.id))
      if (gone.has(this.activeBoard?.id)) this.clearActiveBoard()
    },

    /**
     * Apply a drag: show it at once, then tell the server. The server is the
     * judge of a move (cycles, depth), so a refusal puts the sidebar back.
     */
    async reorderBoardsAction(parentId, orderedIds) {
      const before = this.boards
      this.boards = applyMove(before, parentId, orderedIds)
      try {
        const { reorderBoards } = useBoards()
        await reorderBoards(parentId, orderedIds)
        return true
      } catch (error) {
        console.error('Error moving board:', error)
        this.boards = before
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.board_move_failed'), type: 'danger' })
        return false
      }
    },

    toggleBranch(boardId) {
      this.collapsedBranches = this.collapsedBranches.includes(boardId)
        ? this.collapsedBranches.filter(id => id !== boardId)
        : [...this.collapsedBranches, boardId]
    },

    expandBranch(boardId) {
      if (boardId) this.collapsedBranches = this.collapsedBranches.filter(id => id !== boardId)
    },

    openFolderModal(folder = null, parentId = null) {
      this.folderToEdit = folder
      this.folderParentId = parentId
      this.showFolderModal = true
    },

    /** New board from a folder's menu: the board modal opens already inside it. */
    openNewBoardIn(parentId) {
      this.boardToEdit = null
      this.newBoardParentId = parentId
      this.showBoardModal = true
    },

    async duplicateBoardAction(board) {
      try {
        const { duplicateBoard } = useBoards()
        const response = await duplicateBoard(board.id)
        this.boards.push(response.board)
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.board_duplicated', { count: response.copiedBookmarks }, response.copiedBookmarks) })
        return true
      } catch (error) {
        console.error('Error duplicating board:', error)
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.board_duplicate_error'), type: 'danger' })
        return false
      }
    },

    async archiveBoardAction(board) {
      try {
        const { setBoardArchived } = useBoards()
        await setBoardArchived(board.id, true)
        // Archived boards leave the sidebar; they keep their contents and come
        // back with `includeArchived`.
        this.boards = this.boards.filter(b => b.id !== board.id)
        if (this.activeBoard?.id === board.id) this.clearActiveBoard()
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.board_archived') })
        return true
      } catch (error) {
        console.error('Error archiving board:', error)
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.board_archive_error'), type: 'danger' })
        return false
      }
    },

    async deleteBoardAction(board) {
      const folder = board.kind === 'folder'
      const t = useNuxtApp().$i18n.t
      const confirmed = await this.confirmAlert({
        message: t('alerts.core_store.board_delete_title', { name: mdEscape(board.name) }),
        description: folder
          ? t('alerts.core_store.folder_delete_description')
          : board.shared
            ? t('alerts.core_store.board_delete_shared_description')
            : t('alerts.core_store.board_delete_description'),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        type: 'danger'
      })
      if (!confirmed) return false
      try {
        const { deleteBoard } = useBoards()
        await deleteBoard(board.id)
        this.forgetBoard(board.id)
        this.showAlert({ message: folder ? useNuxtApp().$i18n.t('alerts.core_store.folder_deleted') : useNuxtApp().$i18n.t('alerts.core_store.board_deleted') })
        return true
      } catch (error) {
        console.error('Error deleting board:', error)
        this.showAlert({ message: folder ? useNuxtApp().$i18n.t('alerts.core_store.folder_delete_error') : useNuxtApp().$i18n.t('alerts.core_store.board_delete_error'), type: 'danger' })
        return false
      }
    },

    async leaveBoardAction(board) {
      const confirmed = await this.confirmAlert({
        message: useNuxtApp().$i18n.t('alerts.core_store.board_leave_title', { name: mdEscape(board.name) }),
        description: useNuxtApp().$i18n.t('alerts.core_store.board_leave_description'),
        confirmLabel: useNuxtApp().$i18n.t('alerts.core_store.board_leave_confirm'),
        cancelLabel: useNuxtApp().$i18n.t('common.cancel'),
        type: 'danger'
      })
      if (!confirmed) return false
      try {
        const { removeBoardMember } = useBoards()
        await removeBoardMember(board.id, 'me')
        this.forgetBoard(board.id)
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.board_left') })
        return true
      } catch (error) {
        console.error('Error leaving board:', error)
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.board_leave_error'), type: 'danger' })
        return false
      }
    },

    /** Whether a card on a shared board is someone else's bookmark (the owner's ACL keeps us out of its row). */
    isForeignBoardItem(website) {
      // Cards render on the server too, and there is no signed-in user there to compare with.
      if (!import.meta.client) return false
      const by = website?._boardMembership?.addedBy?.id
      return Boolean(by) && by !== Parse.User.current()?.id
    },

    // ── End board actions ───────────────────────────────────────────

    // ── Notification actions ────────────────────────────────────────

    async fetchNotifications() {
      try {
        const { fetchNotifications } = useNotifications()
        const topId = this.notifications[0]?.id
        const response = await fetchNotifications()
        this.notifications = response.notifications || []
        this.notificationsUnread = response.unreadCount ?? 0
        this.notificationsTotal = response.total ?? this.notifications.length

        // Access changes land in the sidebar without a reload: a board that was
        // just shared with you, or one you lost.
        const seenAt = this.notifications.findIndex(n => n.id === topId)
        const fresh = topId ? this.notifications.slice(0, seenAt === -1 ? undefined : seenAt) : []
        if (fresh.some(n => ['board_shared', 'role_changed', 'board_unshared'].includes(n.type))) await this.fetchBoards()
      } catch (error) {
        console.error('[MYSTORE] Error fetching notifications:', error)
      }
    },

    async markNotificationsRead(ids) {
      const unread = ids === 'all'
        ? this.notifications.filter(n => !n.readAt)
        : this.notifications.filter(n => ids.includes(n.id) && !n.readAt)
      if (!unread.length) return
      // Optimistic: the badge should not lag behind the click.
      const now = new Date().toISOString()
      unread.forEach(n => { n.readAt = now })
      this.notificationsUnread = Math.max(0, this.notificationsUnread - unread.length)
      try {
        const { markNotificationsRead } = useNotifications()
        const response = await markNotificationsRead(ids === 'all' ? { all: true } : { ids: unread.map(n => n.id) })
        this.notificationsUnread = response.unreadCount ?? this.notificationsUnread
      } catch (error) {
        console.error('[MYSTORE] Error marking notifications read:', error)
        this.fetchNotifications()
      }
    },

    /**
     * Poll for new notifications every 60 s while the tab is visible, and
     * straight away when it comes back. No push channel in v1.
     */
    startNotificationsPolling() {
      if (!import.meta.client || notificationsTimer) return
      this.fetchNotifications()
      notificationsTimer = setInterval(() => {
        if (!document.hidden) this.fetchNotifications()
      }, 60_000)
      document.addEventListener('visibilitychange', onNotificationsVisible)
    },

    stopNotificationsPolling() {
      clearInterval(notificationsTimer)
      notificationsTimer = null
      document.removeEventListener('visibilitychange', onNotificationsVisible)
      this.notifications = []
      this.notificationsUnread = 0
      this.notificationsTotal = 0
    },

    // ── End notification actions ────────────────────────────────────

    // ── RSS reader actions ──────────────────────────────────────────

    async fetchRssSubscriptions() {
      if (this.rssSubscriptionsLoading) return
      this.rssSubscriptionsLoading = true
      try {
        const { fetchSubscriptions } = useRssFeeds()
        const response = await fetchSubscriptions()
        this.rssSubscriptions = response.subscriptions || []
        this.rssTotalUnread = response.totalUnread ?? 0
        this.rssSubscriptionsLoaded = true
      } catch (error) {
        console.error('[MYSTORE] Error fetching RSS subscriptions:', error)
      } finally {
        this.rssSubscriptionsLoading = false
      }
    },

    /**
     * Switches the content area to a feed scope. Clicking the same scope again
     * toggles back to bookmarks, matching how selecting a board works.
     */
    async selectRssScope(scope) {
      if (this.rssScope === scope) {
        this.clearRss()
        return
      }

      // Bookmarks and feeds are different surfaces; leaving a board active
      // behind the reader would put the user somewhere unexpected on the way
      // back, and leaving type pills lit would light controls that do nothing.
      // Private is left the same way every other scope entry leaves it — a
      // stale `privateScope` would make the next library search ask for hidden
      // bookmarks as if the user were still inside the section.
      this.activeBoard = null
      this.typesFilter = []
      this.subTypesFilter = []
      this.privateScope = false

      this.rssScope = scope
      // The Unread scope *is* the unread filter — a stale per-feed toggle
      // would otherwise silently hide articles in the next feed opened.
      this.rssUnreadOnly = scope === 'unread'
      this.activeRssItem = null
      await this.loadRssItems()
    },

    async loadRssItems() {
      this.rssLoading = true
      // Drop the previous scope's rows at once so the list shows skeletons for the
      // new one instead of stale articles until the request returns.
      this.rssItems = []
      this.rssCursor = null
      this.rssAllLoaded = false
      try {
        const { fetchItems } = useRssFeeds()
        const response = await fetchItems({
          subscriptionId: this.rssSubscriptionId,
          unreadOnly: this.rssUnreadOnly || this.rssScope === 'unread'
        })
        this.rssItems = response.items || []
        this.rssCursor = response.nextCursor || null
        this.rssAllLoaded = !response.nextCursor
        this.rssItemDetails = {}
        this.prefetchRssItemDetails(this.rssItems)
      } catch (error) {
        console.error('[MYSTORE] Error loading RSS items:', error)
      } finally {
        this.rssLoading = false
      }
    },

    async loadMoreRssItems() {
      if (this.rssLoadingMore || this.rssAllLoaded || !this.rssCursor) return
      this.rssLoadingMore = true
      try {
        const { fetchItems } = useRssFeeds()
        const response = await fetchItems({
          subscriptionId: this.rssSubscriptionId,
          unreadOnly: this.rssUnreadOnly || this.rssScope === 'unread',
          cursor: this.rssCursor
        })
        // A page can come back empty while more remains — the server's cursor
        // counts rows scanned, not rows returned. Only a null cursor ends it.
        const known = new Set(this.rssItems.map(item => item.id))
        const fresh = (response.items || []).filter(item => !known.has(item.id))
        this.rssItems.push(...fresh)
        this.prefetchRssItemDetails(fresh)
        this.rssCursor = response.nextCursor || null
        this.rssAllLoaded = !response.nextCursor
      } catch (error) {
        console.error('[MYSTORE] Error loading more RSS items:', error)
      } finally {
        this.rssLoadingMore = false
      }
    },

    async setRssUnreadOnly(value) {
      if (this.rssUnreadOnly === value) return
      this.rssUnreadOnly = value
      await this.loadRssItems()
    },

    /**
     * Opens an article: fetches its full detail and marks it read.
     *
     * The row and the badge move before the request goes out and are put back
     * if it fails — the same optimistic contract bookmark edits use. An
     * already-read article is a no-op, so re-opening one cannot decrement the
     * counter twice.
     */
    async openRssItem(item) {
      if (!item?.id) return

      const cached = this.rssItemDetails[item.id]
      this.activeRssItem = cached || null
      this.activeRssItemLoading = !cached

      const wasUnread = !item.isRead
      const previousTotal = this.rssTotalUnread

      if (wasUnread) this.applyRssReadState(item.id, item.feedId, true)

      try {
        const { fetchItem, markItemRead } = useRssFeeds()
        if (!cached) {
          const response = await fetchItem(item.id)
          this.rssItemDetails[item.id] = response.item
          this.activeRssItem = response.item || null
        }

        if (wasUnread) {
          const readResponse = await markItemRead(item.id)
          // The server's counter is authoritative; the optimistic decrement
          // was only there to make the badge feel instant.
          if (readResponse?.subscription) this.applyRssSubscription(readResponse.subscription)
        }
      } catch (error) {
        console.error('[MYSTORE] Error opening RSS item:', error)
        if (wasUnread) {
          this.applyRssReadState(item.id, item.feedId, false)
          this.rssTotalUnread = previousTotal
        }
      } finally {
        this.activeRssItemLoading = false
      }
    },

    /** Flips one row's read flag without opening it; optimistic like the rest. */
    async setRssItemRead(itemId, isRead) {
      const item = this.rssItems.find(row => row.id === itemId)
      if (!item || item.isRead === isRead) return

      this.applyRssReadState(itemId, item.feedId, isRead)
      try {
        const { markItemRead, markItemUnread } = useRssFeeds()
        const response = await (isRead ? markItemRead : markItemUnread)(itemId)
        if (response?.subscription) this.applyRssSubscription(response.subscription)
      } catch (error) {
        console.error('[MYSTORE] Error setting RSS item read state:', error)
        this.applyRssReadState(itemId, item.feedId, !isRead)
      }
    },

    async markAllRssRead(subscriptionId = null) {
      const target = subscriptionId ?? this.rssSubscriptionId
      const targetFeedId = target
        ? this.rssSubscriptions.find(sub => sub.id === target)?.feed?.id
        : null

      const previousItems = this.rssItems.map(item => ({ ...item }))
      const previousSubscriptions = this.rssSubscriptions.map(sub => ({ ...sub }))

      this.rssItems.forEach(item => {
        if (!targetFeedId || item.feedId === targetFeedId) item.isRead = true
      })
      this.rssSubscriptions.forEach(sub => {
        if (!target || sub.id === target) sub.unreadCount = 0
      })
      this.recomputeRssTotalUnread()

      try {
        const { markAllRead } = useRssFeeds()
        const response = await markAllRead(target)
        ;(response.subscriptions || []).forEach(sub => this.applyRssSubscription(sub))
        // An unread-only list is empty by definition now.
        if (this.rssUnreadOnly || this.rssScope === 'unread') await this.loadRssItems()
      } catch (error) {
        console.error('[MYSTORE] Error marking all RSS read:', error)
        this.rssItems = previousItems
        this.rssSubscriptions = previousSubscriptions
        this.recomputeRssTotalUnread()
      }
    },

    async subscribeToRssFeed(url) {
      try {
        const { subscribeToFeed } = useRssFeeds()
        const response = await subscribeToFeed(url)
        if (response?.subscription) this.applyRssSubscription(response.subscription)
        // The first poll ran server-side, so there is already something to read.
        if (this.rssScope) await this.loadRssItems()
        return response.subscription
      } catch (error) {
        console.error('[MYSTORE] Error subscribing to feed:', error)
        throw error
      }
    },

    async updateRssSubscription(subscriptionId, updates) {
      const { updateSubscription } = useRssFeeds()
      const response = await updateSubscription(subscriptionId, updates)
      if (response?.subscription) this.applyRssSubscription(response.subscription)
      return response.subscription
    },

    async unsubscribeFromRssFeed(subscriptionId) {
      const previousSubscriptions = this.rssSubscriptions.map(sub => ({ ...sub }))
      const feedId = this.rssSubscriptions.find(sub => sub.id === subscriptionId)?.feed?.id

      this.rssSubscriptions = this.rssSubscriptions.filter(sub => sub.id !== subscriptionId)
      if (feedId) this.rssItems = this.rssItems.filter(item => item.feedId !== feedId)
      this.recomputeRssTotalUnread()
      if (this.rssScope === subscriptionId) this.rssScope = 'all'

      try {
        const { unsubscribeFromFeed } = useRssFeeds()
        await unsubscribeFromFeed(subscriptionId)
      } catch (error) {
        console.error('[MYSTORE] Error unsubscribing:', error)
        this.rssSubscriptions = previousSubscriptions
        this.recomputeRssTotalUnread()
      }
    },

    /**
     * Any bookmark-side action (board, type pill, tag, colour, search text, sort)
     * is a way back to the grid, which only mounts once rssScope is null. This
     * runs before the action's data lands, because the grid's unmount hook wipes
     * filteredSites — it has to be mounted first. Unlike clearRss() it does not
     * refetch: the caller is about to load its own results.
     */
    leaveReader() {
      if (this.rssScope === null) return
      this.rssScope = null
      this.activeRssItem = null
      this.rssItems = []
      this.rssCursor = null
    },

    /** Returns to the bookmark grid without touching the feed data. */
    clearRss() {
      this.rssScope = null
      this.activeRssItem = null
      this.rssItems = []
      this.rssCursor = null
      this.rssAllLoaded = false
      this.rssFilterText = ''
      this.searchSites(this.searchValue)
    },

    // Internal helpers — not called from components.

    /**
     * Warms the detail cache for a page of rows so a click paints instantly.
     * Three in flight at a time keeps it from starving the click's own request.
     * Stops when the list has been replaced under it (loadRssItems empties the
     * cache, and a row no longer present is not worth fetching).
     */
    async prefetchRssItemDetails(rows) {
      if (import.meta.server) return
      const { fetchItem } = useRssFeeds()
      const queue = rows.filter(row => row?.id && !this.rssItemDetails[row.id])
      const worker = async () => {
        while (queue.length) {
          const row = queue.shift()
          if (!this.rssItems.some(item => item.id === row.id)) return
          if (this.rssItemDetails[row.id]) continue
          try {
            const response = await fetchItem(row.id)
            if (response?.item) this.rssItemDetails[row.id] = response.item
          } catch (error) {
            // Prefetch is best effort; the click path fetches on its own.
          }
        }
      }
      await Promise.all(Array.from({ length: 3 }, worker))
    },

    /** Moves a row's read flag and the matching badges together. */
    applyRssReadState(itemId, feedId, isRead) {
      const item = this.rssItems.find(row => row.id === itemId)
      if (item) item.isRead = isRead

      const subscription = this.rssSubscriptions.find(sub => sub.feed?.id === feedId)
      if (subscription) {
        subscription.unreadCount = Math.max(0, (subscription.unreadCount || 0) + (isRead ? -1 : 1))
      }
      this.recomputeRssTotalUnread()
    },

    applyRssSubscription(subscription) {
      if (!subscription?.id) return
      const index = this.rssSubscriptions.findIndex(sub => sub.id === subscription.id)
      if (index >= 0) {
        this.rssSubscriptions[index] = subscription
      } else {
        this.rssSubscriptions.push(subscription)
        this.rssSubscriptions.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      }
      this.recomputeRssTotalUnread()
    },

    recomputeRssTotalUnread() {
      this.rssTotalUnread = this.rssSubscriptions.reduce(
        (total, sub) => total + Math.max(0, sub.unreadCount || 0),
        0
      )
    },

    // ── End RSS reader actions ──────────────────────────────────────

    /** The modal's row, straight from Parse. Shared by hover and open. */
    queryModalWebsite(id) {
      const query = new Parse.Query(Websites);
      query.equalTo('objectId', id);
      // The modal is the one place the heavy per-row columns are wanted, and
      // it has to ask for all of them. `drawing` was already spelled out here;
      // `images` was not, so the carousel of a multi-image bookmark only ever
      // had its cover to show — every other picture the user had just
      // uploaded was excluded on the way in and could not be seen at all.
      const modalOnlyColumns = ['drawing', 'images', 'audioTranscript', 'appListing'];
      query.exclude(this.websiteColumnsToExclude.filter((column) => !modalOnlyColumns.includes(column)));
      return query.first();
    },

    /**
     * Start the modal's fetch while the pointer is still on the card, so the
     * full row is usually already in hand by the time it opens and the reader
     * never has to sit on the search excerpt.
     */
    prefetchWebsite(id) {
      if (!id || prefetchedWebsite?.objectId === id) return;
      // Errors are swallowed here on purpose: a prefetch nobody asked for must
      // not surface, and `fetchSingleWebsite` re-queries when it gets null.
      prefetchedWebsite = { objectId: id, promise: this.queryModalWebsite(id).catch(() => null) };
    },

    async fetchSingleWebsite(id) {
      try {
        if (location.hostname.includes("localhost")) log(`fetchSingleWebsite started for id ${id}`);

        const warm = prefetchedWebsite?.objectId === id ? prefetchedWebsite.promise : null;
        prefetchedWebsite = null;
        const object = (warm && await warm) || await this.queryModalWebsite(id);

        // this.webToShow = {...object.attributes};
        if(object != undefined) {

          if (location.hostname.includes("localhost")) {
            log("object: ", object);
            log("this.webToShow: ", this.webToShow)
          };

          // `siteBody` has to come through. `webToShow` starts life as a search
          // hit, whose body is only an excerpt — dropping the column here left
          // the reader rendering that excerpt and cutting the article off
          // mid-sentence. The row is already on the wire (siteBody is not in
          // `websiteColumnsToExclude`), so keeping it costs nothing, and a row
          // without the column simply leaves whatever we already had.
          const { OGImage, ...attributes } = object.attributes;
          Object.assign(this.webToShow, attributes);
          this.webToShow.objectId = object.id;
        }
      } catch (error) {
        log("error: ", error)
      }
    },

    async exportBookmarks() {
      // Function to fetch websites for the current user
      this.isExportingBookmarksLoading = true;

      async function fetchWebsitesForCurrentUser() {
        const Websites = Parse.Object.extend("websites");
        const query = new Parse.Query(Websites);
        query.equalTo('user', Parse.User.current());
        query.notEqualTo('isDeleted', true);
        query.limit(99999);
        const websites = await query.find();
        return websites;
      }

      // Function to generate bookmarks HTML
      function generateBookmarksHtml(websites) {
        let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
                <!-- This is an automatically generated file.
                    It will be read and overwritten.
                    DO NOT EDIT! -->
                <META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
                <TITLE>Bookmarks</TITLE>
                <H1>Bookmarks</H1>
                <DL><p>
                `;

        websites.forEach((website) => {
          const title = website.get('siteTitle') || website.get('url');
          const url = website.get('url');

          if (website.get('type') === 'image' || !url) {
            return;
          }
          html += `<DT><A HREF="${url}" ADD_DATE="" LAST_MODIFIED="" ICON="">${title}</A>\n`;
        });

        html += `</DL><p>`;

        return html;
      }

      // Function to export websites as a bookmarking .html file
      async function exportWebsitesAsHtml() {
        const websites = await fetchWebsitesForCurrentUser();
        log("websites: ", websites.length);
        // return
        const bookmarksHtml = generateBookmarksHtml(websites);

        // Use FileSaver.js to save the bookmarks as a .html file
        const blob = new Blob([bookmarksHtml], { type: 'text/html;charset=utf-8' });
        const filename = 'bookmarks.html';
        saveAs(blob, filename);
      }

      try {
        await exportWebsitesAsHtml();
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.bookmark.export_success') });
      } catch (error) {
        this.showAlert({ message: error.message, type: 'danger' });
        this.alert.type = 'warning';
      }
      this.isExportingBookmarksLoading = false;
      this.alert.show = true;
    },

    async saveUserDetails(field) {
      let oldValue = this.userInfo[field];

      // Check if value has changed and if it's more than 3 characters
      if (this.userInfo[field].length < 3) {
        this.userInfo[field] = Parse.User.current().get(field)
        return;
      }

      try {
        const user = Parse.User.current();
        user.set(field, this.userInfo[field]);
        await user.save();
        field = field.charAt(0).toUpperCase() + field.slice(1);
        this.alert.message = field == 'username' ? 'name' : field + ' saved!';
        this.alert.show = true;
      } catch (error) {
        this.alert.type = 'warning';
        this.alert.message = error.message;
        this.alert.show = true;
        log(oldValue);
        log(error);
      }
    },

    /**
     * The offline copy of the grid.
     *
     * One place rather than four, because the copy has to move with the grid:
     * a delete that only dropped the bites from memory put them straight back
     * on the next load, which reads this cache before the search lands.
     *
     * Nothing is written while the Private section is open. The grid holds
     * hidden bookmarks then, and this cache is read on the next load before
     * anyone has been asked for a password — writing it would put the hidden
     * bookmarks on screen to whoever opens the browser next, and leave them
     * sitting in localStorage in the meantime. The guard is here rather than at
     * the callers because every one of them would need it.
     */
    cacheSitesLocally(sites = this.filteredSites) {
      if (this.privateScope) return;
      setTimeout(() => {
        try {
          localStorage.setItem('filteredSites', JSON.stringify(sites));
          localStorage.setItem('filteredSitesMeta', JSON.stringify({ updatedAt: Date.now() }));
        } catch {}
      }, 0);
    },

    async deleteItems(ids) {
      try {
        // Snapshot the cards before they leave the arrays and the grid reflows.
        if (process.client) vaporize(ids.flatMap(id => [...document.querySelectorAll(`[id^="bookmarkCard-${id}"]`)]))
        let filteredSitesCopy = this.filteredSites;
        let pinnedSitesCopy = this.pinnedSites;
        let savedSitesCopy = this.savedSites;

        this.filteredSites = this.filteredSites.filter((site) => !ids.includes(site.objectId));
        this.pinnedSites = this.pinnedSites.filter((site) => !ids.includes(site.objectId));
        this.savedSites = this.savedSites.filter((site) => !ids.includes(site.objectId));
        this.cacheSitesLocally();

        // TODO: call backend directly isntead of using qstash
        let deleteObjects = await $fetch('/api/qstash', {
          method: 'post',
          body: {
            data: ids,
            userId: Parse.User.current().id,
            topic: 'batch-delete'
          }
        })

        if(!deleteObjects.success){
          this.showAlert({ message: useNuxtApp().$i18n.t('alerts.import.error'), type: 'danger' });
          this.filteredSites = filteredSitesCopy;
          this.pinnedSites = pinnedSitesCopy;
          this.savedSites = savedSitesCopy;
          this.cacheSitesLocally();
          return
        }

      } catch (error) {
        log("error deleting 2: ", error);
      }
    },

    /**
     * Merge several image bookmarks into one multi-image bookmark.
     *
     * The first id given is the target and survives; the others are soft-deleted
     * to the 30-day trash, so a merge the user regrets is undone by restoring
     * them. Each image keeps the title, notes and tags of the bookmark it came
     * from — that is the per-image metadata the carousel shows.
     */
    async mergeImageBookmarks(ids) {
      if (!Array.isArray(ids) || ids.length < 2) return null;

      const filteredSitesCopy = this.filteredSites;
      const pinnedSitesCopy = this.pinnedSites;
      const savedSitesCopy = this.savedSites;

      // Everything but the target leaves the grid immediately.
      const absorbed = ids.slice(1);
      const drop = (list) => list.filter((site) => !absorbed.includes(site.objectId));
      this.filteredSites = drop(this.filteredSites);
      this.pinnedSites = drop(this.pinnedSites);
      this.savedSites = drop(this.savedSites);
      this.cacheSitesLocally();

      try {
        const { backendFetch } = useBackendFetch();
        const response = await backendFetch('bookmarks/merge', { method: 'POST', body: { ids } });

        // Refetch the target so its new images array and cover are in hand
        // without waiting on the search-index write.
        await this.fetchSingleWebsite(response.targetId);

        this.showAlert({
          message: useNuxtApp().$i18n.t('bookmarks.merged', { count: response.imageCount }),
          type: 'success'
        });
        return response;
      } catch (error) {
        console.error('error merging bookmarks: ', error);
        this.filteredSites = filteredSitesCopy;
        this.pinnedSites = pinnedSitesCopy;
        this.savedSites = savedSitesCopy;
        this.showAlert({ message: useNuxtApp().$i18n.t('bookmarks.merge_failed'), type: 'danger' });
        return null;
      }
    },

    /** Bookmarks the user deleted. The backend purges them 30 days after deletion. */
    async fetchTrash() {
      this.trashLoading = true;
      try {
        const { backendFetch } = useBackendFetch();
        const response = await backendFetch('bookmarks/trash');
        this.trashedSites = response?.bookmarks || [];
      } catch (error) {
        log('error fetching trash: ', error);
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.trash_load_failed'), type: 'danger' });
      } finally {
        this.trashLoading = false;
      }
    },

    async restoreItems(ids) {
      const restoring = this.trashedSites.filter((site) => ids.includes(site.objectId));
      this.trashedSites = this.trashedSites.filter((site) => !ids.includes(site.objectId));

      try {
        const { backendFetch } = useBackendFetch();
        await backendFetch('bookmarks/restore', { method: 'POST', body: { ids } });

        // Put them straight back in the grid instead of waiting for the search
        // index write to land on a refetch.
        this.filteredSites = [...restoring, ...this.filteredSites];
        this.savedSites = [...restoring, ...this.savedSites];
        this.cacheSitesLocally();
      } catch (error) {
        log('error restoring: ', error);
        this.trashedSites = [...restoring, ...this.trashedSites];
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.trash_restore_failed'), type: 'danger' });
      }
    },

    async getBase64(file) {
      return new Promise((resolve, reject) => {
        var reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
          resolve(reader.result);
        };
        reader.onerror = (error) => {
          log('Error: ', error);
          reject(error);
        };
      });
    },

    startAuthFlow(){
      this.showAuthModal = true;
    },

    /**
     * Upload whatever was picked, dropped or pasted.
     *
     * The two kinds go to different endpoints and produce different numbers of
     * bookmarks: every picture in one pick becomes a single multi-image
     * bookmark, while each PDF is a document in its own right and gets its own
     * row. So the list is split first and the halves are uploaded in parallel —
     * dropping a paper and three screenshots together gives four bookmarks,
     * which is what that gesture means.
     */
    async uploadFilesToParse() {
      const picked = Array.from(this.filesToUpload || []);
      if (picked.length === 0) return { error: true, message: 'No file selected' };

      const { images, pdfs, audios, other } = splitByKind(picked);

      if (images.length === 0 && pdfs.length === 0 && audios.length === 0) {
        const message = unsupportedFileMessage(other);
        this.showAlert({ message, type: 'error', timeOnScreen: 8000 });
        this.filesToUpload = [];
        this.imageTags = [];
        this.fileUrl = '';
        return { error: true, message };
      }

      if (other.length > 0) {
        // Some of them were fine. Say what was left out and upload the rest.
        this.showAlert({ message: unsupportedFileMessage(other), type: 'info', timeOnScreen: 8000 });
      }

      // Read the tags before either upload clears them.
      const tags = [...(this.imageTags || [])];

      const results = await Promise.all([
        images.length > 0 ? this.uploadImagesToParse(images, tags) : null,
        pdfs.length > 0 ? this.uploadPdfsToParse(pdfs, tags) : null,
        audios.length > 0 ? this.uploadAudioToParse(audios, tags, this.audioMeta || {}) : null
      ]);

      this.filesToUpload = [];
      this.imageTags = [];
      this.audioMeta = null;
      this.fileUrl = '';

      const failed = results.find(result => result && result.error);
      if (failed) return failed;

      // Which placeholders the uploads went up as, so the composer can find
      // the rows they become and file them into a board.
      const customIds = results.flatMap(result => result?.customIds || []);
      return { error: false, message: 'File uploaded successfully', customIds };
    },

    async uploadImagesToParse(picked, tags = []) {
      let customId = this.generateCustomId();

      try {
        // Every picture the user chose becomes ONE bookmark with an images
        // array, not one bookmark each. The backend caps the count and makes
        // the first the cover.

        // HEIC and TIFF pass the picker's `image/*` filter and then draw
        // nothing in the grid. Re-encode what this browser can decode and
        // refuse the rest here, before a placeholder is ever shown — the
        // server checks again for anything that reaches it.
        const { accepted: files, rejected } = await toUploadableImages(picked);

        if (files.length === 0) {
          const message = unreadableImageMessage(rejected);
          this.showAlert({ message, type: 'error', timeOnScreen: 8000 });
          return { error: true, message };
        }
        if (rejected.length > 0) {
          // Some of them were fine. Say what was left out and upload the rest.
          this.showAlert({ message: unreadableImageMessage(rejected), type: 'info', timeOnScreen: 8000 });
        }

        const formData = new FormData()
        formData.append('endpoint', 'saveUserImage')
        for (const file of files) {
          formData.append('file', file, file.name)
        }
        // Only meaningful for a single upload — with several files the backend
        // takes each name from its own part.
        if (files.length === 1) {
          formData.append('fileName', files[0].name)
          formData.append('fileFormat', files[0].name.split('.').pop())
        }
        formData.append('tags', JSON.stringify(tags))
        formData.append('customId', customId)
        formData.append('userId', Parse.User.current().id)
        formData.append('savedFrom', 'website')
        this.addToFilteredSites({ customId, isPlaceholder: true});

        let savedImage = await $fetch('/api/callBackend', { method: 'post', body: formData, headers: { 'x-parse-session-token': Parse.User.current()?.getSessionToken() || '' } });

        log("savedImage: ", savedImage);

        // Two different failures wear two different shapes here. `success` is
        // only the proxy's transport flag; /saveUserImage answers its own
        // failures — an unreadable format, a file that would not save, a user
        // it could not find — with HTTP 200 and an `error` in the body. Reading
        // just `success` meant those reported as saved: no alert, and the
        // optimistic placeholder left sitting in the grid as a blank card for
        // the rest of the session, because the LiveQuery row that would have
        // replaced it was never created.
        const failure = savedImage?.success
          ? savedImage?.data?.error
          : (savedImage?.error || useNuxtApp().$i18n.t('alerts.import.error'));

        if (failure) {
          console.error('error uploading image: ', failure);
          this.showAlert({
            message: typeof failure === 'string' ? failure : useNuxtApp().$i18n.t('alerts.import.error'),
            type: 'error',
            timeOnScreen: 8000
          });
          this.removePlaceholder(customId);
          return { error: true, message: typeof failure === 'string' ? failure : 'Upload failed' }
        }

        return {error: false, message: 'File uploaded successfully', customIds: [customId]}
      } catch (error) {
        console.error("error uploading image: ", error);
        // The network dropped mid-upload. Same rule as a refused save: the card
        // that was standing in for it goes away rather than staying blank.
        this.removePlaceholder(customId);
        this.showAlert({
          message: error?.message || useNuxtApp().$i18n.t('alerts.import.error'),
          type: 'error',
          timeOnScreen: 8000
        });
        return { error: true, message: error.message }
      }
    },

    /**
     * One bookmark per PDF.
     *
     * Unlike pictures, PDFs are not grouped: each one is a document with its
     * own title, page count and cover, and there is no sensible way to show two
     * of them on one card. They upload in parallel, each behind its own
     * placeholder, so a slow 40MB paper does not hold up the three-page memo
     * next to it — and one failure only takes down its own card.
     */
    async uploadPdfsToParse(files, tags = []) {
      const uploads = files.map(async (file) => {
        const customId = this.generateCustomId();

        try {
          const formData = new FormData();
          formData.append('endpoint', 'saveUserPdf');
          formData.append('file', file, file.name);
          formData.append('fileName', file.name);
          formData.append('tags', JSON.stringify(tags));
          formData.append('customId', customId);
          formData.append('userId', Parse.User.current().id);
          formData.append('savedFrom', 'website');

          this.addToFilteredSites({ customId, isPlaceholder: true });

          const saved = await $fetch('/api/callBackend', { method: 'post', body: formData, headers: { 'x-parse-session-token': Parse.User.current()?.getSessionToken() || '' } });

          // Same two failure shapes as the image upload: `success` is only the
          // proxy's transport flag, and /saveUserPdf answers its own refusals —
          // a file that is not really a PDF, one over the size cap, a quota
          // that is spent — with HTTP 200 and an `error` in the body.
          const failure = saved?.success
            ? saved?.data?.error
            : (saved?.error || useNuxtApp().$i18n.t('alerts.import.error'));

          if (failure) {
            console.error('error uploading pdf: ', failure);
            this.removePlaceholder(customId);
            return { error: true, message: typeof failure === 'string' ? failure : 'Upload failed' };
          }

          return { error: false, message: 'PDF uploaded successfully', customId };
        } catch (error) {
          console.error('error uploading pdf: ', error);
          this.removePlaceholder(customId);
          return { error: true, message: error?.message || 'Upload failed' };
        }
      });

      const results = await Promise.all(uploads);
      const failed = results.find(result => result.error);

      if (failed) {
        this.showAlert({
          message: failed.message || useNuxtApp().$i18n.t('alerts.import.error'),
          type: 'error',
          timeOnScreen: 8000
        });
        return failed;
      }

      return { error: false, message: 'PDF uploaded successfully', customIds: results.map(result => result.customId) };
    },

    /**
     * One bookmark per recording.
     *
     * Same shape as the PDF upload and for the same reason: a recording has its
     * own title, its own length and its own transcript, and no card shows two of
     * them. They upload in parallel behind their own placeholders.
     *
     * `extra` is what the recorder knows and a picked file does not — the length
     * it just measured, the waveform it drew, and that this was recorded rather
     * than chosen. The server re-reads all of it for an upload that arrives
     * without them, so nothing here is load-bearing; it just saves an ffprobe.
     */
    async uploadAudioToParse(files, tags = [], extra = {}) {
      const uploads = Array.from(files).map(async (file) => {
        const customId = this.generateCustomId();

        try {
          const formData = new FormData();
          formData.append('endpoint', 'saveUserAudio');
          formData.append('file', file, file.name);
          formData.append('fileName', file.name);
          formData.append('tags', JSON.stringify(tags));
          formData.append('customId', customId);
          formData.append('userId', Parse.User.current().id);
          formData.append('savedFrom', 'website');
          if (Number.isFinite(extra.duration)) formData.append('duration', String(extra.duration));
          if (Array.isArray(extra.peaks) && extra.peaks.length) {
            formData.append('peaks', JSON.stringify(extra.peaks));
          }
          if (extra.isVoiceNote) formData.append('isVoiceNote', 'true');
          if (extra.title) formData.append('pageTitle', extra.title);

          this.addToFilteredSites({ customId, isPlaceholder: true });

          const saved = await $fetch('/api/callBackend', { method: 'post', body: formData, headers: { 'x-parse-session-token': Parse.User.current()?.getSessionToken() || '' } });

          // Same two failure shapes as the image and PDF uploads: `success` is
          // only the proxy's transport flag, and /saveUserAudio answers its own
          // refusals — a file that is not really audio, one over the size cap,
          // a quota that is spent — with HTTP 200 and an `error` in the body.
          const failure = saved?.success
            ? saved?.data?.error
            : (saved?.error || useNuxtApp().$i18n.t('alerts.import.error'));

          if (failure) {
            console.error('error uploading audio: ', failure);
            this.removePlaceholder(customId);
            return { error: true, message: typeof failure === 'string' ? failure : 'Upload failed' };
          }

          return { error: false, message: 'Audio uploaded successfully', customId };
        } catch (error) {
          console.error('error uploading audio: ', error);
          this.removePlaceholder(customId);
          return { error: true, message: error?.message || 'Upload failed' };
        }
      });

      const results = await Promise.all(uploads);
      const failed = results.find(result => result.error);

      if (failed) {
        this.showAlert({
          message: failed.message || useNuxtApp().$i18n.t('alerts.import.error'),
          type: 'error',
          timeOnScreen: 8000
        });
        return failed;
      }

      return { error: false, message: 'Audio uploaded successfully', customIds: results.map(result => result.customId) };
    },

    /**
     * Ask the server for a transcript of an audio bite that has none.
     *
     * The row is flipped to `pending` here as well as on the server, so the
     * badge changes under the reader's finger rather than after a round trip.
     */
    async requestTranscript(websiteId) {
      if (!websiteId) return { error: true };
      try {
        // An empty object rather than no body: the /api/v1 proxy reads the
        // body on every non-GET before it forwards, and a POST with none at
        // all fails there rather than at the backend.
        await $fetch(`/api/v1/bookmarks/${websiteId}/transcribe`, { method: 'POST', body: {} });
        if (this.webToShow?.objectId === websiteId) this.webToShow.transcriptStatus = 'pending';
        const card = this.filteredSites.find(site => site?.objectId === websiteId);
        if (card) card.transcriptStatus = 'pending';
        return { error: false };
      } catch (error) {
        // The monthly audio allowance, shared with article narration. Comes
        // back as the same `{errorType: 'UsageError'}` body the narration
        // routes use, and the upgrade sheet is the answer, not an error toast.
        if (error?.data?.errorType === 'UsageError' || error?.response?.status === 403) {
          this.showUpgradeModal = true;
          return { error: true, quota: true };
        }
        const message = error?.data?.statusMessage || error?.message
          || useNuxtApp().$i18n.t('website_modal.audio.failed');
        this.showAlert({ message, type: 'error', timeOnScreen: 8000 });
        return { error: true };
      }
    },

    async logout() {
      try {
        const router = useRouter();
        log("logout");
        this._hasInitialized = false;
        
        // Use the new auth logout endpoint that clears both Parse and API key cookies
        await $fetch('/api/auth/logout', { method: 'POST' });
        
        // Also logout from Parse client-side
        await Parse.User.logOut();
        this.currentUser = null;
        this.userId = '';
        this.stopNotificationsPolling();

        localStorage.removeItem('filteredSites');
        localStorage.removeItem('filteredSitesMeta');
        localStorage.removeItem('pinnedSites');

        this.showAlert({ message: useNuxtApp().$i18n.t('navigation.logout_success') });

        // next tick function
        setTimeout(() => {
          router.replace({ path: '/'})
        }, 100)

        // location.reload();
        return
      } catch (error) {
        console.error('Logout error:', error);
        // Fallback: clear Parse session cookie manually (wb_api_key is httpOnly and cleared server-side)
        document.cookie = 'parse.session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        this.handleParseError(error, 'logout(), myStore.js');
      }
    },

    removeRecentSearch(search){
      this.recentSearches = this.recentSearches.filter(item => item !== search);
      this.saveUserOptions('removeRecentSearch');
    },

    async saveUpdatedSite(id, column, value) {
      try {
        const query = new Parse.Query(Websites);
        let site = await query.get(id);
        site.set(column, value);
        await site.save();
        // Keep the merge baseline in sync after a local save
        if (column === 'textNote') {
          this.lastServerTextNote = value;
        }
      } catch (error) {
        console.error("error updating site: ", error);
      }
      return 'done'
    },

    toast(toast) {
      useNuxtApp().$i18n.toaster.show(toast.message, toast.options);
    },

    async fetchPinnedSites() {
      try {

        // check if on local storage
        // let storedPinnedData = localStorage.getItem('pinnedSites');

        // if (storedPinnedData) {
        //   storedPinnedData = JSON.parse(storedPinnedData)
        //   storedPinnedData = storedPinnedData.sort((a, b) => {
        //     return new Date(b.createdAt) - new Date(a.createdAt);
        //   })
        //   this.pinnedSites = storedPinnedData;
        // }

        // const query = new Parse.Query(Websites);
        // query.equalTo('user', Parse.User.current());
        // query.exclude(this.websiteColumnsToExclude);
        // query.equalTo('pinned', true);
        // query.limit(99999);
        // let pinnedSites = await query.find();
        // log('pinnedSites 1: ', pinnedSites)
        // log('pinnedSites 2: ', this.structureParseData(pinnedSites))
        // pinnedSites = this.structureParseData(pinnedSites);

        if (!Parse.User.current().id) return;
        let pinnedSites = await $fetch('/api/getPinnedSites', { method: 'post', body: { userId: Parse.User.current().id } });
        // TODO: fix structureParseData
        pinnedSites = this.structureParseData(pinnedSites);
        if (location.hostname.includes("localhost")) log('pinnedSites: ', pinnedSites)

        // save to local storage
        localStorage.setItem('pinnedSites', JSON.stringify(pinnedSites));

        pinnedSites = pinnedSites.sort((a, b) => {
          return new Date(b.createdAt) - new Date(a.createdAt);
        })

        this.pinnedSites = pinnedSites;
      } catch (error) {
        console.error("error fetching pinned sites: ", error);
        this.handleParseError(error, 'fetchPinnedSites(), myStore.js');
      }
    },

    structureParseData(array) {
      // return an array of objects with the attributes we need
      let structuredData = [];
      array.forEach((item) => {
        // for each item, iterate through the keys and add them to a new object
        let newObj = {};
        for (let key in item.attributes) {          // if (key === 'createdAt' || key === 'updatedAt') {
            newObj[key] = item.attributes[key];
        }
        newObj.objectId = item.id;

        structuredData.push(newObj);
      })
      return structuredData;
    },

    setRecentSearch(searchItem) {
      if (searchItem.length < 2 || searchItem == ' ') {
        return
      }

      const searchItemLower = searchItem.toLowerCase();

      // Remove any existing instances of the search term (case insensitive)
      this.recentSearches = this.recentSearches.filter((item) => {
        return item.toLowerCase() !== searchItemLower
      })

      // Add the new search term at the beginning
      this.recentSearches.unshift(searchItem);
      this.recentSearches = this.recentSearches.slice(0, 30);

      this.saveUserOptions('setRecentSearch');
    },

    removeFilter(filter){
      // Remove from typesFilter
      this.typesFilter = this.typesFilter.filter((item) => {
        return item.label !== filter.label
      })
      
      // Remove from subTypesFilter
      this.subTypesFilter = this.subTypesFilter.filter((item) => {
        return item.label !== filter.label
      })

      this.searchSites(this.searchValue);
    },

    setSelectedTag(tag) {
      if (this.selectedTags.includes(tag.toLowerCase())) {
        // remove tag from selectedTags
        this.selectedTags = this.selectedTags.filter((selectedTag) => {
          return selectedTag.toLowerCase() !== tag.toLowerCase()
        })
        // set all selected tags to lower case
        this.selectedTags = this.selectedTags.map((selectedTag) => selectedTag.toLowerCase())
      } else {
        this.selectedTags.push(tag.toLowerCase())
      }

      this.searchSites(this.searchValue);
      // this.fetchFilteredSites()
    },

    removeSelectedFilter(filter) {
      if (this.selectedTags.includes(tag.toLowerCase())) {
        // remove tag from selectedTags
        this.selectedTags = this.selectedTags.filter((selectedTag) => {
          return selectedTag.toLowerCase() !== tag.toLowerCase()
        })
        // set all selected tags to lower case
        this.selectedTags = this.selectedTags.map((selectedTag) => selectedTag.toLowerCase())
      } else {
        this.selectedTags.push(tag.toLowerCase())
      }

      this.searchSites(this.searchValue);
      // this.fetchFilteredSites()
    },

    sortSites(order){
      if (order === 'newFirst') {
        log("new first");
        this.filteredSites = this.filteredSites.sort((a, b) => {
          return new Date(b.createdAt) - new Date(a.createdAt);
        })

      } else if (order === 'oldFirst') {
        this.filteredSites = this.filteredSites.sort((a, b) => {
          return new Date(a.createdAt) - new Date(b.createdAt);
        })
      }
    },

    async search({searchTerm = null, filters = null, userId} = {}) {
      if(searchTerm === null) searchTerm = this.searchValue;

      // Deduplication: an identical search already in flight is awaited, not
      // skipped. Returning nothing here is what left the grid on stale cached
      // data — initialFetch asked for the newest bookmarks while another
      // identical search was running, got `undefined` back, and kept whatever
      // localStorage had until the user reloaded the page.
      const currentSearchKey = JSON.stringify({ searchTerm, filters, userId, page: this.currentPage, orderBy: this.userOptions.orderBy, hiddenOnly: this.privateScope });
      if (this._inFlightSearch && this._lastSearchKey === currentSearchKey) {
        log('Joining in-flight search call');
        return this._inFlightSearch;
      }

      this.isSearching = true;
      this._lastSearchKey = currentSearchKey;

      const request = this._runSearch({ searchTerm, filters, userId });
      this._inFlightSearch = request;
      try {
        return await request;
      } finally {
        if (this._inFlightSearch === request) this._inFlightSearch = null;
      }
    },

    /** The search request itself. Always resolves to `{ search: { hits } }`. */
    async _runSearch({searchTerm, filters, userId}) {

      let currentUser = Parse.User.current().id
      userId = userId || currentUser;
      log('userId: ', userId)

      let performanceStartTime = performance.now()

      try{
        // Use the new backend fetch wrapper that automatically adds API key
        const { backendFetch } = useBackendFetch();
        let searchResults = await backendFetch('search', {
          method: 'post',
          body: {
            userId: userId,
            query: searchTerm,
            useEmbeddings: this.useEmbeddings,
            orderBy: this.userOptions.orderBy,
            page: this.currentPage,
            hitsPerPage: this.hitsPerPage,
            filters: filters,
            // The Private section, and nothing else, asks for hidden bookmarks.
            // Every other search leaves this off and the backend excludes them.
            hiddenOnly: this.privateScope
          }
        })

      // Log performance metrics
        const performanceEndTime = performance.now()
        log('Search Performance store:', {
          status: 'success',
          duration: performanceEndTime - performanceStartTime
        })

        log('searchResults 0: ', searchResults)
        return normalizeSearchResponse(searchResults);
      } catch (error) {
        console.error("error fetching search results: ", error);
        this.handleParseError(error, 'searchSites(), myStore.js');
      } finally {
        this.isSearching = false;
        setTimeout(() => {
          try {
            if(Boolean(searchTerm)) useTrackEvent('Search', { props: { userId, semanticSearch: this.useEmbeddings } });
          } catch (error) {
            console.error("error tracking search event: ", error);
          }
        }, 0);
      }
    },

    async searchSites(searchTerm) {
      try{
        this.leaveReader()
        // When a board is active, filter within board bookmarks client-side
        if (this.activeBoard) {
          if (searchTerm && searchTerm.trim() !== '') {
            const fuse = new Fuse(this.activeBoardBookmarks, {
              keys: ['siteTitle', 'siteDescription', 'url', 'tags'],
              threshold: 0.3
            })
            this.filteredSites = fuse.search(searchTerm).map(r => r.item)
          } else {
            this.filteredSites = this.activeBoardBookmarks
          }
          this.loading = false
          return
        }

        this.loading = true;
        this.currentPage = 0;
        this.allSitesLoaded = false;

        // log("searchTerm: ", searchTerm);

        const debouncedSetRecentSearch = this.createDebounce();
        // Recent searches are kept in localStorage and shown on the empty
        // search screen, so a term typed inside the Private section would put
        // what the user was looking for in front of the next person to open a
        // tab — the one thing the section exists to avoid.
        if (!this.privateScope && !searchTerm.startsWith('color:') && searchTerm.slice(6).length > 3) {
          debouncedSetRecentSearch(() => this.setRecentSearch(searchTerm), 700);
        }

        if (searchTerm == '' || searchTerm == ' ' && this.typesFilter.length == 0 && this.subTypesFilter.length == 0) {
          this.filteredSites = [];
        }

        // Build filters using only whitelisted fields (server adds user.objectId automatically)
        let filters = '';
        let filterParts = [];
        let meilisearchFilters = [];

        let selectedTags = this.selectedTags.map((tag) => {
          return tag.replace(/ /g, '_');
        })

        if (this.selectedTags.length > 0) {
          filterParts.push(`tags:${selectedTags.join(' AND tags:')}`);
          log('filterParts: ', filterParts)
          this.selectedTags.forEach((tag) => {
            meilisearchFilters.push(tagFilter(tag));
          })
        }

        if (this.selectedColors.length > 0) {
          this.selectedColors.forEach((color) => {
            filterParts.push(`siteColors.colorName: ${color.name}`);
            meilisearchFilters.push(`colorDescription CONTAINS ${color.name}`);
          })
          log('meilisearchFilters: ', meilisearchFilters)
        }

        // Handle main type filters (type is whitelisted)
        if (this.typesFilter.length > 0){
          this.typesFilter.forEach(filter =>{
            if (filter.value == 'default') {
              // Note: OR operators are blocked for security, so we need to handle this differently
              // The server will need to support multiple filter calls or we need to adjust this logic
              filterParts.push(`type:default`);
            } else {
              filterParts.push(`type:${filter.value}`);
              meilisearchFilters.push(`type = ${filter.value}`);
            }
          })
        }

        // Handle sub type filters
        if (this.subTypesFilter.length > 0){
          this.subTypesFilter.forEach(filter =>{
            filterParts.push(`subType:${filter.value}`);
            meilisearchFilters.push(`subType = ${filter.value}`);
          })
        }

        // Join all filter parts with AND
        filters = filterParts.join(' AND ');

        let searchResults;

        if(searchTerm.trim().length == 0 && filters.length == 0 && this.savedSites.length > 0){
          // await nextTick so the DynamicScroller has time to mount
          // before receiving items (prevents cards stacking on top of each other)
          await nextTick();
          searchResults = this.savedSites;
        } else{
          const response = await this.search({searchTerm, filters: meilisearchFilters.join(' AND ')})
          const hits = response?.search?.hits
          if (!Array.isArray(hits)) throw new Error('search returned no hits')
          searchResults = hits
        }

        log('searchSites filters: ', filters)
        log('searchSites meilisearchFilters: ', meilisearchFilters)
        log('searchResults 1: ', searchResults)

        this.filteredSites = searchResults;
        // log("searchResults: ", searchResults);
      } catch (error) {
        console.error("error fetching search results: ", error);
        this.handleParseError(error, 'searchSites(), myStore.js');
      } finally {
        this.isSearching = false;
        // The grid only drops its skeleton when hits arrive, so an empty
        // result (a type with no bookmarks, a failed search) must end it here.
        this.loading = false;
      }
    },

    setDone(website){
      website.done = !website.done;
      this.saveUpdatedSite(website.objectId, 'done', website.done);
    },

    generateCustomId(){
      let customId = '';
      let possibleCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

      for (let i = 0; i < 8; i++) {
        customId += possibleCharacters.charAt(Math.floor(Math.random() * possibleCharacters.length));
      }

      return customId;
    },

    showAlert(message = {}) {
      const defaults = {
        message: '',
        show: true,
        permanent: false,
        type: 'info',
        description: '',
        title: '',
        loader: false,
        timeOnScreen: 5000,
        onClickFunction: null,
        position: 'top-center',
        showCloseButton: true,
        confirm: null
      };

      const alertConfig = { ...defaults, ...message };
      Object.assign(this.alert, alertConfig);
    },

    /**
     * An alert with a confirm/cancel pair, resolving to the user's answer.
     * Dismissing it (close button, Escape) resolves false, so an awaiting
     * caller can never be left hanging.
     */
    confirmAlert({ confirmLabel, cancelLabel, ...message } = {}) {
      return new Promise(resolve => {
        this.showAlert({
          ...message,
          permanent: true,
          showCloseButton: false,
          confirm: { confirmLabel, cancelLabel, resolve }
        });
      });
    },

    /**
     * Take one optimistic placeholder back out after its save failed.
     *
     * Only this save's: an earlier version also required `site.url != undefined`,
     * which matched every other in-flight placeholder — they all have no url —
     * and wiped them out of the grid along with it.
     */
    removePlaceholder(customId){
      if (!customId) return;
      this.filteredSites = this.filteredSites.filter(
        (site) => !(site.isPlaceholder && site.customId == customId)
      );
      this.savedSites = this.filteredSites;
    },

    addToFilteredSites(website){
      // A bookmark saved while the Private section is open is an ordinary
      // library bookmark — it belongs to the grid the user will come back to,
      // not to the one they're looking at.
      if (this.privateScope) return;

      let clonedSites = [...this.filteredSites]

      // When the real bookmark arrives (via LiveQuery), replace the optimistic
      // placeholder that shares its customId instead of stacking a duplicate.
      if (!website.isPlaceholder && website.customId) {
        clonedSites = clonedSites.filter(
          (site) => !(site.isPlaceholder && site.customId == website.customId)
        );
      }

      // Never add the same bookmark twice (e.g. LiveQuery 'create' firing after
      // a refetch already included the new object).
      if (website.objectId && clonedSites.some((site) => site.objectId == website.objectId)) {
        this.filteredSites = clonedSites;
        this.savedSites = this.filteredSites;
        return;
      }

      // The grid is newest-first unless the user chose otherwise, so a new
      // card (placeholder or the real row replacing it) belongs at the top.
      if (this.userOptions?.orderBy === 'oldFirst') clonedSites.push(website);
      else clonedSites.unshift(website);

      this.filteredSites = clonedSites;
      this.savedSites = this.filteredSites;
    },

    isUrl(url){
      let urlRegex = new RegExp(
        "^(https?:\\/\\/)?" + // protocol
        "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // domain name
        "((\\d{1,3}\\.){3}\\d{1,3}))" + // OR ip (v4) address
        "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // port and path
        "(\\?[;&a-z\\d%_.~+=-]*)?" + // query string
        "(\\#[-a-z\\d_]*)?$",
        "i"
      );

      return urlRegex.test(url) && url.length > 3;
    },

    async canSaveNewBookmark(showAlert = true){
      try {
        // One request for the live quota, resolved server-side against the
        // plan. This replaces fetching the user with `currentPlan` included and
        // subtracting a limit column from a usage column here.
        const entitlements = await this.fetchEntitlements();

        // Fail open when the reading is unavailable rather than blocking a save
        // on a network hiccup.
        if (!entitlements?.usage?.bookmarks) return true;

        if(entitlements.usage.bookmarks.exceeded){
          if(showAlert){
            // TODO: Translate alerts.limit_description.one and alerts.limit_description.two
            this.showAlert({
                message: `${useNuxtApp().$i18n.t('common.upgrade')} ${useNuxtApp().$i18n.t('alerts.bookmark.limit_description.other')}`,
                description: useNuxtApp().$i18n.t('alerts.bookmark.limit_reached'),
                onClickFunction: () => { this.showUpgradeModal = true;},
                permanent: true,
                // type: 'primary'
            });
            this.showPopoverMessage = true;
          }
          return false;
        } else {
          return true;
        }
      } catch (error) {
        console.error("Error checking bookmark limit:", error);
        // If there's an error, allow saving to prevent blocking the user
        return true;
      }
    },

    /**
     * The bookmark this user already has at `url`, or null.
     *
     * Runs before every save (see `saveBookmark`) so a duplicate can be
     * confirmed rather than silently created. A failed lookup returns null:
     * never block a save because the check itself broke.
     */
    /**
     * The id of a bookmark saved moments ago, from the customId its placeholder
     * went up with.
     *
     * A link is saved through a queue and a file through an upload that answers
     * before its row is final, so neither hands back an id to add to a board.
     * The card arriving over LiveQuery is the quick answer; asking Parse is the
     * slow one, on a widening schedule — the same one the native app uses.
     */
    async bookmarkIdForCustomId(customId) {
      if (!customId) return null;
      const delays = [0, 1000, 2000, 4000, 8000, 15000, 25000, 40000];
      for (const delay of delays) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));

        const card = this.filteredSites.find(site => site?.customId === customId && site?.objectId && !site?.isPlaceholder);
        if (card) return card.objectId;

        try {
          const currentUser = Parse.User.current();
          if (!currentUser) return null;
          const query = new Parse.Query(Websites);
          query.equalTo('user', currentUser);
          query.equalTo('customId', customId);
          query.select('customId');
          const row = await query.first();
          if (row) return row.id;
        } catch (error) {
          // The next poll is the retry.
        }
      }
      return null;
    },

    async findSavedBookmarkByUrl(url) {
      try {
        const currentUser = Parse.User.current();
        const variants = bookmarkUrlVariants(url);
        if (!currentUser || variants.length === 0) return null;

        const query = new Parse.Query(Websites);
        query.equalTo('user', currentUser);
        query.containedIn('url', variants);
        // A bookmark in the trash isn't "already saved".
        query.notEqualTo('isDeleted', true);
        query.select('url', 'siteTitle', 'type');
        return await query.first();
      } catch (error) {
        console.error('error checking for an existing bookmark: ', error);
        return null;
      }
    },

    async saveBookmark(toSave = { url: '', savedFrom: 'website', mediaBookmark: null, type: 'website' }){

      if (location.hostname.includes("localhost")) log("toSave: ", toSave);

      let savedFrom = toSave.savedFrom ? toSave.savedFrom : 'website';
      let type = toSave.type ? toSave.type : 'website';
      let mediaBookmark = toSave.mediaBookmark ? toSave.mediaBookmark : null;
      let url = toSave.url ? toSave.url : '';
      // Websites take their tags on the way in; the save route files them on
      // the row it writes. A movie or game's route does not, so the composer
      // sets those afterwards (see `bookmarkIdForCustomId`).
      let tags = Array.isArray(toSave.tags) ? toSave.tags : [];
      // A note written beside the link; the save route files it as `siteNotes`.
      const siteNotes = typeof toSave.siteNotes === 'string' ? toSave.siteNotes.trim() : '';

      switch (type) {
        case 'movie':
          url = 'https://www.themoviedb.org/movie/' + mediaBookmark.id;
          break;
        case 'game':
          url = 'https://www.igdb.com/games/' + mediaBookmark.slug;
          break;
        default:
          break;
      }

      // Placeholder goes in before any round trip so the card shows at once.
      const customId = this.generateCustomId();
      this.addToFilteredSites({ customId, isPlaceholder: true });

      // Ask before saving something the user already has. Done here rather than
      // in each caller (top bar paste, new-bookmark modal, media picker) so
      // every save surface goes through it.
      const existingBookmark = await this.findSavedBookmarkByUrl(url);
      if (existingBookmark) {
        const t = useNuxtApp().$i18n.t;
        // The alert renders `description` with v-html and this is a scraped
        // page title, so it gets escaped rather than trusted.
        const existingTitle = String(existingBookmark.get('siteTitle') || existingBookmark.get('url') || '');
        const saveAnyway = await this.confirmAlert({
          message: t('alerts.bookmark.duplicate'),
          description: existingTitle.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
          type: 'info',
          confirmLabel: t('alerts.bookmark.duplicate_confirm'),
          cancelLabel: t('alerts.bookmark.duplicate_cancel'),
        });
        if (!saveAnyway) {
          this.removePlaceholder(customId);
          return false;
        }
      }

      let canSave = await this.canSaveNewBookmark(true)
      log("canSave: ", canSave);

      if(!canSave) {
        this.removePlaceholder(customId);
        return false;
      }

      try {

        let objToSave = {
          url,
          type,
          customId,
          savedFrom,
          mediaBookmark,
          tags,
          ...(siteNotes ? { siteNotes } : {}),
          fromCache: false,
          // fromCache: true,
          userId: Parse.User.current().id,
          geoLocation: this.geoLocation,
        }

        let sendToQstash = await $fetch('/api/qstash', {
          method: 'post',
          body: {
            data: objToSave,
            userId: Parse.User.current().id,
            topic: 'website-save-requests',
            // queueName: 'saveBookmark'
          }
        })

        if (sendToQstash.success) {
          this.showAlert({ message: useNuxtApp().$i18n.t('alerts.bookmark.save_success') })
        }else{
          this.removePlaceholder(customId);
          console.error("error saving bookmark 1: ", objToSave);
          console.error("error saving bookmark 2: ", sendToQstash);
          this.alert.show = false;
        }

        // The row does not exist yet — the queue writes it — so the
        // placeholder's customId is the only handle the caller can have on it.
        return { ...sendToQstash, customId };
      } catch (error) {
        this.removePlaceholder(customId);
        console.error("error saving bookmark 2: ", error);
        this.showAlert({ message: error?.message || String(error), type: 'error', timeOnScreen: 10000 })
        return {success: false, error}
      }
    },

    async saveTextNote(toSave = { textNote: '', tags: [],  savedFrom: 'website' }){
      if (toSave.textNote == '') return

      let textNote = toSave.textNote ? toSave.textNote : this.textNoteContent;
      let savedFrom = toSave.savedFrom ? toSave.savedFrom : 'website';
      let tags = toSave.tags ? toSave.tags : [];

      let noteToSave = {
        textNote: textNote,
        tags: tags,
        savedFrom: savedFrom,
        userId: Parse.User.current().id,
      };

      try {
        let savedNote = await $fetch('/api/saveTextNote', { method: 'post', body: { noteToSave } })
        return savedNote;
      } catch (error) {
        console.error("error saving note: ", error);
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.bookmark.save_error_note'), type: 'danger' })
        return 'Error'
      }
    },

    /**
     * Create a drawing row. The counterpart of saveTextNote: a drawing is authored
     * in-app, so there is no URL to enrich and nothing to enqueue — the route writes
     * the row and the afterSave trigger handles indexing from there.
     *
     * `drawing` must already be dehydrated (image assets pointing at the bucket);
     * QuickDrawCanvas.commit() is what produces that form along with the thumbnail.
     */
    async saveDrawing(toSave = { drawing: null, siteTitle: '', tags: [], thumbnailUrl: null, savedFrom: 'website' }) {
      if (!toSave.drawing) return 'Error'

      let drawingToSave = {
        drawing: toSave.drawing,
        siteTitle: toSave.siteTitle || 'Drawing',
        tags: toSave.tags || [],
        thumbnailUrl: toSave.thumbnailUrl || null,
        customId: toSave.customId || this.generateCustomId(),
        savedFrom: toSave.savedFrom || 'website',
        userId: Parse.User.current().id,
      };

      try {
        return await $fetch('/api/saveDrawing', { method: 'post', body: { drawingToSave } })
      } catch (error) {
        console.error("error saving drawing: ", error);
        this.showAlert({ message: useNuxtApp().$i18n.t('alerts.core_store.drawing_save_error'), type: 'danger' })
        return 'Error'
      }
    },

    /** Autosave a snapshot onto an existing drawing row. */
    async updateDrawing(websiteId, drawing, thumbnailUrl) {
      if (!websiteId || !drawing) return 'Error'

      try {
        return await $fetch('/api/updateDrawing', {
          method: 'post',
          body: { websiteId, drawing, thumbnailUrl: thumbnailUrl || null },
        })
      } catch (error) {
        console.error("error updating drawing: ", error);
        return 'Error'
      }
    },

    getDate(date, options) {
      try {
        let showYear = options && options.showYear ? options.showYear : true;
        let isUnixTime = options && options.isUnixTime;

        let dateOptions = showYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' };

        if (isUnixTime) date = date * 1000;


        return new Date(date).toLocaleDateString(useNuxtApp().$i18n.locale.value, dateOptions);
      } catch (error) {
        log("error getting date: ", error);
        return 'Unknown'
      }
    },

    toLocaleDate(date, options) {
      let isUnixTime;
      if (options) {
        isUnixTime = options.isUnixTime ? options.isUnixTime : false;

        if (isUnixTime) date = date * 1000;
      }

      return new Date(date).toLocaleDateString();
    },

    validateUrl(url) {
      url = url.trim();

      try {
        url = new URL(url);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch (_) {
          return false;
      }
    },

    // validateUrl(url) {
    //   url = url.trim();

    //   const pattern = /^(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})$/gi;
    //   const regex = new RegExp(pattern);
    //   return regex.test(url);
    // },

    async checkStripeStatus(){
      const parseOperationsStart = performance.now()

      try {
        const response = await $fetch('/api/checkStripeStatus', {
          method: 'POST',
          body: {
            userId: Parse.User.current().id,
            email: Parse.User.current().get('email')
          }
        });

        // log('response: ', response)

        if (response.error) {
          console.error('Error checking Stripe status:', response.error);
          return false;
        }

        return response;
      } catch (error) {
        console.error('Error checking Stripe status:', error);
        return false;
      } finally {
        log('[MYSTORE] checkStripeStatus: ', performance.now() - parseOperationsStart, 'ms')
      }
    },

    async ensureUsage (user){
      const DEFAULT_USAGE = {
        currentMonth: {
          month: null,
          bookmarksTotal: 0,
          bookmarksThisMonth: 0,
          filesUploaded: 0,
          audiosGenerated: 0
        },
        pastMonths: []
      };

      let userUsage = user.get('usage');
      log('userUsage: ', userUsage);

      if (!userUsage) {
        try {
          await user.fetch(); // only when missing
          // Read-only on purpose. This used to write `usage` back with the
          // user's own session, which is why `usage` had to stay off the
          // server-only field list in the Parse `_User` beforeSave — and a
          // client that can write `usage` can reset the counters every quota
          // check reads. The server initialises the column itself (the backend's
          // `flushUserUpdate` / `updateUsage`), and a missing `usage` already
          // counts as zeros there, so nothing needs writing from the browser.
          userUsage = user.get('usage') || DEFAULT_USAGE;
        } catch (e) {
          console.warn('user fetch failed', e);
          userUsage = DEFAULT_USAGE;
        }
      }
      // Only the bookmark count is taken from the column, for display. Quotas
      // come from `fetchEntitlements`, which measures the same count against
      // the plan server-side.
      this.websiteCount = userUsage?.currentMonth?.bookmarksTotal ?? 0;
    },

    resetInitialization() {
      log('[MYSTORE] Resetting initialization flags for fresh fetch on next mount');
      this._hasInitialized = false;
      this._isInitializing = false;
      this._isLoadingMore = false;
      this._ssrHydrated = false;
      this.currentPage = 0;
      this.scrolledToBottom = false;
    },

    async initialFetch(fromLocal = false) {
      const start = performance.now();
      try {
        // Prevent double initialization ONLY during the same page load
        // Allow re-fetching when navigating back to /app

        if (this._isInitializing) {
          log('[MYSTORE] initialFetch: Already in progress, skipping');
          return;
        }

        this._isInitializing = true;
        const runId = (() => {
          try {
            return crypto.randomUUID();
          } catch {
            return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
          }
        })();
        this._lastInitialFetchRunId = runId;
        this._lastInitialFetchStartedAt = Date.now();
        log('[MYSTORE] initialFetch start:', {
          runId,
          hasRecentData: this.filteredSites.length > 0 && this._hasInitialized,
          existingLength: this.filteredSites.length,
          existingFirstId: this.filteredSites[0]?.objectId || this.filteredSites[0]?.customId,
          ssrHydrated: this._ssrHydrated,
          online: navigator.onLine
        });

        const user = Parse.User.current();
        if (!user) {
          this._isInitializing = false;
          return;
        }

        // A URL-deep-linked scope (or an in-session one) already owns the
        // content area. The library search below would overwrite it with
        // unfiltered hits and cache those as if they were the library, so only
        // usage loads here.
        if (this.scopeOwnsView) {
          log('[MYSTORE] initialFetch: scope owns the view, skipping library search');
          this.loading = false;
          this._ssrHydrated = false;
          try {
            await this.ensureUsage(user);
          } catch (usageError) {
            log('[MYSTORE] initialFetch: ensureUsage failed while scope active:', usageError);
          }
          return;
        }

        // Always start from page 0 when entering /app so we fetch newest bookmarks first.
        this.currentPage = 0;

        // SSR bookmarks are painted immediately but are *not* the last word:
        // the rendered page can come off a cache (the browser's, a CDN's)
        // minutes after it was built, and skipping the client fetch on the
        // strength of it is why the newest bookmarks only turned up on a
        // second reload. Keep the instant paint, revalidate underneath it.
        const hydratedFromSsr = this._ssrHydrated && this.filteredSites.length > 0;
        if (hydratedFromSsr) {
          log('[MYSTORE] initialFetch: SSR data present, revalidating in the background');
          this.loading = false;

          // Cache the SSR data locally for offline use
          this.cacheSitesLocally(this.filteredSites);
        }
        this._ssrHydrated = false; // Clear flag so next navigation fetches normally

        this.allSitesLoaded = false;

        // Check if we need to fetch fresh data
        // Skip only if we have data AND we're still on the same navigation instance
        const hasRecentData = this.filteredSites.length > 0 && this._hasInitialized;

        if (hasRecentData) {
          log('[MYSTORE] initialFetch: Has recent data, but will still fetch fresh data in background');
          // Continue to fetch fresh data but don't block rendering
        }

        // 1) Fast path: show cached immediately, even when online. Skipped when
        // the page came with server-rendered bookmarks — those are newer than
        // anything in localStorage, and swapping them out for the cache would
        // be a visible step backwards.
        const cached = hydratedFromSsr ? null : localStorage.getItem('filteredSites');
        if (cached) {
          const cachedHits = JSON.parse(cached);
          log('[MYSTORE] initialFetch: Showing cached:', {
            runId,
            length: Array.isArray(cachedHits) ? cachedHits.length : null,
            firstId: Array.isArray(cachedHits) ? (cachedHits[0]?.objectId || cachedHits[0]?.customId) : null,
            firstTitle: Array.isArray(cachedHits) ? cachedHits[0]?.siteTitle : null
          });
          if (Array.isArray(cachedHits) && cachedHits.length) {
            this.filteredSites = cachedHits;
            this.savedSites = cachedHits;
            setTimeout(() => {
              try {
                log('[MYSTORE] initialFetch cache applied snapshot:', {
                  runId,
                  length: this.filteredSites.length,
                  firstId: this.filteredSites[0]?.objectId || this.filteredSites[0]?.customId,
                  firstTitle: this.filteredSites[0]?.siteTitle
                });
              } catch {}
            }, 0);
          }
        }

        // Offline fallback stays as-is
        if ((cached || hydratedFromSsr) && !navigator.onLine) {
          log('[MYSTORE] initial Offline mode 1');
          return;
        }

        // 2) Usage: only fetch if missing; don’t block the search

        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const fetchFreshSearchResult = async (maxAttempts = 2) => {
          let attempt = 0;
          let result;

          while (attempt < maxAttempts) {
            attempt += 1;
            result = await this.search({ userId: user.id });

            if (Array.isArray(result?.search?.hits)) {
              if (attempt > 1) {
                log(`[MYSTORE] initialFetch: search recovered on retry ${attempt}`);
              }
              return result;
            }

            if (attempt < maxAttempts) {
              log(`[MYSTORE] initialFetch: search attempt ${attempt} returned no hits payload, retrying...`);
              await wait(250);
            }
          }

          // `searchRes` used to be logged here — it is declared *below*, so
          // touching it threw a ReferenceError, the whole fresh fetch was
          // recorded as rejected and the grid kept the cached bookmarks until
          // the page was reloaded.
          log('[MYSTORE] initialFetch: search returned no hits payload after', maxAttempts, 'attempts');
          return result;
        };

        // 3) Search and usage in parallel
        const perfSearchStart = performance.now();
        const [searchRes] = await Promise.allSettled([
          fetchFreshSearchResult(2), 
          this.ensureUsage(user)
        ])
        ;
        log('[MYSTORE] initialFetch search perf:', performance.now() - perfSearchStart, 'ms');

        if (searchRes.status === 'fulfilled' && Array.isArray(searchRes.value?.search?.hits)) {
          const hits = searchRes.value.search.hits;

          // ALWAYS update filteredSites when coming from the server
          // Use direct assignment which triggers Pinia's reactivity properly
          // Don't skip updates even if data looks the same - server data is source of truth
          log('[MYSTORE] initialFetch fresh received:', {
            runId,
            length: hits.length,
            firstId: hits[0]?.objectId || hits[0]?.customId,
            firstTitle: hits[0]?.siteTitle
          });
          this.filteredSites = hits;
          this.savedSites = hits;

          log('[MYSTORE] Updated filteredSites with fresh data:', {
            runId,
            firstItem: this.filteredSites[0],
            firstSavedSites: this.savedSites[0],
            totalItems: this.filteredSites.length,
            updated: true
          });
          setTimeout(() => {
            try {
              log('[MYSTORE] initialFetch fresh applied snapshot:', {
                runId,
                length: this.filteredSites.length,
                firstId: this.filteredSites[0]?.objectId || this.filteredSites[0]?.customId,
                firstTitle: this.filteredSites[0]?.siteTitle
              });
            } catch {}
          }, 0);
          setTimeout(() => {
            try {
              log('[MYSTORE] initialFetch fresh applied snapshot (+250ms):', {
                runId,
                length: this.filteredSites.length,
                firstId: this.filteredSites[0]?.objectId || this.filteredSites[0]?.customId,
                firstTitle: this.filteredSites[0]?.siteTitle
              });
            } catch {}
          }, 250);

          // Async cache write
          this.cacheSitesLocally(hits);

          log('[MYSTORE] initialFetch: search hits:', hits);

          // Optimization: If we received fewer items than the page size, we know we've loaded everything
          if (hits.length < this.hitsPerPage) {
            log('[MYSTORE] initialFetch: Loaded all sites (count < hitsPerPage)');
            this.allSitesLoaded = true;
          }
        } else {
          log('[MYSTORE] initialFetch: No fresh search payload received, keeping cached data if available');
        }

        // 4) Non-blocking tracking
        setTimeout(() => {
          try {
            useTrackEvent('AppAccessed', { props: { userId: user.id } });
          } catch {}
        }, 0);

      } catch (error) {
        this.handleParseError(error, 'initialFetch(), myStore.js');
        log('error fetching from parse:', error);

        const storedData = localStorage.getItem('filteredSites');
        if (storedData) {
          log('initial Offline mode 2');
          this.filteredSites = JSON.parse(storedData);
        }
      } finally {
        this._isInitializing = false;
        this._hasInitialized = true;
        this.loading = false;
        log('[MYSTORE] initialFetch end:', {
          runId: this._lastInitialFetchRunId,
          ms: performance.now() - start,
          length: this.filteredSites.length,
          firstId: this.filteredSites[0]?.objectId || this.filteredSites[0]?.customId,
          firstTitle: this.filteredSites[0]?.siteTitle
        });
      }
    },

    signInWithApple(){
      try{
        this.loadingSignInWithApple = true;
        
        // Generate a random state for CSRF protection
        const state = crypto.randomUUID();
      
        // Store state in sessionStorage to verify on callback
        sessionStorage.setItem('apple_auth_state', state);
      
        // Build the OAuth parameters
        const params = new URLSearchParams({
          client_id: 'io.webbites.web',
          redirect_uri: window.location.origin + '/auth/apple/callback',
          response_type: 'code id_token',
          response_mode: 'form_post',
          scope: 'name email',
          state: state
        });
      
        // Redirect to Apple's authorization endpoint
        window.location.href = `https://appleid.apple.com/auth/authorize?${params.toString()}`;
      } catch(error){
        this.handleParseError(error, 'signInWithApple(), myStore.js');
        this.loadingSignInWithApple = false;
      }
      // No `finally` reset: assigning `location.href` only *starts* the
      // navigation, and the page stays on screen until Apple answers. Clearing
      // the flag in the same tick meant Vue never rendered the spinner at all,
      // so the button looked dead for the second or two the redirect takes.
      // Coming back through the back button is handled by the button itself.
    },

    getSize( data, string = 'data'){
      let size = (new Blob([JSON.stringify(data)]).size / 1024).toFixed(2) + "KB"
      log(`${string } size in KB: ${size}`);
      return size
    },

    async fetchUserOptions(){
      const parseOperationsStart = performance.now()
      
      try{
        if(!Parse.User.current()) return;

        /// fetch user options from parse
        let user = Parse.User.current();
        let userOptions = await user.fetch({ include: ['userOptions']});
        // let userOptions = await user.fetch({ include: ['userOptions'], exclude: this.userColumnsToExclude });
        // this.getSize(userOptions, 'userOptions')
        userOptions = userOptions.get('userOptions');
        let options = userOptions ? userOptions.get('options') : undefined;

        if (!userOptions || options == undefined) {
          log("isFirstTime 0");
          try {
            log("isFirstTime 1");
            let userOptions = new UserOptions();
            let defaultUserOptions = useStoreConstants().defaultUserOptions;
            log('new defaultUserOptions: ', defaultUserOptions);
            this.isFirstTime = true;
            userOptions.set('user', Parse.User.current());
            userOptions.set('options', defaultUserOptions);
            userOptions.setACL(new Parse.ACL(Parse.User.current()))
            Parse.User.current().set('userOptions', userOptions);
            await Parse.User.current().save();
          } catch (error) {
            this.handleParseError(error, 'fetchUserOptions(), myStore.js');
          }
        } else {
          this.recentSearches = userOptions.get('recentSearches') ? userOptions.get('recentSearches') : this.recentSearches;
          this.isFirstTime = userOptions.get('isFirstTime');
          this.userOptions = options;

          let setImageRatio = useStoreConstants().imageRatioOptions.find(option => option.id === this.userOptions.imageRatio);
          if(setImageRatio.id == undefined || setImageRatio.id != this.userOptions.imageRatio) this.imageRatio = useStoreConstants().imageRatioOptions[0];

          if (this.userOptions.showDescription == undefined) {
            this.userOptions.showDescription = true;
            this.saveUserOptions('fetchUserOptions');
          }

          // Accounts predating the AI language setting have no value stored;
          // the backend already defaults to English, so match it here.
          if (this.userOptions.aiLanguage == undefined) {
            this.userOptions.aiLanguage = defaultUserOptions.aiLanguage;
          }
          if (this.userOptions.aiVoice == undefined) {
            this.userOptions.aiVoice = defaultUserOptions.aiVoice;
          }
          if (this.userOptions.aiAccent == undefined) {
            this.userOptions.aiAccent = defaultUserOptions.aiAccent;
          }

          // await this.fetchUserTags();
        }
      } catch (error) {
        this.handleParseError(error, 'fetchUserOptions(), myStore.js');
      } finally {
        const parseOperationsEnd = performance.now()
        log('[MYSTORE] fetchUserOptions: ', parseOperationsEnd - parseOperationsStart, 'ms')
      }
    },

    async saveUserOptions(origin) {
      try {
        const user = Parse.User.current();
        if (!user) {
          console.warn('No user is currently logged in');
          return;
        }

        log("___________saveUserOptions origin: ", origin)

        let optionsObj = user.get('userOptions');
        // let optionsObj = await user.fetch().then(user => user.get('userOptions'));

        // If no options exist, create new ones
        if (!optionsObj) {
          try {
            const userOptions = new UserOptions();
            userOptions.set('user', user);
            userOptions.set('options', useStoreConstants().defaultUserOptions);

            // Create a new ACL for the user
            const acl = new Parse.ACL(user);
            userOptions.setACL(acl);

            // Save the new options
            await userOptions.save();

            // Update user with reference to new options
            user.set('userOptions', userOptions);
            await user.save();

            optionsObj = userOptions;
          } catch (initError) {
            console.error("Error initializing user options:", initError);
            throw initError;
          }
        }

        // Update existing options
        try {
          log("this.userOptions: ", this.userOptions);
          log("optionsObj.get('options'): ", optionsObj.get('options'));
          log(JSON.stringify(optionsObj.get('options')) !== JSON.stringify(this.userOptions));

          // Only save if changes were made to recentSearches or options
          // if (JSON.stringify(optionsObj.get('recentSearches')) !== JSON.stringify(this.recentSearches) ||
          //     JSON.stringify(optionsObj.get('options')) !== JSON.stringify(this.userOptions)) {

              optionsObj.set('recentSearches', this.recentSearches);
              optionsObj.set('options', this.userOptions);
              await optionsObj.save();

              log("Successfully saved user options");
          // }

          return;
        } catch (saveError) {
          console.error("Error saving options:", saveError);
          throw saveError;
        }
      } catch (error) {
        console.error("Critical error in saveUserOptions:", error);
        throw error;
      }
    },

    async initUserSubscription(user) {
      const userQuery = new Parse.Query(Parse.User)
        .equalTo('objectId', user.id)
      return await userQuery.subscribe()
    },

    async initUserOptionsSubscription() {
      const userOptionsQuery = new Parse.Query(UserOptions)
        .equalTo('user', Parse.User.current())
      return await userOptionsQuery.subscribe()
    },

    async initWebsitesSubscription() {
      try {
        const user = Parse.User.current();
        if (!user) {
          throw new Error('No user logged in for websites subscription');
        }

        let order = 'ascending';
        if (!this.userOptions) {
          console.warn('UserOptions is not initialized, using default order');
          order = 'ascending';
        } else {
          order = this.userOptions.orderBy === 'newFirst' ? 'ascending' : 'descending';
        }

        const websitesQuery = new Parse.Query(Websites);
        // CRITICAL: Filter by current user to ensure LiveQuery works and respects ACLs
        websitesQuery.equalTo('user', user);
        websitesQuery[order]("createdAt");
        websitesQuery.exclude(this.websiteColumnsToExclude);

        if (location.hostname.includes("localhost")) {
          log('Subscribing to websites with query:', {
            userId: user.id,
            order,
            excludedColumns: this.websiteColumnsToExclude
          });
        }

        const subscription = await websitesQuery.subscribe()
        // Register this before other LiveQuery subscriptions finish. A bookmark
        // can be saved while an unrelated subscription is still connecting.
        const addLiveBookmark = (object) => {
          this.addToFilteredSites({ ...object.attributes, objectId: object.id });
        };
        subscription.on('create', addLiveBookmark);
        subscription.on('enter', addLiveBookmark);

        if (location.hostname.includes("localhost")) log('Websites subscription successful');
        return subscription;
      } catch (error) {
        console.error('Detailed error in initWebsitesSubscription:', error);
        console.error('Error stack:', error.stack);
        console.error('Error message:', error.message);
        if (error.code) console.error('Parse error code:', error.code);
        throw error;
      }
    },

    async initBookmarksToImportSubscription(options = {}) {
      try {
        const user = Parse.User.current();
        if (!user) return null;

        const bookmarksToImportQuery = new Parse.Query(BookmarksToImport);
        bookmarksToImportQuery.equalTo('user', user);
        bookmarksToImportQuery.ascending('createdAt');

        const subscription = await bookmarksToImportQuery.subscribe();

        // Default behavior: update store array
        const updateStoreArray = options.updateStoreArray !== false;
        
        // Optional callbacks for external components
        const { onCreateCallback, onDeleteCallback, onUpdateCallback } = options;

        subscription.on('create', (bookmark) => {
          log('New bookmark to import created:', bookmark);
          
          // Update store array if enabled
          if (updateStoreArray) {
            this.bookmarksToImport.push(bookmark.get('url') || bookmark.get('title') || bookmark.id);
          }
          
          // Call external callback if provided
          if (onCreateCallback) onCreateCallback(bookmark);
        });

        subscription.on('delete', (bookmark) => {
          log('Bookmark to import deleted:', bookmark);
          
          // Update store array if enabled
          if (updateStoreArray) {
            const urlToRemove = bookmark.get('url') || bookmark.get('title') || bookmark.id;
            this.bookmarksToImport = this.bookmarksToImport.filter(url => url !== urlToRemove);
          }
          
          // Call external callback if provided
          if (onDeleteCallback) onDeleteCallback(bookmark);
        });

        subscription.on('update', (bookmark) => {
          log('Bookmark to import updated:', bookmark);
          
          // Call external callback if provided (updates don't affect store array)
          if (onUpdateCallback) onUpdateCallback(bookmark);
        });

        if (location.hostname.includes("localhost")) log('BookmarksToImport subscription successful');
        return subscription;
      } catch (error) {
        console.error('Error in initBookmarksToImportSubscription:', error);
        throw error;
      }
    },

    async initImportSessionSubscription(user) {
      try {
        if (!user) user = Parse.User.current();
        if (!user) return null;

        const ImportSession = Parse.Object.extend('ImportSession');
        const sessionQuery = new Parse.Query(ImportSession)
          .equalTo('user', user);

        const subscription = await sessionQuery.subscribe();

        const updateActiveSession = async (obj) => {
          const status = obj.get('status');

          if (status === 'active' || status === 'processing') {
            this.importStatus.session = this.convertImportSessionToObject(obj, user);
            this.importStatus.isActive = true;
            this.importStatus.status = status;
          } else {
            if (this.importStatus.session?.sessionId === obj.get('sessionId')) {
              this.importStatus.session = null;
              this.importStatus.isActive = false;
              this.importStatus.status = 'none';
            }

            const pastSessions = await this.getPastImportSessions(user);
            this.importStatus.history = pastSessions;
          }
        };

        subscription.on('update', updateActiveSession);
        subscription.on('create', updateActiveSession);
        subscription.on('enter', updateActiveSession);

        if (location.hostname.includes('localhost')) log('ImportSession subscription initialized');
        return subscription;
      } catch (error) {
        console.error('Error setting up ImportSession subscription:', error);
        throw error;
      }
    },

    async subscribeToParse() {
      const user = Parse.User.current();
      const parseOperationsStart = performance.now()

      if (!user) {
        console.log('No user found, skipping subscription');
        return
      }

      try {
        await this.initialUserFetch()
      } catch (error) {
        console.error('Error in initialUserFetch:', error);
      }

      try {
        // Add LiveQuery error handling
        Parse.LiveQuery.on('error', (error) => {
          console.error('LiveQuery connection error:', error);
          console.error('LiveQuery error details:', {
            message: error.message,
            code: error.code,
            serverURL: Parse.liveQueryServerURL
          });
        });

        Parse.LiveQuery.on('close', () => {
          console.warn('LiveQuery connection closed');
        });

        Parse.LiveQuery.on('open', () => {
          log('LiveQuery connection opened successfully');
        }); 

        await this.fetchEntitlements();

        const [userSubscription, userOptionsSubscription, websitesSubscription, bookmarksToImportSubscription, importSessionSubscription] = await Promise.all([
          this.initUserSubscription(user),
          this.initUserOptionsSubscription(),
          this.initWebsitesSubscription(),
          user.get('importAccessStatus') ? this.initBookmarksToImportSubscription() : null,
          this.initImportSessionSubscription(user)
      ])

      // Store the bookmarksToImportSubscription in state
      this.bookmarksToImportSubscription = bookmarksToImportSubscription;
      this.importSessionSubscription = importSessionSubscription;


      // User subscription
      userSubscription.on('open', () => {
        log('User subscription opened successfully');
      });

      userSubscription.on('error', (error) => {
        console.error('User subscription error:', error);
      });

      userSubscription.on('update', async (user) => {
        log('User updated: ', user);

        // The row changed, so the quotas derived from it may have too. Re-ask
        // the endpoint rather than re-deriving them from the columns here — it
        // also refreshes `websiteCount` from the same reading.
        await this.fetchEntitlements();

        let oldImporting = this.importing;
        let newImportAccessStatus = user.get('importAccessStatus');

        if(newImportAccessStatus == 'importing'){
          // Use the bookmarksToImport array from state (updated by subscription)
          let remainingBookmarks = this.bookmarksToImport.length;

          if(remainingBookmarks == 0) {
            this.alert.show = false;
            // this.showImportBookmarksModal = false;
            log("setting showImportBookmarksModal to false 1: ", this.showImportBookmarksModal);
            return
          };
          // this.showAlert({
          //     message: `${useNuxtApp().$i18n.t('alerts.import.remaining')} ${remainingBookmarks}`,
          //     permanent: true
          // });
          this.importing = remainingBookmarks;
        } else if(oldImporting){
          const wasCancelled = this.importCancelled;
          this.importCancelled = false;
          if(this.importing && !wasCancelled){
            this.showAlert({
              message: useNuxtApp().$i18n.t('alerts.import.complete'),
              description: useNuxtApp().$i18n.t('alerts.import.complete_description'),
              type: 'success',
            });
            // this.showImportBookmarksModal = false;
          }
          // let newFinishedImporting = user.get('importAccessStatus') == 'completed';

          this.importing = false;
        }

        // Refresh centralized import status on user updates
        await this.refreshImportStatus(user);
      });

      userSubscription.on('delete', (user) => {
        log('User deleted: ', user);
        this.logout()
        // Handle the user deletion logic here
      });

      // User options subscription
      userOptionsSubscription.on('open', () => {
        log('UserOptions subscription opened successfully');
      });

      userOptionsSubscription.on('error', (error) => {
        console.error('UserOptions subscription error:', error);
      });

      userOptionsSubscription.on('update', (object) => {
        this.isFirstTime = object.get('isFirstTime')
        this.userOptions = object.attributes.options;
        this.recentSearches = object.get('recentSearches') ? object.get('recentSearches') : this.recentSearches;
      })

      // Websites subscription
      websitesSubscription.on('open', () => {
        log('Websites subscription opened successfully');
      });

      websitesSubscription.on('error', (error) => {
        console.error('Websites subscription error:', error);
      });

      websitesSubscription.on('update', async (object) => {

        log('websitesSubscription update: ', object);

        // A soft delete reaches us as an update, not a 'delete' event — the row
        // is still in Parse for 30 days. Treat it as the removal it is,
        // otherwise the handler below happily re-adds it to the grid.
        if (object.get('isDeleted')) {
          this.filteredSites = this.filteredSites.filter((site) => site.objectId !== object.id);
          this.savedSites = this.savedSites.filter((site) => site.objectId !== object.id);
          this.pinnedSites = this.pinnedSites.filter((site) => site.objectId !== object.id);
          this.cacheSitesLocally();
          return;
        }

        // Hiding arrives the same way, and means the opposite thing in each
        // scope: a bookmark hidden on another device has to leave this grid,
        // and one unhidden there has to leave the Private section. Without this
        // the handler below puts it straight back.
        const isHidden = Boolean(object.get('hiddenFrom'));
        if (isHidden !== this.privateScope) {
          this.filteredSites = this.filteredSites.filter((site) => site.objectId !== object.id);
          this.savedSites = this.savedSites.filter((site) => site.objectId !== object.id);
          this.pinnedSites = this.pinnedSites.filter((site) => site.objectId !== object.id);
          this.cacheSitesLocally();
          return;
        }

        if (this.webToShow.objectId == object.id) {
          let updatedAttributes = { ...object.attributes };
          // log('updatedAttributes.siteNotes: ', updatedAttributes.siteNotes);
          if(this.pageNotesFocused) updatedAttributes.siteNotes = this.webToShow.siteNotes;

          // Text note: attempt three-way merge when user is actively editing
          if (this.hasFocusTipTap) {
            const incomingNote = updatedAttributes.textNote || ''
            const localNote = this.webToShow.textNote || ''
            const baseNote = this.lastServerTextNote ?? localNote

            const { mergeTextNote, hasContentChanged } = await import('~/composables/useTextNoteMerge')
            const remoteChanged = hasContentChanged(baseNote, incomingNote)

            if (remoteChanged) {
              const result = mergeTextNote(baseNote, localNote, incomingNote)
              if (result.merged !== null) {
                // Auto-merge succeeded — apply silently
                updatedAttributes.textNote = result.merged
                this.lastServerTextNote = incomingNote
                if (result.hadConflict) {
                  this.showAlert({
                    message: useNuxtApp().$i18n.t('alerts.live_note.merged_with_conflicts'),
                    type: 'info',
                    timeOnScreen: 4000,
                  })
                }
              } else {
                // Too many conflicts — keep local, notify user
                updatedAttributes.textNote = localNote
                this.lastServerTextNote = incomingNote
                this.showAlert({
                  message: useNuxtApp().$i18n.t('alerts.live_note.conflict'),
                  type: 'warning',
                  timeOnScreen: 6000,
                })
              }
            } else {
              // No remote changes — keep local
              updatedAttributes.textNote = localNote
            }
          } else {
            // Not editing — accept server version and update baseline
            this.lastServerTextNote = updatedAttributes.textNote || null
          }

          if (this.webToShow.siteBody) updatedAttributes.siteBody = this.webToShow.siteBody;
          // `drawing` is excluded from list queries, so a LiveQuery payload carries no
          // snapshot at all — assigning it wholesale would blank an open board. Keep
          // the copy we have, and keep the user's in-progress strokes over a stale
          // server snapshot the same way hasFocusTipTap protects a text note.
          if (this.isEditingDrawing || updatedAttributes.drawing == null) {
            updatedAttributes.drawing = this.webToShow.drawing;
          }
          this.webToShow = updatedAttributes;
          this.webToShow.objectId = object.id;
        }

        if(!object.get('pinned') && this.pinnedSites.some(site => site.objectId === object.id)) {
          log('Pinned Removed');

          this.pinnedSites = this.structureParseData(this.pinnedSites.filter(site => site.objectId !== object.id))
        }

        if(object.get('pinned') && !this.pinnedSites.some(site => site.objectId === object.id)) {
          log('Pinned Added');
          log('this.structureParseData([object]) 2: ', this.structureParseData([object]));
          this.getSize(object, 'structureParseData([object]')
        }

        if(!this.filteredSites.some(site => site.objectId === object.id)){
          log('object.id: ', object.id);
          let bookmark = await this.getBookmarkFromParse(object.id);
          log('bookmark: ', bookmark);
        }

        if (this.isFirstTime && !this.filteredSites.some(site => site.objectId === object.id)) {
          const query = new Parse.Query(Websites);
          query.equalTo("objectId", object.id);
          const website = await query.first();
          if (website) {
            let newSite = { ...website.attributes };
            newSite.objectId = website.id;
            this.filteredSites.push(newSite);
          }
        }

        this.filteredSites.forEach((site, index) => {
          if (site.objectId === object.id) {
            this.filteredSites[index] = { ...object.attributes };
            this.filteredSites[index].objectId = object.id;
            this.savedSites = this.filteredSites;
          }
        })
      });

      websitesSubscription.on('delete', (object) => {
        log("website deleted: ", object)
        this.filteredSites.forEach((site, index) => {
          if (site.objectId === object.id) {
            let clonedSites = [...this.filteredSites];
            clonedSites.splice(index, 1);
            this.filteredSites = clonedSites;
            this.savedSites = this.filteredSites;
          }
        })
      })
      } catch (error) {
        console.error("error subscribing to parse: ", error);
        this.handleParseError(error, 'subscribeToParse(), myStore.js');
      } finally {
        const parseOperationsEnd = performance.now()
        log('[MYSTORE] subscribeToParse 2: ', parseOperationsEnd - parseOperationsStart, 'ms')
      }
    },

    async getBookmarkFromParse(objectId){
      try {
        const query = new Parse.Query(Websites);
        query.equalTo("objectId", objectId);
        const bookmark = await query.first();
        if (bookmark) {
          return bookmark;
        }
        return null;
      } catch (error) {
        console.error("error fetching bookmark from parse: ", error);
        this.handleParseError(error, 'getBookmarkFromParse(), myStore.js');
      }
    },

    async initialUserFetch(){
      const user = Parse.User.current()

      this.userInfo.username = user.get('username') ?? '';
      this.userInfo.email = user.get('email') ?? '';

      this.importing = user.get('importing');
      log('this.importing: ', this.importing);
      
      // If user has import access, fetch bookmarks from the bookmarksToImport class
      if(user.get('importAccessStatus') == 'importing'){
        try {
          const bookmarksToImportQuery = new Parse.Query(BookmarksToImport);
          bookmarksToImportQuery.equalTo('user', user);
          bookmarksToImportQuery.limit(10000);
          const bookmarksToImportObjects = await bookmarksToImportQuery.find();
          
          // Update the bookmarksToImport array in state
          this.bookmarksToImport = bookmarksToImportObjects.map(bookmark => 
            bookmark.get('url') || bookmark.get('title') || bookmark.id
          );
          
          let remainingBookmarks = this.bookmarksToImport.length;
          
          this.showImportBookmarksModal = false
          log("setting showImportBookmarksModal to false 2: ", this.showImportBookmarksModal);
          
          if(remainingBookmarks == 0) {
            this.alert.show = false;
            this.showImportBookmarksModal = false;
            log("setting showImportBookmarksModal to false 3: ", this.showImportBookmarksModal);
            return
          };
          
          log("remainingBookmarks: ", remainingBookmarks);

          this.showImportStatusModal = true;
        } catch (error) {
          console.error('Error fetching bookmarks to import:', error);
        }
        // Initialize centralized import status after initial fetch
        await this.refreshImportStatus(user);
      }
    },

    handleParseError(err, origin) {
      log("error handleParseError: ", err);
      log("error code: ", err.code);
      log("origin error: ", origin);

      if(err.code == 101 || err.code == 206){
        console.error("custom - invalid session token: ", err);
        Parse.User.logOut();
        location.reload();
      }

      switch (err.code) {
        case Parse.Error.INVALID_SESSION_TOKEN:
          console.error("custom - invalid session token: ", err);
          Parse.User.logOut();
          location.reload();
          break;
        default:
          console.error("error code: ", err.code, err);
          break;
      }
    },

    /**
     * Edit a feedback post on HelpBites. Authors may change title, body, type
     * and platform; admins (whose token carries role: admin) anything. The
     * server decides — this just applies what comes back.
     */
    async updateFeedback(id, patch) {
      if (!id || !patch) return;
      try {
        const { post } = await useFeedbackApi().update(id, patch);
        this.applyFeedbackPost(post);
        return post;
      } catch (error) {
        console.error("error updating feedback: ", error);
        this.showAlert({ type: 'error', message: error.message });
        throw error;
      }
    },

    async getParseConfig(){
      const config = await Parse.Config.get();
      let modalMessage = config.attributes.modalMessage;
    },

    async fetchPlans() {
      try {
        // `/api/getPlans` proxies the backend's `GET /v1/plans`, so this is the
        // published catalogue rather than a copy of it. Entries are plan rows:
        // group them with `groupPlansByTier` to render a card per tier.
        const fetchedPlans = await $fetch(`/api/getPlans`);
        this.plans = Array.isArray(fetchedPlans) ? fetchedPlans : [];
      } catch (error) {
        console.error('Error fetching plans:', error);
        this.plans = [];
      }
    },

    /**
     * Load the signed-in user's plan, quotas and feature flags.
     *
     * One request answers what plan, what limits, how much is spent and what is
     * unlocked. Everything that used to be assembled here from
     * `user.get('currentPlan')` plus the `usage` column now comes from it.
     *
     * Returns the response so callers that need a fresh reading (the save gate)
     * can act on it without waiting for the state to propagate.
     *
     * `sync: true` first asks the backend to re-derive the plan from Stripe
     * (`POST /v1/me/plan/refresh`). Use it on return from checkout: the user is
     * back before Stripe's webhook lands, and without this the success screen
     * shows the plan they just left.
     */
    async fetchEntitlements({ sync = false } = {}) {
      if (!Parse.User.current()) return null;

      try {
        const { backendFetch } = useBackendFetch();
        if (sync) {
          await backendFetch('me/plan/refresh', { method: 'POST' }).catch((error) => {
            console.error('Error refreshing plan from Stripe:', error);
          });
        }
        const entitlements = await backendFetch('me/entitlements');

        this.entitlements = entitlements;
        this.userPlan = entitlements.plan ?? {};
        this.usage = entitlements.usage ?? null;
        this.features = entitlements.features ?? {};
        this.billingEnabled = Boolean(entitlements.billing?.enabled);

        if (typeof entitlements.usage?.bookmarks?.used === 'number') {
          this.websiteCount = entitlements.usage.bookmarks.used;
        }

        return entitlements;
      } catch (error) {
        console.error('Error fetching entitlements:', error);
        return null;
      }
    },

    async checkIfAdmin(){
      console.log('checkIfAdmin()');
      const router = useRouter();

      if(!Parse.User.current()){
        this.isAdmin = false;
        router.replace({ path: '/'})
        return false
      }      
      
      try {
        let isAdminRes = await $fetch('/api/auth/isAdmin')
        console.log('isAdminRes: ', isAdminRes);
        if (isAdminRes.isAdmin) {
            this.isAdmin = true;
            return true
        } else {
            this.isAdmin = false;
            router.replace({ path: '/'});
            return false
        }
      } catch (error) {
        this.isAdmin = false;
        console.error("Error checking admin role: ", error);
        this.handleParseError(error, 'checkIfAdmin(), myStore.js');
        return false
      }
    },

    copyToClipboard(text, showNotification = true) {
      try {
        navigator.clipboard.writeText(text);
        text = text.slice(0, 40) + (text.length > 40 ? '...' : '');
        if(showNotification) this.showAlert({ type: 'success', message: useNuxtApp().$i18n.t('alerts.clipboard.copy_success', { text }) });
      } catch (error) {
        console.error("Error copying text: ", error);
        this.showAlert({ type: 'error', message: useNuxtApp().$i18n.t('alerts.clipboard.copy_error') });
      }
    },

    /**
     * Metadata for a link, for the card shown while it is being saved.
     *
     * Always answers with an object, never a half one. The endpoint hands back
     * its own error when a site refuses a server-side fetch — IMDb and plenty
     * of others 403 one — and an error reads exactly like a preview to the
     * card: truthy, with no title and no image, which is how the composer came
     * to draw a blank gradient with nothing under it. A link that cannot be
     * read still has a URL, and the card can name it.
     */
    async fetchWebsitePreview(url) {
      const unavailable = { title: '', description: '', imageUrl: '', url, unavailable: true };
      try {
        const preview = await $fetch('/api/fetchWebsitePreview', { method: 'post', body: { url } });
        if (!preview || preview.error || (!preview.title && !preview.imageUrl)) return unavailable;
        return preview;
      } catch (error) {
        log('error fetching website preview: ', error);
        return unavailable;
      }
    },

    async getBookmarksToImport(){
      if(this.bookmarksToImport.length == 0){
        let user = await Parse.User.current().fetch();
        let bookmarkFile = await user.get('importedBookmarks');
        await this.importBookmarksFile(bookmarkFile._url || bookmarkFile.url(), true)
      }
    },

    // ===== Import Status Helpers =====
    convertImportSessionToObject(sessionObj, user) {
      return {
        sessionId: sessionObj.get('sessionId'),
        batchId: sessionObj.get('batchId'),
        user,
        startedAt: sessionObj.get('startedAt'),
        completedAt: sessionObj.get('completedAt'),
        totalBookmarks: sessionObj.get('totalBookmarks') || 0,
        processedBookmarks: sessionObj.get('processedBookmarks') || 0,
        failedBookmarks: sessionObj.get('failedBookmarks') || 0,
        skippedBookmarks: sessionObj.get('skippedBookmarks') || 0,
        currentlyProcessing: sessionObj.get('currentlyProcessing'),
        estimatedCompletion: sessionObj.get('estimatedCompletion'),
        processingRate: sessionObj.get('processingRate') || 0,
        status: sessionObj.get('status') || 'inactive',
        lastProgressUpdate: sessionObj.get('lastProgressUpdate'),
        accessType: sessionObj.get('accessType'),
        originalBookmarkCount: sessionObj.get('originalBookmarkCount') || 0,
        filteredBookmarkCount: sessionObj.get('filteredBookmarkCount') || 0,
        errors: sessionObj.get('errors') || [],
        milestones: sessionObj.get('milestones') || {},
        performance: sessionObj.get('performance') || {},
        batchInfo: sessionObj.get('batchInfo') || null,
        initializationMessage: sessionObj.get('initializationMessage')
      }
    },

    async getActiveImportSession(user) {
      try {
        if (!user) user = Parse.User.current();
        if (!user) return null;

        const ImportSession = Parse.Object.extend('ImportSession');
        const query = new Parse.Query(ImportSession);
        query.equalTo('user', user);
        query.containedIn('status', ['active', 'processing']);
        query.descending('createdAt');

        const active = await query.first();
        if (!active) return null;
        return this.convertImportSessionToObject(active, user);
      } catch (error) {
        console.error('Error getting active session:', error);
        return null;
      }
    },

    async getPastImportSessions(user) {
      try {
        if (!user) user = Parse.User.current();
        if (!user) return [];

        const ImportSession = Parse.Object.extend('ImportSession');
        const query = new Parse.Query(ImportSession);
        query.equalTo('user', user);
        query.notContainedIn('status', ['active', 'processing']);
        query.descending('createdAt');
        query.limit(10);

        const sessions = await query.find();
        return sessions.map(session => this.convertImportSessionToObject(session, user));
      } catch (error) {
        console.error('Error getting past sessions:', error);
        return [];
      }
    },

    isTauri() {
      return false;
    },

    async refreshImportStatus(user) {
      try {
        if (!user) user = Parse.User.current();
        if (!user) return;

        const remainingCount = this.bookmarksToImport.length;
        const activeSession = await this.getActiveImportSession(user);
        const pastSessions = await this.getPastImportSessions(user);

        this.importStatus = {
          status: activeSession?.status || 'none',
          isActive: !!activeSession,
          session: activeSession,
          batch: null,
          remaining: Number(remainingCount || 0),
          failures: [],
          history: pastSessions
        };
      } catch (error) {
        console.error('Error refreshing import status:', error);
      }
    },

    /**
     * Put a list of urls in the import modal, preselecting what the plan still
     * allows. Shared by file imports and connected services (Raindrop, …).
     */
    setBookmarksToImport(urls) {
      let importLimit = this.importLimit;
      const usedBookmarks = Parse.User.current()?.get('usage')?.currentMonth?.bookmarksTotal ?? 0;
      if (Number.isInteger(usedBookmarks)) importLimit -= usedBookmarks;

      const bookmarks = [...new Set(urls)].filter(url => this.isValidUrl(url));
      this.selectedBookmarksToImport = bookmarks.slice(0, Math.max(0, importLimit));
      this.bookmarksToImport = [...bookmarks].sort();
      this.showImportBookmarksModal = true;
    },

    // TODO: Test and finish import bookmark paying process
    async importBookmarksFile(file, isUrl = false){
      let user = Parse.User.current();
      user = await user.fetch();

      log("user: ", user);
      
      let totalImportedBookmarks = user.get('totalImportedBookmarks') || 0;
      this.totalImportedBookmarks = totalImportedBookmarks;

      let numberOfBookmarks;
      let fileExtension;
      let bookmarks = [];
      let parseFile;
      let fileUrl;

      try {
        if(file == undefined){
          file = document.getElementById('importBookmarks').files[0];
          log("file: ", file);
        }

        if(!isUrl){
          this.showSettingsModal = false;
          this.showAlert({
              type: 'info',
              message: useNuxtApp().$i18n.t('alerts.import.progress'),
              description: useNuxtApp().$i18n.t('alerts.import.progress_description'),
              permanent: true
          });

          parseFile = new Parse.File(file.name, file);
          let savedFile = await parseFile.save();
          console.log('savedFile: ', savedFile)

          fileUrl = parseFile.url();
          fileExtension = file.name.split('.').pop();
        } else{
          fileUrl = file;
          fileExtension = fileUrl.split('.').pop();
        }

        if (location.hostname.includes("localhost")){
          log("File extension:", fileExtension);
        }

        async function getNumberOfBookmarks(fileExtension) {
            let sourceText;

            if (isUrl) {
                sourceText = await (await fetch(fileUrl)).text();
            } else {
                sourceText = await file.text();
            }

            switch (fileExtension) {
                case 'html':
                    const parser = new DOMParser();
                    const htmlDoc = parser.parseFromString(sourceText, 'text/html');
                    const links = htmlDoc.querySelectorAll('a');
                    links.forEach(link => {
                        const href = link.href;
                        if (href && (href.startsWith('http://') || href.startsWith('https://')) && !bookmarks.includes(href)) {
                            bookmarks.push(href);
                        }
                    });
                    break;

                case 'txt':
                    bookmarks = sourceText.replace(/,/g, '\n');
                    bookmarks = bookmarks.replace(/\n+/g, '\n').trim();
                    bookmarks = bookmarks.split('\n');
                    break;

                case 'csv':
                    bookmarks = sourceText.replace(/,/g, '\n');
                    bookmarks = bookmarks.replace(/\n+/g, '\n').trim();
                    bookmarks = bookmarks.split('\n');
                    bookmarks = bookmarks.filter(url => url.includes('http'));
                    break;
            }

            bookmarks = [...new Set(bookmarks)];

            return bookmarks.length;
        }

        numberOfBookmarks = await getNumberOfBookmarks(fileExtension);
        this.alert.show = false;

        log("before length: ", bookmarks.length);
        bookmarks = bookmarks.filter(url => this.isValidUrl(url));
        let canImport = this.importAccessData?.hasAccess;

        log("this.importAccessData: ", this.importAccessData);
        log("canImport: ", canImport);

        this.setBookmarksToImport(bookmarks);

        log("numberOfBookmarks 2: ", numberOfBookmarks);
        log("selectedBookmarksToImport: ", this.selectedBookmarksToImport.length);
        log("userId: ", user.id);
        user.set('importedBookmarks', parseFile);
        await user.save();
      } catch (error) {
          log("error: ", error);
          this.showAlert({
              message: useNuxtApp().$i18n.t('alerts.import.error'),
              type: 'error'
          })
      }
    },

    markedText(text) {
      try {
        const html = micromark(text)
        const updated = html
            .replace(/(<a\b[^>]*?\btarget\s*=\s*)(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '$1"_blank"')
              .replace(/<a\b(?![^>]*\btarget=)/gi, '<a target="_blank"');
        return updated
      } catch (error) {
          return error
      }
    },

   isValidUrl(url){
     try {
        url = url.trim()
        if(url.startsWith('javascript'))return false;
        const newUrl = new URL(url);

        if(newUrl.protocol != 'http:' && newUrl.protocol != 'https:') return false;

        return true;
      } catch (error) {
        log(`${url} is not a valid url: ${error} `);
        return false;
      }
    },

    async createCheckoutSession({ priceId, type = 'subscription', plan = null, showYearly = false }) {
      try {
        // Check if user is authenticated
        if (!Parse.User.current()) {
          this.showAuthModal = true;
          return { success: false, error: 'User not authenticated' };
        }

        let finalPriceId = priceId;

        // A plan row from `/v1/plans` is sold under its own `planId` — that id
        // *is* the Stripe price id, which is what lets the webhook resolve a
        // plan with no translation table. Callers that render a card per tier
        // pass the row for the chosen cadence (see `planForCadence`).
        if (type === 'subscription' && plan) {
          finalPriceId = plan.planId ?? finalPriceId;
        }

        // Handle import pricing
        if (type === 'import') finalPriceId = 'webbites-import';

        const stripeSession = await $fetch('/api/create-checkout-session', {
          method: 'post',
          body: {
            priceId: finalPriceId,
          }
        });

        if (stripeSession?.stripeUrl) {
          window.open(stripeSession.stripeUrl, '_blank');
          return { success: true, stripeSession };
        }

        throw new Error('No stripe URL received');
      } catch (error) {
        console.error('createCheckoutSession error:', error);
        console.error('error.statusCode: ', error.statusCode);
        console.error('error.message: ', error.message);
        console.error('error.data: ', error.data);

        // Extract error details from FetchError structure
        const statusCode = error.statusCode || error.data?.statusCode;
        const errorMessage = error.data?.message || error.message;

        // Handle specific error for duplicate subscription plan
        if (statusCode === 400 && errorMessage === 'User already has this subscription plan') {
          this.showAlert({
            message: useNuxtApp().$i18n.t('alerts.subscription.duplicate_plan'),
            type: 'danger',
            timeOnScreen: 8000
          });
          return { success: false, error: 'User already has this subscription plan' };
        }

        return { success: false, error: errorMessage || 'Failed to create checkout session' };
      }
    },

    cleanHtml(html, url) {
      try {
            if (!html) return ''

            // `<script>` first and by tag, not by content: hydration payloads
            // (`<script type="application/json">{"props":…}`) are what leaked
            // into readers as walls of JSON. `<noscript>`/`<template>` hide the
            // same kind of junk, and nav/header/footer are page furniture that
            // has no business inside an article body.
            let cleanHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
                .replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, '')
                .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
                .replace(/<(nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
                .replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, '')
                .replace(/style=["'].*?["']/gi, '')
                .replace(/class=["'].*?["']/gi, '')
                .replace(/<link[^>]*>/gi, '')
                .replace(/<meta[^>]*>/gi, '')
                .replace(/\s+class=["'][^"']*["']/gi, '')
                .replace(/<title\b[^<]*(?:(?!<\/title>)<[^<]*)*<\/title>/gi, '')
                .replace(/<p>\s*<\/p>/gi, '') // Remove empty p tags
                .replace(/<a\s*>\s*<\/a>/gi, '') // Remove empty a tags
                .replace(/href=["'](?!http)(.*?)["']/gi, `href="${url}$1"`)
                .replace(/<img[^>]*data-lazy-src=["']([^"']+)["'][^>]*>/gi, (match, lazySrc) => {
                    return match.replace(/src=["'][^"']*["']/, `src="${lazySrc}"`);
                });

            // Bookmarks saved before the extractor was fixed have hydration
            // payloads baked into their stored text, where no tag-stripping can
            // reach them. Drop the blobs so those rows read correctly too,
            // without waiting on a re-extraction.
            //
            // Only for those legacy bodies: they are flat text with no block
            // markup. A properly extracted article is left alone, so a JSON
            // sample inside a <code> block survives as written.
            const hasBlockMarkup = /<(p|h[1-6]|li|blockquote|pre|article)\b/i.test(cleanHtml)
            if (!hasBlockMarkup) {
                cleanHtml = cleanHtml.replace(/\{\s*["'][^"']{1,80}["']\s*:[\s\S]{0,20000}?\}(?=\s|<|$)/g, ' ')
            }

            return expandImageMarkers(cleanHtml)
        } catch (error) {
            log("error cleaning html: ", error);
            return html
        }
    },

    getBadgeColor(status, type){
      switch (status.value) {
        case 'done':
          if (type === 'text') return 'text-green-600 dark:text-green-400 ';
          if (type === 'border') return 'border-green-100 dark:border-green-500 ';
          return 'bg-green-50 dark:bg-green-400/10 ';
        case 'in-progress':
          if (type === 'text') return 'text-cyan-600 dark:text-cyan-400 ';
          if (type === 'border') return 'border-cyan-100 dark:border-cyan-500 ';
          return 'bg-cyan-50 dark:bg-cyan-400/10 ';
        case 'backlog':
          if (type === 'text') return 'text-yellow-600 dark:text-yellow-400 ';
          if (type === 'border') return 'border-yellow-100 dark:border-yellow-500 ';
          return 'bg-yellow-50 dark:bg-yellow-400/10 ';
        case 'pending':
          if (type === 'text') return 'text-neutral-600 dark:text-neutral-200 ';
          if (type === 'border') return 'border-neutral-100 dark:border-neutral-300 ';
          return 'bg-neutral-50 dark:bg-neutral-400/10 ';
        case 'closed':
          if (type === 'text') return 'text-red-600 dark:text-red-400 ';
          if (type === 'border') return 'border-red-100 dark:border-red-500 ';
          return 'bg-red-50 dark:bg-red-400/10 ';
        default:
          if (type === 'text') return 'text-gray-600 dark:text-gray-400 ';
          if (type === 'border') return 'border-gray-100 dark:border-gray-500 ';
          return 'bg-gray-50 dark:bg-gray-400/10 ';
      }
    }

    // getTweet(){
    //   try {
    //       // let tweet = props.website.noEmbedCode;
    //       let tweet = this.webToShow.value.noEmbedCode;
    //       tweet = tweet.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    //       tweet = tweet.replace(/T\d+:\d+:\d+\.\d+Z"/g, '"');
    //       tweet = tweet.replace('twitter-tweet', 'tweet');
    //       return tweet;
    //   } catch (error) {
    //       return '';
    //   }
    // },
  },
})
