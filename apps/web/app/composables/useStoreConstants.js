import { useNuxtApp } from '#app';

// Plain constants that don't need $i18n - safe to use in store state initializers
export const feedbackStatusOptions = [
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Backlog', value: 'backlog' },
  { label: 'Pending Triage', value: 'pending' },
  { label: 'Done', value: 'done' },
  { label: 'Closed', value: 'closed' },
];

export const feedbackTypeOptions = [
  { label: "Bug report", value: "bug-report", icon: "octicon:bug-16" },
  { label: "Feature request", value: "feature-request", icon: "octicon:rocket-16" },
  { label: "Improvement", value: "improvement", icon: "octicon:pivot-column-16" },
  { label: "Other", value: "other", icon: "octicon:megaphone-16" },
];

export const feedbackPlatformOptions = [
  { label: 'App', value: 'app' },
  { label: 'Web', value: 'web' },
  { label: 'Browser extension', value: 'extension' },
];

export const filterOptions = [
  { type: 'tag', icon: 'tags' },
  { type: 'url', icon: 'link' },
  { type: 'title', icon: 'text1' },
  { type: 'description', icon: 'text2' },
  { type: 'type', icon: 'dashboard' },
  { type: 'body', icon: 'WebsiteWithText' },
  { type: 'color', icon: 'contrast' },
];

export const defaultUserOptions = {
  screenshotAsThumbnail: false,
  displayMode: 'grid',
  imageRatio: 'original',
  previewTags: true,
  summaryCardOnHover: false,
  orderBy: 'newFirst',
  language: 'en-GB',
  // Language the AI writes summaries and tags in. 'same' means whatever the
  // saved content is written in; anything else is one of the app's locales.
  aiLanguage: 'en-GB',
  // OpenAI TTS voice that reads articles aloud; one of `audioVoices`.
  aiVoice: 'nova',
  // English accent the voice reads with; one of `audioAccents`. Only affects
  // English text, other languages are read as written.
  aiAccent: 'american',
};

/** Mirrors `AUDIO_ACCENTS` in the backend; samples live in /public/audio/accents. */
export const audioAccents = [
  { id: 'american', label: 'American' },
  { id: 'british', label: 'British' },
  { id: 'australian', label: 'Australian' },
  { id: 'irish', label: 'Irish' },
  { id: 'indian', label: 'Indian' },
  { id: 'scottish', label: 'Scottish' },
];

/** Mirrors `AUDIO_VOICES` in the backend; samples live in /public/audio/voices. */
export const audioVoices = [
  { id: 'nova', description: 'Warm and natural' },
  { id: 'alloy', description: 'Neutral and balanced' },
  { id: 'ash', description: 'Confident and clear' },
  { id: 'ballad', description: 'Soft and expressive' },
  { id: 'coral', description: 'Bright and friendly' },
  { id: 'echo', description: 'Steady and low' },
  { id: 'fable', description: 'Gentle storyteller' },
  { id: 'onyx', description: 'Deep and authoritative' },
  { id: 'sage', description: 'Calm and measured' },
  { id: 'shimmer', description: 'Light and upbeat' },
  { id: 'verse', description: 'Lively and dynamic' },
  { id: 'marin', description: 'Clear and conversational' },
  { id: 'cedar', description: 'Rich and grounded' },
];

export const readerOptions = {
  fontSize: 16,
  lineHeight: 1.5,
  theme: 'light',
  showImages: false,
  isSerif: false,
};

/**
 * Plans deliberately do not live here.
 *
 * The catalogue — prices, limits and feature bullets — comes from the backend's
 * `GET /v1/plans` (via `store.fetchPlans()`), which reads the `plans` class the
 * server also resolves entitlements from. The copy that used to sit here had
 * drifted: it priced Ultra's bookmark limit at 10,000 against the row's
 * 100,000, and its `planName` keys ('plus', 'ultra') are tiers, not the plan
 * ids the two cadences are sold under.
 */

export const useStoreConstants = () => {
  const { $i18n } = useNuxtApp();

  const bookmarkTypes = [
    { label: $i18n.t('bookmarks.types.website'), value: 'website', icon: 'link', filterType: 'mainType' },
    { label: $i18n.t('bookmarks.types.articles'), value: 'article', icon: 'news', filterType: 'subType' },
    { label: $i18n.t('bookmarks.types.textNote'), value: 'textNote', icon: 'pencil', filterType: 'mainType' },
    { label: $i18n.t('bookmarks.types.drawing'), value: 'drawing', icon: 'brush', filterType: 'mainType' },
    { label: $i18n.t('bookmarks.types.image'), value: 'image', icon: 'photo', filterType: 'mainType' },
    { label: $i18n.t('bookmarks.types.pdf'), value: 'pdf', icon: 'file-text', filterType: 'mainType' },
    { label: $i18n.t('bookmarks.types.audio'), value: 'audio', icon: 'microphone', filterType: 'mainType' },
    { label: $i18n.t('bookmarks.types.music'), value: 'music', icon: 'music', filterType: 'mainType' },
    { label: $i18n.t('bookmarks.types.movie'), value: 'movie', icon: 'movie', filterType: 'mainType' },
    { label: $i18n.t('bookmarks.types.game'), value: 'game', icon: 'games', filterType: 'mainType' },
  ];

  const typeOptions = [
    { label: $i18n.t('bookmarks.types.website'), value: 'website', icon: 'i-heroicons-link' },
    { label: $i18n.t('bookmarks.types.textNote'), value: 'textNote', icon: 'i-heroicons-pencil' },
    { label: $i18n.t('bookmarks.types.drawing'), value: 'drawing', icon: 'i-heroicons-paint-brush' },
    { label: $i18n.t('bookmarks.types.image'), value: 'image', icon: 'i-heroicons-photo' },
    { label: $i18n.t('bookmarks.types.pdf'), value: 'pdf', icon: 'i-heroicons-document-text' },
    { label: $i18n.t('bookmarks.types.audio'), value: 'audio', icon: 'i-heroicons-microphone' },
    { label: $i18n.t('bookmarks.types.movie'), value: 'movie', icon: 'i-heroicons-film' },
    { label: $i18n.t('bookmarks.types.game'), value: 'game', icon: 'i-tabler-device-gamepad' },
  ];

  const viewingOptions = [
    { id: 'Grid', label: $i18n.t('settings.grid_view') },
    { id: 'Compact', label: $i18n.t('settings.compact_view') },
    { id: 'List', label: $i18n.t('settings.list_view') },
  ];

  const imageRatioOptions = [
    { id: 'original', label: $i18n.t('settings.image_ratio.original') },
    { id: '4-3', label: '4/3' },
    { id: '16-9', label: '16/9' },
  ];

  return {
    feedbackStatusOptions,
    feedbackTypeOptions,
    feedbackPlatformOptions,
    bookmarkTypes,
    typeOptions,
    filterOptions,
    viewingOptions,
    imageRatioOptions,
    defaultUserOptions,
    readerOptions
  };
};