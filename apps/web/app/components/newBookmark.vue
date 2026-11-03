<template>
    <!-- Hidden TipTap preloader - mounted on hover to trigger lazy loading -->
    <div v-if="startLoadingTipTap" class="hidden absolute pointer-events-none z-[-999]">
        <LazyTiptap />
    </div>

    <!-- ===================================================================
         New Bookmark (Popover)
         One step: the composer, with the type selector under it. Picking a
         type first was a gate in front of the thing everyone came to do —
         paste a link — so the type is a control on the composer now, not a
         question asked before it opens.
    ==================================================================== -->
    <div
        v-if="!isInline && !isQuickSave"
        ref="triggerWrapperEl"
        :class="popoverTriggerWrapperClass"
    >
        <UPopover
            v-model:open="desktopModal"
            :ui="{ content: popoverContentClass }"
        >
            <!-- Trigger button (header / mobile / default) -->
            <!-- `nb-trigger--docked`: on a phone the header trigger is the "+"
                 in the bottom bar, which is green and thumb-sized. It is a
                 class rather than a `color`/`size` prop so the button renders
                 identically on the server and on first paint, before the
                 client has measured the viewport. -->
            <UButton
                :color="isMobile && !isOnHeader ? 'green' : 'neutral'"
                :size="isMobile && !isOnHeader ? 'xl' : 'md'"
                :class="[
                    'new-bookmark-button nb-trigger',
                    isOnHeader ? 'nb-trigger--docked' : '',
                    isMobile && !isOnHeader ? 'shadow-lg' : ''
                ]"
                icon="i-heroicons-plus"
                square
            />

            <template #content>
                <!-- Two floating surfaces rather than one panel: the composer,
                     and the type selector riding under it. -->
                <div class="nb-sheet" :ref="onSheet">
                    <!-- The card is given the height its contents measure, so
                         switching type or growing a preview is a movement
                         rather than a jump. See `measureCard`. -->
                    <div class="nb-card" :style="cardStyle" ref="composeSurfaceEl">
                        <div :ref="measureCard" class="nb-card-inner">
                            <div class="nb-card-body" :class="'nb-card-body--' + selectedType">
                                <BookmarkEditor v-bind="editorBindings" />
                            </div>

                            <!-- The note written with the pencil pill below. Only a
                                 collected bookmark takes one: for a note, the
                                 text above is already the note. -->
                            <textarea
                                v-if="notesOpen && canAddNotes"
                                ref="notesEl"
                                v-model="pickedNotes"
                                class="nb-notes"
                                rows="2"
                                maxlength="5000"
                                :placeholder="$t('bookmarks.compose.notes_placeholder')"
                                :aria-label="$t('bookmarks.compose.notes')"
                            />

                            <!-- The tags picked with the "#" pill below, removable
                                 here. Tags typed into a note as #words are the
                                 note's own and are not repeated. -->
                            <div v-if="pickedTags.length" class="nb-tag-chips">
                                <button
                                    v-for="tag in pickedTags"
                                    :key="tag"
                                    type="button"
                                    class="nb-tag-chip"
                                    :aria-label="$t('bookmarks.compose.remove_tag', { tag })"
                                    @click="pickedTags = pickedTags.filter(t => t !== tag)"
                                >
                                    <span>#{{ tag }}</span>
                                    <UIcon name="i-heroicons-x-mark-20-solid" class="size-3.5 opacity-60" />
                                </button>
                            </div>

                            <div class="nb-card-actions">
                                <!-- Tags and the board it lands on, on the same row
                                     as Save for every kind of bookmark — the native
                                     composer's two buttons. -->
                                <div class="nb-card-meta">
                                    <ComposeTagPicker v-model="pickedTags" />
                                    <ComposeBoardPicker v-model="selectedBoard" />
                                    <button
                                        v-if="canAddNotes"
                                        type="button"
                                        class="nb-pill"
                                        :class="{ 'nb-pill--on': !!pickedNotes.trim(), 'nb-pill--square': !pickedNotes.trim() }"
                                        :aria-pressed="notesOpen"
                                        :aria-label="$t('bookmarks.compose.notes')"
                                        :title="$t('bookmarks.compose.notes')"
                                        @click="toggleNotes"
                                    >
                                        <UIcon :name="pickedNotes.trim() ? 'i-heroicons-pencil-square-solid' : 'i-heroicons-pencil-square'" class="size-4 shrink-0" />
                                        <span v-if="pickedNotes.trim()">{{ $t('bookmarks.compose.notes') }}</span>
                                    </button>
                                </div>

                                <!-- Notes and drawings are the two kinds that are
                                     written rather than collected, and a 560px
                                     popover is a cramped place to write. Expanding
                                     saves first — the bookmark exists before the
                                     sheet opens, so every later keystroke is an
                                     edit — then the card grows into a full-screen
                                     editor. -->
                                <UButton
                                    v-if="canExpandFromComposer"
                                    :disabled="submitSiteDisabled || loadingSave"
                                    :loading="loadingExpand"
                                    variant="ghost"
                                    color="neutral"
                                    size="lg"
                                    square
                                    icon="i-heroicons-arrows-pointing-out"
                                    class="nb-expand-trigger"
                                    :aria-label="$t('bookmarks.expand_to_edit')"
                                    :title="$t('bookmarks.expand_to_edit')"
                                    @click="expandToFullscreen"
                                />
                                <!-- While a voice note is recording this is Stop:
                                     the first press ends the take and the button
                                     comes back as Save, so a note is never
                                     uploaded before its owner has heard it. -->
                                <UButton
                                    :disabled="submitSiteDisabled"
                                    :loading="loadingSave"
                                    :color="submitSiteDisabled ? 'neutral' : 'primary'"
                                    :variant="submitSiteDisabled ? 'soft' : 'solid'"
                                    size="lg"
                                    :trailing-icon="isStoppingTake ? 'i-heroicons-stop-20-solid' : 'i-heroicons-arrow-right-20-solid'"
                                    class="nb-save rounded-full px-5 font-semibold"
                                    @click="submitSite({ confetti: false, event: $event, quickSave: false })"
                                >
                                    {{ isStoppingTake ? $t('bookmarks.compose.stop') : $t('common.save') }}
                                </UButton>
                            </div>
                        </div>
                    </div>

                    <!-- The selector scrolls rather than wrapping: it is one
                         row of choices, and a second row would push the
                         composer off a phone screen. -->
                    <div class="nb-types" role="tablist" :aria-label="$t('bookmarks.what_to_save')">
                        <button
                            v-for="option in typeChoices"
                            :key="option.value"
                            type="button"
                            role="tab"
                            :aria-selected="selectedType === option.value"
                            class="nb-type"
                            :class="{ 'nb-type--active': selectedType === option.value }"
                            @click="setType(option.value)"
                        >
                            <UIcon :name="option.icon" class="w-[17px] h-[17px] shrink-0" />
                            <span>{{ option.label }}</span>
                        </button>
                    </div>
                </div>
            </template>
        </UPopover>
    </div>

    <!-- ===================================================================
         Quick save
    ==================================================================== -->
    <Transition name="slide-left">
        <div
            v-if="isQuickSave && clipboardIsUrl"
            :class="{
                'quick-save-wrapper': true,
                'move-up': sitesSelected.length > 0
            }"
        >
            <UButton
                @click="submitSite({
                    confetti: true,
                    event: $event,
                    quickSave: true
                })"
                color="green"
                size="lg"
                class="rounded-full"
            >
                <span>{{ $t('common.shortcuts.quick_save.name') }}</span>
            </UButton>
        </div>
    </Transition>

    <!-- ===================================================================
         Inline mode (wizard / onboarding) - always shows the editor
    ==================================================================== -->
    <div v-if="isInline && !isQuickSave">
        <form :class="`new-bookmark-wrapper ${typeOfNewBookmark} is-inline`">
            <div class="new-bookmark-content" ref="composeSurfaceEl">
                <div class="type-selector-wrapper">
                    <UBadge
                        v-for="option in typeChoices"
                        :key="option.value"
                        @click="setType(option.value)"
                        :variant="typeOfNewBookmark == option.value ? 'clickableSelected' : 'clickable'"
                    >
                        <UIcon :name="option.icon" class="w-4 h-4 mr-1" />
                        {{ option.label }}
                    </UBadge>
                </div>

                <BookmarkEditor v-bind="editorBindings" :is-inline="true" />
            </div>

            <!-- Buttons -->
            <div class="modal-footer !mt-5">
                <div class="flex gap-4 w-full justify-center">
                    <UButton
                        v-if="canExpandFromComposer"
                        :disabled="submitSiteDisabled || loadingSave"
                        :loading="loadingExpand"
                        variant="ghost"
                        color="neutral"
                        size="lg"
                        icon="i-heroicons-arrows-pointing-out"
                        class="nb-expand-trigger"
                        :aria-label="$t('bookmarks.expand_to_edit')"
                        :title="$t('bookmarks.expand_to_edit')"
                        @click="expandToFullscreen"
                    />
                    <UButton
                        :disabled="submitSiteDisabled"
                        @click="submitSite({ confetti: false, event: $event, quickSave: false })"
                        :loading="loadingSave"
                        size="lg"
                        color="neutral"
                        variant="solid"
                    >
                        <template v-if="isStoppingTake">{{ $t('bookmarks.compose.stop') }}</template>
                        <template v-else>{{ inlineSaveLabel }}</template>
                    </UButton>
                </div>
            </div>
        </form>
    </div>

    <!-- ===================================================================
         Full-screen note / drawing editor
         Mounted outside the popover so it survives the composer tearing
         down. Driven by `expandPayload`; see ComposeExpandModal.
    ==================================================================== -->
    <ComposeExpandModal
        :payload="expandPayload"
        @close="expandPayload = null"
    />
</template>

<script setup>
  import { ref, shallowRef, nextTick, onMounted, onBeforeUnmount, watch, computed, provide } from 'vue'
  import { storeToRefs } from 'pinia'
  import { useStore } from '~/stores/myStore';
  import party from "party-js";
  import Parse from 'parse';
  import { useI18n } from 'vue-i18n';
  import { splitByKind, unsupportedFileMessage } from '~/composables/useFileKinds';
  const { t } = useI18n();

  const {
      placeholderValue,
      isOnHeader,
      isQuickSave,
      isInline,
      value,
  } = defineProps({
      placeholderValue: {
          type: String,
          default: ''
      },
      isOnHeader: {
        type: Boolean,
        default: false
      },
      isQuickSave: {
          type: Boolean,
          default: false
      },
      isInline: {
          type: Boolean,
          default: false
      },
      value: {
          type: String,
          default: ''
      },
  });

  const store = useStore();

  const {
      handleParseError,
      uploadFilesToParse,
      createDebounce,
      showAlert,
      validateUrl,
      saveBookmark,
      saveTextNote,
      saveDrawing,
      removeHtml,
      canSaveNewBookmark,
      fetchWebsitePreview,
      saveUpdatedSite
  } = useStore();

  const {
      filesToUpload,
      fileUrl,
      textNote,
      sitesSelected,
      newUrlValue,
      clipboardIsUrl,
      isFirstTime,
      activeElement,
      pasteBoard,
      typeOfNewBookmark,
      isMobile,
      startLoadingTipTap
  } = storeToRefs(store);

  const previousUrl = ref('');
  const newWebsiteData = ref(null);
  const debounce = createDebounce();
  // `desktopModal` now controls the popover open state (kept the name so all
  // existing save/close logic that toggles it continues to work unchanged).
  const desktopModal = ref(false);
  const sitePreview = ref(null);
  const cleanedNoteText = ref('');
  const tags = ref([]);
  const forceType = ref(false);
  const mediaBookmark = ref(null);
  const loadingMedia = ref(false);
  const showMediaDropdown = ref(false);
  const searchResultsMovies = ref([]);
  const searchResultsGames = ref([]);
  const gameToken = ref(null);
  const loadingSave = ref(false);

  // A voice note that is still recording or paused has no file yet. The
  // recorder registers a way to finish it here, so Save can end the take and
  // upload it in one press. See `finishTake` in AudioRecorder.
  const composeAudioTake = shallowRef(null);
  provide('composeAudioTake', composeAudioTake);

  /** Save reads as Stop while a voice note is still being recorded. */
  const isStoppingTake = computed(() => typeOfNewBookmark.value === 'audio' && !!composeAudioTake.value);

  /** "Save note", "Save image"… on the inline composer's button. */
  const SAVE_LABEL_TYPES = ['website', 'textNote', 'image', 'pdf', 'movie', 'game', 'drawing', 'audio'];
  const inlineSaveLabel = computed(() =>
      SAVE_LABEL_TYPES.includes(typeOfNewBookmark.value)
          ? t(`new_bookmark.save_as.${typeOfNewBookmark.value}`)
          : t('common.save')
  );

  // Picked with the "#" pill and the board button on the actions row. Kept
  // apart from `tags`, which is rebuilt from the #words in a note's text on
  // every keystroke and would drop these each time; the two meet at save.
  const pickedTags = ref([]);
  const selectedBoard = ref(null);
  // The note that rides with a link, movie or game: `siteNotes` on the saved row.
  const pickedNotes = ref('');
  const notesOpen = ref(false);
  const notesEl = ref(null);
  const toggleNotes = async () => {
      notesOpen.value = !notesOpen.value;
      if (notesOpen.value) {
          await nextTick();
          notesEl.value?.focus();
      }
  };

  // A drawing is composed in place rather than typed: the board publishes a dehydrated
  // snapshot as the user draws, and `drawingCanvas` is the live component so submit can
  // ask it for a final flush plus a freshly exported thumbnail.
  const drawingSnapshot = ref(null);
  const drawingCanvas = ref(null);

  // ── Expand to full-screen editor ───────────────────────────────────────────
  // The card is a cramped place to write. `expandPayload` hands a just-saved
  // note or drawing to <ComposeExpandModal> along with the card's rect, so the
  // sheet can grow out of it.
  const composeSurfaceEl = ref(null);
  const expandPayload = ref(null);
  const loadingExpand = ref(false);

  // Names of what was picked, so the panel can say what it is about to save.
  // A picture previews as itself; a PDF has no cover until the server renders
  // one, so its filename is the only thing there is to show.
  const pickedFileNames = ref([]);

  // The store's own `typeOptions` carries hard-coded English labels ("Text
  // Note"); the constants list is the same six choices, translated.
  const { typeOptions: typeChoices } = useStoreConstants();

  // ── Card height ────────────────────────────────────────────────────────────

  /**
   * The card is drawn at the height its contents measure.
   *
   * A popover that jumps from a one-line field to a board, or to a list of
   * search results, reads as a different popover each time. `height: auto`
   * cannot be transitioned, so the contents are measured and the height is
   * written back — the one shape CSS can animate.
   */
  const cardHeight = ref(null);
  /** The first measurement lands instantly; only later ones are animated. */
  const cardSettled = ref(false);
  let cardObserver = null;

  const cardStyle = computed(() =>
      cardHeight.value === null
          ? {}
          : { height: `${cardHeight.value}px`, transition: cardSettled.value ? undefined : 'none' }
  );

  /**
   * Function ref rather than `onMounted`: the popover's content is built and
   * torn down as it opens and closes, so the element arrives (and leaves,
   * as `null`) many times over the component's life.
   */
  const measureCard = (el) => {
      cardObserver?.disconnect();
      cardObserver = null;

      if (!el) {
          cardHeight.value = null;
          cardSettled.value = false;
          return;
      }
      if (typeof ResizeObserver === 'undefined') return;

      cardObserver = new ResizeObserver(([entry]) => {
          // Border box, not `contentRect`: the inner carries the card's padding,
          // and measuring the content box left the card an inch short — enough
          // to cut the Save button off against `overflow: hidden`.
          const next = Math.round(
              entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
          );
          if (next <= 0 || next === cardHeight.value) return;
          cardHeight.value = next;
          // A frame later, so the height that arrives with the card is not
          // animated in from nothing.
          if (!cardSettled.value) requestAnimationFrame(() => { cardSettled.value = true; });
      });
      cardObserver.observe(el);
  };

  onBeforeUnmount(() => {
      cardObserver?.disconnect();
      cardObserver = null;
  });

  // ── Morph from the "+" ─────────────────────────────────────────────────────

  /**
   * The composer grows out of the button that opened it and shrinks back into
   * it when it closes.
   *
   * Each surface — the card and the type selector — is animated on its own,
   * never through the popover around them. An ancestor animating its opacity
   * becomes the "backdrop root" for everything inside it, and a glass surface
   * can then only blur what is inside that ancestor, which is nothing: the
   * material went flat for the length of Nuxt UI's scale-in. A surface's own
   * transform and opacity leave its backdrop alone.
   *
   * The surfaces start as the button — its centre, its size, its round shape
   * and its fill — and settle into their own. Their contents fade in behind
   * the growth, so the text is never seen squeezed.
   */
  const triggerWrapperEl = ref(null);
  const sheetEl = ref(null);
  let sheetAnimations = [];
  /** Set when the card hands over to the full-screen editor rather than closing. */
  let skipMorphOut = false;

  const MORPH_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const MORPH_IN_MS = 440;
  // `nb-compose-hold` keeps the popover mounted while this runs; it has to be
  // the longer of the two.
  const MORPH_OUT_MS = 280;

  const prefersReducedMotion = () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const cancelSheetAnimations = () => {
      sheetAnimations.forEach(animation => animation.cancel());
      sheetAnimations = [];
  };

  const surfacesOf = (sheet) =>
      Array.from(sheet.children).filter(el => el.matches('.nb-card, .nb-types'));

  /** The button's rect and fill, or null when there is no button on screen to grow from. */
  const triggerShape = () => {
      const button = triggerWrapperEl.value?.querySelector('.nb-trigger');
      const rect = button?.getBoundingClientRect();
      if (!rect?.width || !rect?.height) return null;
      return { rect, background: getComputedStyle(button).backgroundColor };
  };

  /**
   * Keyframes from the button's shape to the surface's own, by offset.
   * Measured with nothing applied, so any running animation is cancelled first.
   */
  const morphFrames = (surface, trigger) => {
      const own = surface.getBoundingClientRect();
      const style = getComputedStyle(surface);
      const { rect } = trigger;
      const dx = (rect.left + rect.width / 2) - (own.left + own.width / 2);
      const dy = (rect.top + rect.height / 2) - (own.top + own.height / 2);

      return [
          {
              offset: 0,
              transform: `translate(${dx}px, ${dy}px) scale(${rect.width / own.width}, ${rect.height / own.height})`,
              // Half its own size each way: an ellipse the scale above squashes
              // into the button's circle.
              borderRadius: `${own.width / 2}px / ${own.height / 2}px`,
              backgroundColor: trigger.background,
              opacity: 0,
          },
          { offset: 0.18, opacity: 1 },
          {
              offset: 1,
              transform: 'none',
              borderRadius: style.borderRadius,
              backgroundColor: style.backgroundColor,
              opacity: 1,
          },
      ];
  };

  const reversed = (frames) =>
      frames.slice().reverse().map(frame => ({ ...frame, offset: 1 - frame.offset }));

  const morphIn = (sheet, { placed = true } = {}) => {
      cancelSheetAnimations();
      const trigger = !placed || prefersReducedMotion() ? null : triggerShape();
      const surfaces = surfacesOf(sheet);
      // Measured before this comes off, and animated in the same frame it does,
      // so the first frame painted is the button-sized one.
      delete sheet.dataset.morph;
      sheet.style.pointerEvents = '';

      for (const surface of surfaces) {
          if (!trigger) {
              sheetAnimations.push(surface.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' }));
              continue;
          }
          sheetAnimations.push(surface.animate(morphFrames(surface, trigger), { duration: MORPH_IN_MS, easing: MORPH_EASE }));
          for (const child of surface.children) {
              sheetAnimations.push(child.animate([{ opacity: 0 }, { opacity: 1 }], {
                  duration: 240, delay: 120, easing: 'ease-out', fill: 'backwards',
              }));
          }
      }
  };

  const morphOut = () => {
      const sheet = sheetEl.value;
      if (!sheet) return;
      cancelSheetAnimations();
      const trigger = skipMorphOut || prefersReducedMotion() ? null : triggerShape();
      skipMorphOut = false;
      // Shrinking back, the surfaces pass over the "+" itself; a tap there to
      // open it again has to reach the button, not the leaving card.
      sheet.style.pointerEvents = 'none';

      for (const surface of surfacesOf(sheet)) {
          if (!trigger) {
              sheetAnimations.push(surface.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'forwards' }));
              continue;
          }
          sheetAnimations.push(surface.animate(reversed(morphFrames(surface, trigger)), {
              duration: MORPH_OUT_MS, easing: MORPH_EASE, fill: 'forwards',
          }));
          for (const child of surface.children) {
              sheetAnimations.push(child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, easing: 'ease-in', fill: 'forwards' }));
          }
      }
  };

  /**
   * Resolves once Reka has placed the popover — true, or false if it never
   * seemed to. Until then its wrapper is parked off screen at
   * `translate(0, -200%)`, and a rect measured there would grow the card from
   * somewhere above the page, so an unplaced popover fades in instead.
   */
  const whenPlaced = (el) => new Promise((resolve) => {
      let frames = 30;
      const check = () => {
          // The ref arrives before the teleported contents are inside the
          // wrapper, so no wrapper yet means "not placed", not "no popover".
          const wrapper = el.isConnected && el.closest('[data-reka-popper-content-wrapper]');
          const placed = wrapper && wrapper.style.transform && !wrapper.style.transform.includes('-200%');
          if (placed || --frames <= 0) return resolve(!!placed);
          requestAnimationFrame(check);
      };
      check();
  });

  /**
   * Function ref for the popover's contents, which are built each time it
   * opens. Hidden on arrival so nothing full-sized is painted before the morph
   * has somewhere to start from.
   */
  const onSheet = (el) => {
      if (el === sheetEl.value) return;
      if (!el) {
          sheetAnimations = [];
          sheetEl.value = null;
          return;
      }
      sheetEl.value = el;
      el.dataset.morph = 'pending';
      whenPlaced(el).then((placed) => {
          if (sheetEl.value === el && desktopModal.value) morphIn(el, { placed });
      });
  };

  // Closing runs before the popover re-renders as closed, while the surfaces
  // are still where they were. Reopening mid-close finds the same sheet still
  // mounted, so it has to be grown again from here rather than from `onSheet`.
  watch(desktopModal, (open) => {
      if (!open) morphOut();
      else if (sheetEl.value) morphIn(sheetEl.value);
  });

  /**
   * Which chip reads as selected.
   *
   * `empty` is the composer's resting state, not a seventh kind of bookmark —
   * it is what the type falls back to whenever the editor is cleared. Leaving
   * every chip dark in that moment made the selector look broken, so the
   * resting state shows as the one it will resolve to the moment a link lands.
   */
  const selectedType = computed(() =>
      typeOfNewBookmark.value === 'empty' ? 'website' : typeOfNewBookmark.value
  );

  /** A note is what a collected bookmark has; the others are the writing themselves. */
  const canAddNotes = computed(() => ['website', 'movie', 'game'].includes(selectedType.value));

  // The popover is sized for a text field; a drawing board needs elbow room, so the
  // drawing step widens it. Anything larger belongs in the detail modal, which opens
  // the same board full size.
  const popoverContentClass = computed(() => {
      // Wide enough that the six type chips sit on one unscrolled row on a
      // laptop; a phone caps it at the viewport and the row scrolls instead.
      const width = typeOfNewBookmark.value === 'drawing'
          ? 'w-[min(720px,calc(100vw-1.5rem))]'
          : 'w-[min(560px,calc(100vw-1.5rem))]';

      // `.nb-popover` strips Nuxt UI's own panel so the composer and the type
      // selector can be two separate surfaces with air between them; each
      // carries its own material. It outranks the defaults by doubling its
      // selector rather than with `!important` — the `!`-prefixed resets that
      // used to live here made those declarations important, so
      // `!bg-transparent` beat the panel background and left the page showing
      // straight through the menu, and `!ring-0` wiped out its shadow.
      // No scale-in on the popover itself: the surfaces morph out of the "+"
      // on their own (see `morphIn`). The closed-state animation does nothing
      // visible — it is what keeps Reka from unmounting the popover before
      // they have shrunk back into it.
      return `nb-popover z-[999] ${width} data-[state=open]:animate-none data-[state=closed]:animate-[nb-compose-hold_300ms_linear] origin-(--reka-popover-content-transform-origin) focus:outline-none pointer-events-auto transition-[width] duration-200`;
  });

  const popoverTriggerWrapperClass = computed(() => {
      // Mobile floating action button anchors to the bottom-right of the viewport.
      if (isMobile.value && !isOnHeader) {
          return 'dropdown-wrapper !fixed bottom-7 right-4 -translate-x-1/2 z-10';
      }
      // In the top bar the trigger shares a flex row with the search input,
      // which is allowed to shrink to whatever is left. The button is not:
      // squeezing it is what turned the "+" into an ellipse on a phone.
      return isOnHeader ? 'dropdown-wrapper shrink-0' : 'dropdown-wrapper';
  });

  // Bindings passed to the shared <BookmarkEditor> render component (defined below).
  const editorBindings = computed(() => ({
      typeOfNewBookmark: typeOfNewBookmark.value,
      startLoadingTipTap: startLoadingTipTap.value,
      showFloatingMenu: showFloatingMenu.value,
      desktopModal: desktopModal.value,
      newWebsiteData,
      sitePreview: sitePreview.value,
      newUrlValue: newUrlValue.value,
      mediaBookmark: mediaBookmark.value,
      fileUrl: fileUrl.value,
      filesToUpload: filesToUpload.value,
      pickedFileNames: pickedFileNames.value,
      isTextboxEmpty: isTextboxEmpty.value,
      showPlaceholder: showPlaceholder.value,
      cleanedNoteText: cleanedNoteText.value,
      loadingMedia: loadingMedia.value,
      showMediaDropdown: showMediaDropdown.value,
      searchResultsMovies: searchResultsMovies.value,
      searchResultsGames: searchResultsGames.value,
      onNotesUpdated: (e) => {
          autoDetectType();
          debounce(() => notesUpdated(e), typeOfNewBookmark.value == 'website' ? 100 : 500);
      },
      drawingSnapshot: drawingSnapshot.value,
      onDrawingUpdated: (snapshot) => { drawingSnapshot.value = snapshot; },
      // Function ref: Vue hands us the component on mount and null on unmount, so the
      // reference cannot outlive the board it points at.
      onDrawingReady: (component) => { drawingCanvas.value = component; },
      onPasteNewUrl: pasteNewUrl,
      onClearNotes: clearNotes,
      onSelectMedia: selectMedia,
      onChange,
      onClickEl: clickEl,
      validateUrl,
  }));

  onMounted(async () => {
    try {
      if(!process.client) return;
      if(!Parse.User.current()) return;

      if(placeholderValue && placeholderValue !== '') {
          newWebsiteData.value = placeholderValue;
          newUrlValue.value = placeholderValue;
          typeOfNewBookmark.value = checkTypeOfNewBookmark();
          notesUpdated();
      }

      checkPasteboard();
      window.onfocus = () => checkPasteboard();
    } catch (error) {
        console.error('[newBookmark] Error in mounted: ', error);
    }
  });

  watch(() => value, (val) => {
      newWebsiteData.value = val;
      typeOfNewBookmark.value = checkTypeOfNewBookmark();
      newUrlValue.value = val;
      notesUpdated();
  });

  watch(typeOfNewBookmark, async (newVal, oldVal) => {
      mediaBookmark.value = null;
      searchResultsGames.value = [];
      searchResultsMovies.value = [];
      clearFiles();

      pickedFileNames.value = [];

      // Switching away from the board discards it; the component is unmounted by then
      // and there is nothing left to commit.
      if (oldVal === 'drawing' && newVal !== 'drawing') drawingSnapshot.value = null;

      if(newVal == 'movie' || newVal == 'game') await notesUpdated();

      if(newVal != oldVal){
          sitePreview.value = null;
      }
  });

  // When the popover opens, prep TipTap + clipboard.
  watch(desktopModal, async (val) => {
      if (val) {
          startLoadingTipTap.value = true;

          // Nothing asks which kind of bookmark this is any more, so the
          // composer opens on one. A link is what most saves are, and prose
          // typed into it becomes a note on its own — `checkTypeOfNewBookmark`
          // moves the selection as you write. A draft left over from a popover
          // that was dismissed keeps whatever type it had.
          if (isTextboxEmpty.value && filesToUpload.value.length === 0 && !drawingSnapshot.value) {
              typeOfNewBookmark.value = 'website';
              forceType.value = false;
          }

          let pasteboardUrl = await checkPasteboard();

          if (!pasteboardUrl.isSame && pasteboardUrl.url != '') {
            // Clipboard already holds a link: fill the composer with it.
            newWebsiteData.value = '<a>'+pasteboardUrl.url+'</a>';
            previousUrl.value = pasteboardUrl.url;
            typeOfNewBookmark.value = 'website';
            if(!isFirstTime.value){
                showAlert({ message: t('new_bookmark.fetching_preview') });
            }
            sitePreview.value = await fetchWebsitePreview(pasteboardUrl.url);
          }

          focusEditor();
          document.addEventListener('keydown', handleKeydown);
      } else {
          document.removeEventListener('keydown', handleKeydown);
      }
  });

  const focusEditor = async () => {
      if (isMobile.value) return;
      await nextTick();
      const el = document.getElementById('newBookmarkEditor');
      if (el?.children[0]) el.children[0].focus();
  };

  const selectMedia = (mediaObject) => {
      showMediaDropdown.value = false;
      mediaBookmark.value = mediaObject;
      searchResultsMovies.value = [];
      searchResultsGames.value = [];
  };

  const handleKeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.keyCode == 13) { // ctrl/cmd + enter
          submitSite();
      }
  };

  /**
   * Keep the selector on the kind of thing that is actually in the field.
   *
   * Only ever moves between "website" and "note", and only until the reader
   * picks a type themselves — after that the choice is theirs and typing does
   * not overrule it, which is what `forceType` has always been named for and
   * never actually did.
   *
   * Detection used to be one-way: `checkTypeOfNewBookmark` turned a website
   * into a note the moment its field held something that was not yet a link,
   * and its return value — the half that turns a note back into a website —
   * was thrown away. Typing a URL out by hand rather than pasting it therefore
   * saved a note whose body happened to be a link. Nobody saw it while the
   * type was chosen up front and the selector was not on screen.
   */
  const autoDetectType = () => {
      if (forceType.value) return;
      const current = typeOfNewBookmark.value;
      if (current !== 'empty' && current !== 'website' && current !== 'textNote') return;
      typeOfNewBookmark.value = checkTypeOfNewBookmark();
  };

  const setType = async (type) => {
      try {
          await nextTick();

          // Picking a type by hand pins it, "Website" included: what you type
          // is no longer allowed to move the selection out from under you.
          forceType.value = true;

          mediaBookmark.value = null;
          searchResultsGames.value = [];
          searchResultsMovies.value = [];
          sitePreview.value = null;

          typeOfNewBookmark.value = type;

          if(type === 'website') {
              const url = getCurrentSiteUrl.value;
              if(url) {
                  typeOfNewBookmark.value = 'website';
                  if(!isFirstTime.value){
                      showAlert({ message: t('new_bookmark.fetching_preview') });
                  }
                  sitePreview.value = await fetchWebsitePreview(url);
              }
          }

          if(type !== 'image' && type !== 'pdf' && type !== 'drawing' && type !== 'audio') {
              focusEditor();
          }

          // Audio is recorded here rather than picked, so this type opens the
          // recorder rather than a file dialog — the picker is a fallback
          // inside it. Any half-finished take from a previous visit goes now.
          if(type === 'audio') {
              filesToUpload.value = [];
              store.audioMeta = null;
          }

          if(type === 'image' || type === 'pdf') {
              try {
                  const existingInput = document.getElementById('inputNewFileMobile');
                  if (existingInput) {
                      existingInput.click();
                      return;
                  }

                  const input = document.createElement('input');
                  input.type = 'file';
                  input.id = 'inputNewFileMobile';
                  // Several pictures become one bookmark with a carousel;
                  // several PDFs become one bookmark each.
                  input.multiple = true;
                  input.accept = type === 'pdf' ? 'application/pdf,.pdf' : 'image/*';
                  input.style.display = 'none';
                  input.onchange = (event) => {
                      onChange(event);
                      document.body.removeChild(input);
                  };
                  document.body.appendChild(input);
                  input.click();
              } catch (err) {
                  console.error('Error handling file input:', err);
              }
          }
      } catch (error) {
          console.error('Error in setType:', error);
      }
  };

  const clearNotes = async () => {
      await nextTick();
      newWebsiteData.value = null;
      newUrlValue.value = '';
      typeOfNewBookmark.value = 'empty';
      sitePreview.value = null;
      forceType.value = false;
      tags.value = [];
      searchResultsMovies.value = [];
      mediaBookmark.value = null;
      drawingSnapshot.value = null;
      store.audioMeta = null;
  };

  const pasteNewUrl = () => {
      newWebsiteData.value = '<a>' + pasteBoard.value + '</a>';
      notesUpdated();
  };

  const showClipboardPermissionError = () => {
    try {
      let hasShownAlert = localStorage.getItem('hasShownAlert');
      if (!hasShownAlert) {
          showAlert({
              type: 'error',
              message: t('new_bookmark.clipboard_access'),
              permanent: true });
          localStorage.setItem('hasShownAlert', true);
      }
    } catch (error) {
      console.error('Error in showClipboardPermissionError:', error);
    }
  };

  async function checkPasteboard() {
      let url = '';
      let isSame = false;

      if (isMobile.value) {
          return { isSame, url };
      }

      try {
          url = await navigator.clipboard.readText();
      } catch (error) {
          if (navigator.permissions) {
              try {
                  const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
                  if (permissionStatus.state === 'granted' || permissionStatus.state === 'prompt') {
                  } else {
                      showClipboardPermissionError();
                      return { isSame, url };
                  }
              } catch (err) {
                  showClipboardPermissionError();
                  console.error('Error while asking for clipboard permission:', err);
                  return { isSame, url };
              }
          } else {
              console.log('Clipboard permissions API not available.');
          }
          return { isSame, url: '' };
      }

      if (validateUrl(url)) {
          if(sitePreview.value) isSame = sitePreview.value.url == url;
          else isSame = false;

          clipboardIsUrl.value = true;
          newUrlValue.value = url;
          pasteBoard.value = url;
      } else {
          url = '';
          isSame = false;
          clipboardIsUrl.value = false;
      }
      return { isSame, url };
  };

  const notesUpdated = async (note) => {
      newUrlValue.value = note ? note : newUrlValue.value;

      cleanedNoteText.value = newUrlValue.value.replace(/<\/?[^>]+(>|$)/g, '').trim();
      textNote.value = cleanedNoteText.value;

      if(typeOfNewBookmark.value == 'empty'){
          typeOfNewBookmark.value = checkTypeOfNewBookmark();
      }

      if (typeOfNewBookmark.value == 'movie') {
          try{
              showMediaDropdown.value = true;
              if(cleanedNoteText.value.length == 0){
                  searchResultsMovies.value = [];
              } else if(cleanedNoteText.value.length >= 2){
                  let movies = await searchMovie(cleanedNoteText.value);
                  searchResultsMovies.value = movies.movies.results;
              }
          } catch(error){
              console.log('error searching: ', error);
          }
      }

      if (typeOfNewBookmark.value == 'game') {
          try{
              showMediaDropdown.value = true;
              if(cleanedNoteText.value.length == 0){
                  searchResultsGames.value = [];
              } else if(cleanedNoteText.value.length >= 2){
                  let games = await searchGame(cleanedNoteText.value);
                  searchResultsGames.value = games;
              }
          } catch(error){
              console.log('error searching: ', error);
          }
      }

      if (typeOfNewBookmark.value == 'website') {
          let isUrlValid = validateUrl(previousUrl.value);
          if(isUrlValid) {
              if(!isFirstTime.value){
                  showAlert({ message: t('new_bookmark.fetching_preview') });
              }
              sitePreview.value = await fetchWebsitePreview(previousUrl.value);
          }
      }

      // extract all the #tags from the textNote
      const regex = /(?:^|[\s,>])#(\w+)/g;
      let matches = newUrlValue.value.match(regex);

      const tagsList = matches ? [...new Set(matches.map(tag => {
          tag = tag.trim();
          if (tag.startsWith(',')) {
              return tag.slice(1);
          } else if (tag.startsWith('>')) {
              return tag.slice(1);
          }
          return tag;
      }))] : [];

      let htmlString = newWebsiteData.value;
      tagsList.forEach(tag => {
          htmlString = htmlString.replaceAll('#'+tag, '<UBadge class="tag-badge" :color="\'#\' + tagColor(\''+tag+'\')">'+tag+'</UBadge>');
      });

      newWebsiteData.value = htmlString;
      tags.value = tagsList;
  };

  const checkTypeOfNewBookmark = () => {
      if (isTextboxEmpty.value) {
          return 'empty';
      } else {
          let htmlString = newWebsiteData.value;
          let htmlContent = htmlString.replace(/<[^>]*>/g, '');

          if(htmlContent.length == 0) return 'website';

          const pattern = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/g;
          const regex = new RegExp(pattern);
          let allUrls = htmlString.match(regex);
          allUrls = [...new Set(allUrls)];

          // Answers; does not decide. It used to assign the type here as well,
          // which walked straight past `forceType` and un-pinned a choice the
          // reader had just made by hand.
          if(allUrls.length == 0 && htmlContent.length > 0 && typeOfNewBookmark.value == 'website'){
              return 'textNote';
          }

          if (allUrls.length > 0 && htmlContent.length > 3 && allUrls.length == 1) {
              if (previousUrl.value != allUrls[0]) {
                  fetchWebsitePreview(allUrls[0]);
              }
              previousUrl.value = allUrls[0];
              return 'website';
          } else {
              return 'textNote';
          }
      }
  };

  function clearFiles() {
      fileUrl.value = '';
      filesToUpload.value = [];
      pickedFileNames.value = [];
  };

  async function clickEl(id) {
      document.getElementById(id).click();
  };

  async function onChange(event) {
      try {
          let files = event.target.files;
          const { images, pdfs, other } = splitByKind(files);

          if (images.length === 0 && pdfs.length === 0) {
              showAlert({ message: unsupportedFileMessage(other), type: 'danger' });
              return;
          }

          // The picked file decides, not the chip that opened the picker: a PDF
          // dragged onto the image picker is still a PDF, and switching here is
          // what makes the preview and the save agree with each other.
          forceType.value = true;
          typeOfNewBookmark.value = images.length > 0 ? 'image' : 'pdf';

          // The preview shows the cover, which is the first picture chosen. A
          // PDF has no cover until the server has rendered one, so the panel
          // names the file instead.
          fileUrl.value = images.length > 0 ? URL.createObjectURL(images[0]) : '';
          pickedFileNames.value = Array.from(files).map(file => file.name);
          filesToUpload.value = files;
      } catch (error) {
          console.log('error calling function: ', error);
      }
  };

  async function confetti(e) {
      party.confetti(e.target);
  };

  async function saveTextNoteToParse() {
      if (newWebsiteData.value == '') return null;

      forceType.value = false;

      showAlert({ message: t('new_bookmark.saving_note'), permanent: true, type: 'info', loader: true});

      try {
          desktopModal.value = false;

          const saved = await saveTextNote({ textNote: newWebsiteData.value, tags: tagsForSave() });
          // saveTextNote has already said what went wrong.
          if (saved === 'Error') return null;
          textNote.value = '';
          newWebsiteData.value = '';

          showAlert({ message: t('new_bookmark.note_saved') });
          return { objectIds: [savedNoteId(saved)] };
      } catch (error) {
          showAlert({ message: t('new_bookmark.note_error'), type: 'danger'});
          console.log('error saving text note: ', error);
          return null;
      }
  };

  /**
   * The route wraps the backend's `{ status, websiteId }` under `savedNoteId`;
   * older shapes hand back a bare id. `typeof` guards the wrapper object itself
   * falling through as the id.
   */
  const savedNoteId = (saved) => {
      const wrapped = saved?.savedNoteId;
      return (typeof wrapped === 'string' ? wrapped : wrapped?.websiteId) || saved?.websiteId || null;
  };

  /** The #words typed into a note, and the tags picked with the "#" pill. */
  const tagsForSave = () => [...new Set([...(tags.value || []), ...pickedTags.value])];

  /**
   * File what was just saved into the board picked for it.
   *
   * Runs behind the closed composer: a link or a file has no id until the
   * queue or the upload has written its row, so the ids are looked up by the
   * customIds their placeholders went up with. A movie or a game also gets
   * its tags here, because its save route does not take any.
   */
  async function fileSaved(board, { objectIds = [], customIds = [], lateTags = [] } = {}) {
      if (!board && !lateTags.length) return;

      const found = await Promise.all(customIds.map(customId => store.bookmarkIdForCustomId(customId)));
      const ids = [...new Set([...objectIds, ...found].filter(Boolean))];

      if (lateTags.length) ids.forEach(id => saveUpdatedSite(id, 'tags', lateTags));
      if (!board) return;

      if (!ids.length) {
          showAlert({ message: t('bookmarks.compose.board_failed', { board: board.name }), type: 'danger' });
          return;
      }
      try {
          const { addBookmarksToBoard } = useBoards();
          await addBookmarksToBoard(board.id, ids);
          showAlert({ message: t('bookmarks.compose.saved_to_board', { board: board.name }) });
      } catch (error) {
          console.error('[newBookmark] adding to a board failed: ', error);
          showAlert({ message: t('bookmarks.compose.board_failed', { board: board.name }), type: 'danger' });
      }
  }

  /**
   * Commit the board and create the row.
   *
   * `commit()` is what turns the live board into something persistable: it flushes the
   * debounced snapshot, uploads any images still inline, and exports the PNG the card
   * in the grid will show. Doing it here rather than on every stroke keeps a drawing
   * session down to one thumbnail upload.
   */
  async function saveDrawingToParse() {
      if (isDrawingEmpty(drawingSnapshot.value)) return null;

      forceType.value = false;
      showAlert({ message: t('new_bookmark.saving_drawing'), permanent: true, type: 'info', loader: true });

      try {
          const committed = await drawingCanvas.value?.commit();
          const drawing = committed?.drawing || drawingSnapshot.value;

          const saved = await saveDrawing({
              drawing,
              siteTitle: cleanedNoteText.value || t('bookmarks.drawing.untitled'),
              tags: tagsForSave(),
              thumbnailUrl: committed?.thumbnailUrl || null,
          });

          if (saved === 'Error') throw new Error('saveDrawing failed');

          desktopModal.value = false;
          clearNotes();
          showAlert({ message: t('new_bookmark.drawing_saved') });
          return { objectIds: [saved?.websiteId] };
      } catch (error) {
          console.log('error saving drawing: ', error);
          showAlert({ message: t('new_bookmark.drawing_error'), type: 'danger' });
          return null;
      }
  };

  async function saveMedia() {
      let bookmark = mediaBookmark.value;

      showAlert({ message: t('alerts.bookmark.saving'), permanent: true});
      const lateTags = tagsForSave();

      try {
          const savedMedia = await saveBookmark({ mediaBookmark: bookmark, type: typeOfNewBookmark.value, siteNotes: pickedNotes.value.trim() });

          if(savedMedia?.success) {
              clearNotes();
              desktopModal.value = false;
              return { customIds: [savedMedia.customId], lateTags };
          }
          return null;
      } catch (error) {
          console.log('error saving media: ', error);
          showAlert({ message: t('new_bookmark.media_error'), type: 'danger'});
          return null;
      } finally {
          mediaBookmark.value = {};
          clearNotes();
          desktopModal.value = false;
      }
  };

  async function saveWebsite(isFirstTimeArg) {
      if (!hasValidUrl.value) return null;

      showAlert({ message: t('alerts.bookmark.saving'), permanent: true});
      forceType.value = false;
      desktopModal.value = false;

      try {
          let url = removeHtml(newUrlValue.value);
          let savedBookmark = await saveBookmark({ url, tags: tagsForSave(), siteNotes: pickedNotes.value.trim() })

          if(savedBookmark?.success) {
              newUrlValue.value = '';
              if (isFirstTimeArg) firstTimeUser()
              return { customIds: [savedBookmark.customId] };
          }
      } catch (error) {
          console.log('error calling save function: ', error);
          handleParseError(error, 'saveWebsite(), newBookmark.vue');
      } finally {
          desktopModal.value = false;
      }
      return null;
  };

  async function saveFiles() {
      // The uploads read their tags off the store.
      store.imageTags = tagsForSave();
      let upload = await uploadFilesToParse();

      if (!upload.error) {
          showAlert({ message: t('alerts.file_upload.success') });
          desktopModal.value = false;
          return { customIds: upload.customIds || [] };
      } else {
          // uploadFilesToParse has already shown what went wrong — repeating it
          // here as a generic "error uploading" would overwrite the specific
          // message with a worse one.
          handleParseError(upload.error, 'saveFiles(), newBookmark.vue');
          return null;
      }
  };

  async function searchMovie(movieToSearch) {
      try {
          loadingMedia.value = true;
          const movies = await $fetch('/api/searchMovie', { method: 'post', body: { movieToSearch } });
          return movies;
      } catch (err) {
          console.log('error searching movies: ', err);
      } finally {
          loadingMedia.value = false;
      }
  };

  async function searchGame(gameToSearch)  {
      try {
          loadingMedia.value = true;
          const games = await $fetch('/api/searchGame', { method: 'post', body: { gameToSearch, gameToken: gameToken.value } });
          gameToken.value = games.token;
          if (games.error) return []
          return games.games;
      } catch (err) {
          console.log('error searching games: ', err);
          return [];
      } finally {
          loadingMedia.value = false;
      }
  };

  async function submitSite(options = {confetti: false, event: null, quickSave: false}) {
      // Guard against double-submit (double-click / repeated Cmd+Enter) which
      // previously created duplicate bookmarks.
      if (loadingSave.value) return;
      loadingSave.value = true;
      try {
          const type = typeOfNewBookmark.value;
          const isWebsite = options.quickSave || type === 'website';

          // Save is Stop while a voice note is recording (`isStoppingTake`):
          // this press ends the take, and the next one saves it.
          if(type === 'audio' && composeAudioTake.value) {
              await composeAudioTake.value.finish();
              return;
          }

          // saveBookmark() runs the quota check itself, after the placeholder
          // card is already on screen, so only the other types wait on it here.
          if(!isWebsite && !(await canSaveNewBookmark())) return;

          // Read now: a successful save clears them, and filing into the board
          // happens after that.
          const board = selectedBoard.value;
          let saved = null;

          if(filesToUpload.value.length > 0 && (type === 'image' || type === 'pdf' || type === 'audio')) {
              saved = await saveFiles();
          } else if(options.quickSave || type === 'website') {
              saved = await saveWebsite(isFirstTime.value);
          } else if(type === 'movie' || type === 'game') {
              saved = await saveMedia(cleanedNoteText.value);
          } else if(type === 'textNote') {
              saved = await saveTextNoteToParse();
          } else if(type === 'drawing') {
              saved = await saveDrawingToParse();
          }

          if (saved) {
              pickedTags.value = [];
              pickedNotes.value = '';
              notesOpen.value = false;
              selectedBoard.value = null;
              fileSaved(board, saved);
          }

          if((options.confetti || isFirstTime.value) && options.event) {
              confetti(options.event);
          }
      } finally {
          loadingSave.value = false;
      }
  };

  async function firstTimeUser() {
    try {
      const UserOptions = Parse.Object.extend("userOptions");
      const userOptionsQuery = await new Parse.Query(UserOptions);
      userOptionsQuery.equalTo("user", Parse.User.current());
      const userOptionsResult = await userOptionsQuery.find();
      userOptionsResult[0].set('isFirstTime', false);
      await userOptionsResult[0].save();
    } catch (error) {
      console.error('[newBookmark] Error setting isFirstTime to false: ', error);
    }
  };

  const isTextboxEmpty = computed(() => {
      if(newWebsiteData.value == null) return true;

      let newWebsiteDataStr = newWebsiteData.value.replace(/<\/?[^>]+(>|$)/g, '');
      let isTextboxEmpty = newWebsiteDataStr.length == 0;
      return isTextboxEmpty;
  });

  const showPlaceholder = computed(() => {
      let isTipTapActive = activeElement.value != null ? activeElement.value.classList.contains('tiptap') : false;
      return checkIfTiptapIsEmtpy.value && !isTipTapActive;
  });

  const checkIfTiptapIsEmtpy = computed(() => {
      if (!newWebsiteData.value) {
          return true;
      } else {
          let htmlString = newWebsiteData.value;
          let htmlContent = htmlString.replace(/<[^>]*>/g, '');
          return htmlContent.trim() === '';
      }
  });

  /**
   * Whether the field actually holds a link.
   *
   * `isUrlValid` below answers yes for any text at all — it was written for a
   * composer that decided the type from what you typed, where prose in the
   * field meant a note, not an invalid website. Now that picking "Website"
   * pins it, "there is text" and "there is a URL" are different questions, and
   * saving is gated on this one: a paragraph pinned to Website would otherwise
   * be filed as a bookmark whose address is a sentence.
   */
  const hasValidUrl = computed(() => {
      try {
          const url = new URL(removeHtml(newUrlValue.value));
          return url.protocol === "http:" || url.protocol === "https:";
      } catch (_) {
          return false;
      }
  });

  const isUrlValid = computed(() => {
      if (filesToUpload.value.length > 0 || textNote.value.length > 0) return true;
      return hasValidUrl.value;
  });

  const getCurrentSiteUrl = computed(() => {
      let htmlString = newWebsiteData.value;
      let htmlContent = htmlString ? htmlString.replace(/<[^>]*>/g, '') : '';

      return hasValidUrl.value ? htmlContent : '';
  });

  const submitSiteDisabled = computed(() => {
      switch (typeOfNewBookmark.value) {
          case 'empty':
              return true;
          case 'website':
              return !hasValidUrl.value;
          case 'image':
          case 'pdf':
              return filesToUpload.value.length == 0;
          case 'audio':
              return filesToUpload.value.length == 0 && !composeAudioTake.value;
          case 'game':
              return !mediaBookmark.value;
          case 'movie':
              return !mediaBookmark.value;
          case 'textNote':
              return textNote.value.length == 0;
          case 'drawing':
              return isDrawingEmpty(drawingSnapshot.value);
          default:
              return false;
      }
  });

  /**
   * Only notes and drawings grow into a full-screen editor.
   *
   * A link is one line and a file is picked, not written — there is nothing
   * here that needs a page to itself. These two are authored, and the popover
   * is a cramped place to author them.
   */
  const canExpandFromComposer = computed(() => {
      return typeOfNewBookmark.value === 'textNote' || typeOfNewBookmark.value === 'drawing';
  });

  /**
   * Save, then grow the card into a full-screen editor for what was saved.
   *
   * Save first and the sheet opens onto a bookmark that already exists, so
   * every keystroke after it is an edit on a row (the modal autosaves through
   * `saveUpdatedSite` / `updateDrawing`) rather than a draft that can still be
   * lost. The card's rect is captured before anything moves — the popover
   * tears down as the sheet opens, and afterwards there is nothing left to
   * measure.
   */
  async function expandToFullscreen() {
      // Same double-submit guard as `submitSite`: two clicks must not create
      // two bookmarks.
      if (loadingExpand.value || loadingSave.value) return;
      if (!canExpandFromComposer.value || submitSiteDisabled.value) return;

      loadingExpand.value = true;
      const type = typeOfNewBookmark.value;

      // First: the rect the full-screen sheet grows out of.
      const el = composeSurfaceEl.value;
      const rect = el ? el.getBoundingClientRect() : null;
      const originRect = rect
          ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
          : null;

      try {
          // saveBookmark() runs the quota check itself for websites; these two
          // write their row directly, so the check is here.
          if (!(await canSaveNewBookmark())) return;

          let bookmarkId = null;
          let noteHtml = null;
          let drawing = null;

          if (type === 'textNote') {
              noteHtml = newWebsiteData.value;
              showAlert({ message: t('new_bookmark.saving_note'), permanent: true, type: 'info', loader: true });

              const saved = await saveTextNote({ textNote: noteHtml, tags: tagsForSave() });
              bookmarkId = savedNoteId(saved);
          } else {
              showAlert({ message: t('new_bookmark.saving_drawing'), permanent: true, type: 'info', loader: true });

              // commit() must run while the board is still mounted, so it is
              // here — before the popover is allowed to tear down. It flushes
              // the debounced snapshot, uploads any images still inline, and
              // exports the PNG the grid card will show.
              const committed = await drawingCanvas.value?.commit();
              drawing = committed?.drawing || drawingSnapshot.value;
              if (isDrawingEmpty(drawing)) {
                  showAlert({ message: t('new_bookmark.nothing_to_save') });
                  return;
              }

              const saved = await saveDrawing({
                  drawing,
                  siteTitle: cleanedNoteText.value || t('bookmarks.drawing.untitled'),
                  tags: tagsForSave(),
                  thumbnailUrl: committed?.thumbnailUrl || null,
              });
              bookmarkId = saved?.websiteId;
          }

          if (!bookmarkId) throw new Error('save returned no bookmark id');

          fileSaved(selectedBoard.value, { objectIds: [bookmarkId] });
          pickedTags.value = [];
          selectedBoard.value = null;

          // Hand the sheet everything it needs, *then* clear the composer —
          // `clearNotes` wipes the very content being passed along.
          expandPayload.value = {
              type,
              bookmarkId,
              noteHtml,
              drawing,
              originRect,
          };

          // The card is growing into the sheet, not back into the button.
          skipMorphOut = true;
          desktopModal.value = false;
          clearNotes();
          showAlert({ message: t('new_bookmark.saved'), timeOnScreen: 1500 });
      } catch (error) {
          console.log('error expanding to full-screen editor: ', error);
          showAlert({
              message: type === 'drawing' ? t('new_bookmark.drawing_error') : t('alerts.bookmark.save_error_note'),
              type: 'danger',
          });
      } finally {
          loadingExpand.value = false;
      }
  }

  const showFloatingMenu = computed(() => {
    return typeOfNewBookmark.value == 'empty' || typeOfNewBookmark.value == 'textNote';
  });

</script>

<style>
@reference "../assets/css/tailwind.css";

/* ============================================================
   New Bookmark — Apple-style popover
   (non-scoped: the popover content is teleported to an overlay)
   ============================================================ */


/* ---- Trigger ---- */
.nb-trigger {
  transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.25s ease;
  &:hover { transform: scale(1.06); }
  &:active { transform: scale(0.94); }
}

/* ---- Popover shell -------------------------------------------------------
   Nuxt UI's own panel is stripped here so the composer and the type selector
   can be two surfaces with air between them. The selector is doubled so it
   wins over `bg-default` and friends on the same element without `!important`
   — which is what broke this rule the last time it was written. */
.nb-popover.nb-popover {
  background: transparent;
  border: 0;
  box-shadow: none;
  padding: 0;
  /* The two surfaces cast their own shadows and the selector sits proud of
     the composer; clipping here would shave both. */
  overflow: visible;
}

.nb-sheet {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Between the popover mounting and the morph starting — a frame or two, while
   Reka places it. See `onSheet`. */
.nb-sheet[data-morph="pending"] > .nb-card,
.nb-sheet[data-morph="pending"] > .nb-types {
  opacity: 0;
}

/* Reka keeps a closing popover mounted for as long as a CSS animation runs on
   it. This one changes nothing visible; it only holds the popover open while
   the surfaces shrink back into the "+" (`MORPH_OUT_MS`, which it outlasts). */
@keyframes nb-compose-hold {
  from { visibility: visible; }
  to { visibility: visible; }
}

/* ---- Surfaces: glass, hairline, layered shadow ----
   See-through enough for the blur to show. At 92% white the grid behind
   barely showed, so the card read as a white panel with a faint tint rather
   than as a material, and it was hard to tell the blur was there at all. This
   is closer to an iOS or macOS material: the cards behind come through as
   soft colour and the text on top stays legible. The top highlight is the
   light catching the edge of the glass. */
.nb-card,
.nb-types {
  background-color: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(30px) saturate(190%);
  -webkit-backdrop-filter: blur(30px) saturate(190%);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 0 0 0.5px rgba(0, 0, 0, 0.08),
    0 12px 32px -8px rgba(0, 0, 0, 0.2),
    0 4px 12px -4px rgba(0, 0, 0, 0.12);
}
.dark .nb-card,
.dark .nb-types {
  background-color: rgba(30, 30, 32, 0.58);
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    0 0 0 0.5px rgba(0, 0, 0, 0.5),
    0 16px 40px -8px rgba(0, 0, 0, 0.6);
}

/* Without a backdrop filter the translucency has nothing to blur behind it, so
   fall back to a solid panel rather than a see-through one. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .nb-card, .nb-types { background-color: #ffffff; }
  .dark .nb-card, .dark .nb-types { background-color: #1c1c1e; }
}

/* ---- Composer ---- */
.nb-card {
  border-radius: 22px;
  /* The height comes from `cardStyle`, measured off `.nb-card-inner`. */
  overflow: hidden;
  transition: height 0.32s cubic-bezier(0.32, 0.72, 0, 1);
}

.nb-card-inner {
  padding: 14px 14px 14px;
}

/* Room to write in, and only as much as the kind of thing being written needs:
   a link is one line and a note is a page. Set on the body rather than on the
   editor, so a card that has grown a preview or a list of search results does
   not also carry an empty field above it. */
.nb-card-body {
  min-height: 52px;
}

.nb-card-body--textNote {
  min-height: 180px;
}

/* The board brings its own 380px; anything more is the card guessing. */
.nb-card-body--drawing,
.nb-card-body--image {
  min-height: 0;
}

/* The list is part of the card here, not a menu over it. */
.nb-results {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  max-height: 260px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

/* The composer is a few hundred pixels tall; the standalone preview is built
   for a page and brings a 12rem image with it. */
.nb-card-body .preview-card img {
  height: 120px;
}

/* The preview card is transparent until hovered, which in a grid of cards
   reads as restraint and in a card of its own reads as a picture someone
   forgot to finish. */
.nb-card-body .preview-card {
  background: rgba(120, 120, 128, 0.08);
  border-color: rgba(0, 0, 0, 0.06);
  cursor: default;
}
.dark .nb-card-body .preview-card {
  background: rgba(120, 120, 128, 0.16);
  border-color: rgba(255, 255, 255, 0.08);
}
.nb-card-body .preview-card .card-content {
  padding: 8px 10px 10px;
  gap: 2px;
}
.nb-card-body .preview-card h4 { font-size: 14px; }
.nb-card-body .preview-card p { font-size: 12px; opacity: 0.7; }

.nb-card-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
}

/* Tags and board on the left, Save on the right, as on the native composer. */
.nb-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-inline-end: auto;
  min-width: 0;
}

/* The two quiet controls beside Save: small glass capsules that take the
   accent once they hold something. `--square` is the board button with no
   board picked, which is only its glyph. */
.nb-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px 0 12px;
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  color: var(--ui-text-muted, #6b7280);
  background: rgba(120, 120, 128, 0.12);
  box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.05);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s ease, color 0.2s ease, transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}
.nb-pill:hover { background: rgba(120, 120, 128, 0.18); color: var(--ui-text, inherit); }
.nb-pill:active { transform: scale(0.95); }
.nb-pill:focus-visible { outline: 2px solid color-mix(in srgb, var(--ui-primary) 55%, transparent); outline-offset: 2px; }
.nb-pill--square { width: 36px; padding: 0; justify-content: center; }
.nb-pill--on,
.nb-pill--on:hover {
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 14%, transparent);
}
.dark .nb-pill { box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.08); }

/* The note, between the editor and the row of pills. */
.nb-notes {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 12px;
  resize: none;
  font-size: 14px;
  line-height: 1.4;
  color: inherit;
  background: rgba(120, 120, 128, 0.12);
  outline: none;
}
.nb-notes:focus-visible { box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 55%, transparent); }

/* The tags picked with the pill, above the row they were picked from. */
.nb-tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 10px;
}
.nb-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 4px 10px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
  transition: background 0.2s ease;
}
.nb-tag-chip:hover { background: color-mix(in srgb, var(--ui-primary) 20%, transparent); }

/* Sits beside Save as the quiet second choice: same height, no fill, so the
   primary still reads as the primary. */
.nb-expand-trigger {
  transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.2s ease, color 0.2s ease;
}
.nb-expand-trigger:not(:disabled):hover {
  color: var(--ui-text, inherit);
  box-shadow:
    0 4px 12px -6px rgba(0, 0, 0, 0.18),
    0 2px 5px -3px rgba(0, 0, 0, 0.12);
}
.nb-expand-trigger:not(:disabled):active { transform: scale(0.94); }

/* Kept close to the button: the card clips its overflow so it can animate its
   own height, and a wider glow would simply be cut off at the bottom edge. */
.nb-save {
  transition: transform 0.2s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.2s ease;
  box-shadow:
    0 5px 12px -5px color-mix(in srgb, var(--ui-primary) 80%, transparent),
    0 2px 5px -2px rgba(0, 0, 0, 0.2);
}
.nb-save:not(:disabled):hover {
  box-shadow:
    0 7px 16px -6px color-mix(in srgb, var(--ui-primary) 90%, transparent),
    0 3px 7px -2px rgba(0, 0, 0, 0.24);
}
.nb-save:not(:disabled):active { transform: scale(0.96); }
/* Nothing to shout about while there is nothing to save. */
.nb-save:disabled {
  box-shadow: 0 2px 6px -3px rgba(0, 0, 0, 0.18);
}

/* ---- Type selector ---- */
.nb-types {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 9999px;
  padding: 5px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}
.nb-types::-webkit-scrollbar { display: none; }

/* What gets centred in a flex row is the label's *box*, not its letters. At
   the app's inherited 1.5 line-height that box carries a couple of pixels of
   leading above the letters and the font's whole descent below them, so a word
   with no descenders — "Website", "Note" — sat high in the pill with the slack
   pooled underneath it. `text-box-trim` cuts the box back to cap-height and
   baseline, so centring the box centres what you can actually see; the
   `line-height: 1` under it is most of the correction on its own, for the
   browsers that have not shipped the trim yet. */
.nb-type {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 8px 12px;
  border-radius: 9999px;
  font-size: 13px;
  line-height: 1;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--ui-text-muted, #6b7280);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s ease, color 0.2s ease, transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}
.nb-type > span {
  text-box-trim: trim-both;
  text-box-edge: cap alphabetic;
}

.nb-type:hover { background: rgba(120, 120, 128, 0.12); color: var(--ui-text, inherit); }
.nb-type:active { transform: scale(0.95); }

.nb-type--active,
.nb-type--active:hover {
  background: var(--ui-primary);
  color: var(--ui-text-inverted, #fff);
  box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--ui-primary) 55%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .nb-type, .nb-trigger, .nb-save, .nb-expand-trigger, .nb-pill { transition: opacity 0.15s ease; }
  .nb-type:active, .nb-trigger:active, .nb-save:active, .nb-expand-trigger:active, .nb-pill:active { transform: none; }
}

/* ---------------- Inline (wizard) ---------------- */
.is-inline{
  @apply pb-0 shadow-none;

  .movie-options-wrapper, .game-options-wrapper{
    margin-top: -0.25rem;
    max-height: 290px;
  }

  .bookmark-preview-wrapper, .bookmark-preview-node{
    @apply pt-3 h-[282px];
  }

  .bookmark-card{

    .card-header{
      @apply
        w-full
        h-44
        flex items-center
      ;
    }

    img{
      @apply w-full ;
    }
  }

}
</style>
