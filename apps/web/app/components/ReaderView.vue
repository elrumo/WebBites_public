<!-- // Nuxt Front end server components/ReaderView.vue -->
<template>
  <div
      :class="{
          'reader-mode-wrapper': type != 'game' && type != 'movie',
          'w-full': type == 'movie' || type == 'book' || type == 'game',
      }"
  >
      <div :class="{
          'modal-article-wrapper': type != 'figma-file',
          'modal-figma-wrapper': type === 'figma-file',
          'serif': readerOptions.isSerif,
      }">
        <div v-if="showAsArticle && !isPdf">
            <div class="article-header">
                <div v-if="getWebsiteName" class="w-full h-fit flex justify-center pt-4 md:pt-8 pb-4">
                <a
                    :href="webToShow.url"
                    target="_blank"
                    class="site-publisher-favicon w-fit"
                >
                    <img v-if="webToShow.siteLogo" class="favicon" :src="webToShow.siteLogo" alt="">
                    {{ getWebsiteName }}
                    <UIcon name="i-heroicons-arrow-top-right-on-square"/>
                    <!-- <IconBrew icon="shareArrow"/> -->
                </a>
                </div>

                <CardSummary
                    v-if="
                      webToShow.aiSummary &&
                      showAsArticle &&
                      activeTab == 'readerMode' &&
                      !isTweet &&
                      type != 'music' &&
                      !webToShow?.subType?.includes('youtube')
                    "
                    :summary="webToShow.aiSummary" :website="webToShow"
                    :class="{'showSideBarOptions': showSideBarOptions}"
                    :showImage="false"
                />

                <div class="mt-4" v-if="!isTweet">
                    <p v-if="type == 'github'" class="mb-0">
                        {{ webToShow?.siteTitle?.substring(0, webToShow?.siteTitle?.indexOf(':')) }}
                    </p>
                    <h4 class="mt-0 !mb-0">
                        {{ getSiteTitle }}
                    </h4>
                </div>

              <div v-if="webToShow.siteAuthor || webToShow.siteDate" class="mb-2">
                <small v-if="webToShow.siteDate">
                    {{ getDate(webToShow.siteDate) }}
                </small>
                <span v-if="webToShow.siteAuthor && webToShow.siteDate"> • </span>
                <small
                    v-if="!isTweet && webToShow.siteAuthor && webToShow.siteAuthor != 'null'">
                    {{ $t('reader.by_author', { author: webToShow.siteAuthor }) }}
                </small>
              </div>

              <p
                v-if="webToShow.siteDescription"
                class="mb-4"
                v-html="webToShow.siteDescription">
              </p>
            </div>

            <div>
                <div
                    class="website-details-images"
                    ref="websiteImage"
                    v-if="(!webToShow.embedCode || type == 'dribbble') && !isTweet"
                >
                  <nuxt-img
                    v-if="webToShow.OGImage != undefined || webToShow.OGImage != null && webToShow.noEmbedCode == null || type == 'dribbble'"
                    class="featured-image" :src="webToShow.OGImage" alt="" placeholder
                    format="webp"
                  />
                  <nuxt-img
                    v-else-if="webToShow.siteScreenshot != undefined && webToShow.noEmbedCode == null"
                    class="featured-image"
                    :src="typeof webToShow.siteScreenshot.url == 'function' ? webToShow.siteScreenshot.url() : webToShow.siteScreenshot.url"
                    alt="" placeholder format="webp"
                  />
                </div>

                <div
                  v-if="webToShow.embedCode && !isTweet && showVideos"
                  id="noEmbedCode"
                  class="youtube-embed"
                  v-html="cleanHtml(webToShow.embedCode)"
                />

                <!-- Listen to audio button -->
                <Transition name="slide-up">
                  <div
                    v-if="
                      (webToShow.articleAudio == undefined && globalAudioInstance == null) &&
                      webToShow.siteBody != undefined &&
                      type != 'music' &&
                      webToShow.subType &&
                      !webToShow.subType.includes('youtube') &&
                      webToShow.subType.includes('article')
                    "
                    class="flex justify-center items-center gap-1 w-full"
                  >
                    <UButton
                      @click="listenToArticle()"
                      :loading="audioLoading"
                      variant="solid"
                      color="neutral"
                      class="mb-6 mt-2 shadow-md"
                    >
                    <transition name="slide-up">
                      <IconBrew v-if="!audioLoading" icon="headphones" />
                    </transition>
                    <span>
                      {{ !isTweet ? $t('reader.listen_article') : $t('reader.listen_to_post') }}
                    </span>
                  </UButton>
                  <AudioVoicePicker class="mb-6 mt-2" />
                </div>
              </Transition>

              <!-- Audio player -->
              <Transition name="slide-up">
                <div
                    v-if="
                      isAnArticle &&
                      (webToShow.articleAudio || globalAudioInstance) &&
                      !isTweet &&
                      (
                        webToShow.siteBody != undefined &&
                        cleanHtml(webToShow.siteBody).length > 700
                      )
                    "
                    :class="{
                      'listen-to-article sticky-top': true,
                      'sticky': webToShow.articleAudio != undefined,
                    }"
                  >

                    <div class="custom-audio-player">
                      <div class="audio-controls">
                        <div class="flex flex-row gap-2">
                          <UButton
                            @click="skipBackward"
                            class="rounded-full"
                            variant="ghost"
                            square
                            icon="i-tabler-rewind-backward-15"
                          />

                          <UButton
                            @click="togglePlay"
                            :class="{
                              'rounded-full': true,
                              'pl-[7px] pr-[5px]': !isPlaying,
                              'pl-[6px] pr-[6px]': isPlaying,
                              }"
                            variant="solid"
                            square
                            color="neutral"
                          >
                            <UIcon v-if="isPlaying" name="i-heroicons-pause" class="w-4 h-4" />
                            <UIcon v-if="!isPlaying" name="i-heroicons-play" class="w-4 h-4" />
                          </UButton>

                          <UButton
                            @click="skipForward"
                            class="rounded-full"
                            variant="ghost"
                            square
                            icon="i-tabler-rewind-forward-15"
                          />
                        </div>

                        <div class="flex w-full gap-2">
                          <div class="progress-bar">
                            <USlider
                              v-model="currentTime"
                              @input="seek"
                              size="sm"
                              :max="duration"
                            />
                            <Transition name="slide-up">
                              <div class="time-display">
                                <span v-if="duration != 'Infinity'">{{ formatTime(currentTime) }}</span>
                                <span v-if="duration != 'Infinity'">{{ formatTime(duration) }}</span>
                              </div>
                            </Transition>

                            <small class="opacity-40 absolute left-1/2 -translate-x-1/2 bottom-0">
                              {{ $t('reader.ai_generated') }}
                            </small>
                          </div>

                          <UDropdownMenu :items="speedOptions" :content="{ side: 'bottom', align: 'end' }">
                            <UButton
                              variant="ghost"
                              size="sm"
                              :label="`${playbackSpeed}x`"
                              class="gap-1"
                            />
                          </UDropdownMenu>
                        </div>
                      </div>
                    </div>
                </div>
              </Transition>

              <!-- Article content -->
              <div v-if="
                  !isTweet && ((!webToShow.embedCode && (webToShow.siteBody || webToShow.siteHtml)) ||
                  (webToShow.siteBody || webToShow.siteHtml))
                "
                :class="{
                    'reader': true,
                    'reader--serif': readerOptions.isSerif,
                    'hide-images': isAnArticle ? !readerOptions.showImages : false
                }"
                v-html="isAnArticle ? processTextWithTimestamps(cleanHtml(webToShow.siteBody)) : cleanHtml(webToShow.siteHtml)"
              />

              <div v-if="isTweet" class="tweet-reader" v-html="getTweet()"></div>
              <!-- {{getTweet()}} -->

            </div>
        </div>

        <!-- PDF Viewer -->
        <PdfViewer v-if="isPdf" :pdfUrl="webToShow.url"/>

          <!-- Show as movie, movie view -->
        <WebsiteModalMediaView
          :type="type"
          v-if="type == 'movie' || type == 'game'"
        />

          <!-- Figma iframe -->
          <!-- <div v-if="isFigma" class="type-figma">
              <iframe :src="'https://www.figma.com/embed?embed_host=share&url=' + webToShow.url"
                  allowfullscreen style="width:100%; height:100%;">
              </iframe>
          </div> -->

      </div>
  </div>
</template>


<script setup>
import Parse from 'parse';
import { storeToRefs } from 'pinia'
import { useStore } from '~/stores/myStore'
import { VueSound } from 'vue-sound'

const store = useStore()
const { t, locale } = useI18n()

const {
    cleanHtml,
    removeHtml,
    showAlert
} = store

const {
  webToShow,
  showWebsiteModal,
  readerOptions,
  activeTab,
  showSideBarOptions,
  globalAudioInstance,
  userApiKey,
  userOptions
} = storeToRefs(store)

const audioLoading = ref(false)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const playbackSpeed = ref(1)
// const globalAudioInstance = ref(null)
const speedOptions = [
  [{
    label: '0.5x',
    onSelect: () => setPlaybackSpeed(0.5)
  }, {
    label: '0.75x',
    onSelect: () => setPlaybackSpeed(0.75)
  }, {
    label: '1x',
    onSelect: () => setPlaybackSpeed(1)
  }, {
    label: '1.25x',
    onSelect: () => setPlaybackSpeed(1.25)
  }, {
    label: '1.5x',
    onSelect: () => setPlaybackSpeed(1.5)
  }, {
    label: '2x',
    onSelect: () => setPlaybackSpeed(2)
  }]
]

const type = computed(() =>  webToShow.value.type)
const isPdf = computed(() => {
  if (!webToShow.value.url) return false
  const cleanUrl = webToShow.value.url.split('?')[0].split('#')[0]
  return cleanUrl.toLowerCase().endsWith('.pdf')
})
const showAsArticle = computed(() => !isFigma.value && type.value != 'movie' && type.value != 'game' && !isPdf.value)
const isFigma = computed(() => webToShow.value.subType ? webToShow.value.subType.includes('figma-file') : false)
const isAnArticle = computed(() => is('article') || webToShow.value.siteBody != undefined)
const isTweet = computed(() => webToShow.value.subType ? webToShow.value.subType.includes('tweet') : false)
const showVideos = ref(false);

onMounted(() => {
  setTimeout(() => {
    showVideos.value = true
  }, 0o200)
})

onBeforeUnmount(()=>{
  showVideos.value = false;
})

const getWebsiteName = computed(() => {
    if (webToShow.value.siteAuthor && isTweet) {
        return webToShow.value.siteAuthor;
    } else if (webToShow.value.sitePublisher) {
        return webToShow.value.sitePublisher;
    } else {
        // Extract domain name from URL
        console.log("webToShow.url: ", webToShow.value.url);
        try {
            const url = new URL(webToShow.value.url);
            return url.hostname.replace('www.', '').replace(/\.[^.]+$/, '').charAt(0).toUpperCase() + url.hostname.replace('www.', '').replace(/\.[^.]+$/, '').slice(1);
        } catch {
            return '';
        }
    }
})

const getSiteTitle = computed(() => {
    if (type.value == 'github') { // If the website is a github repo, create a regex that returns the title of the repo
        let title = webToShow.value.siteTitle.substring(webToShow.value.siteTitle.indexOf(':') + 1).trim();
        return title
    }
    return webToShow.value.siteTitle
})

const getTweet = (bodyOnly = false) => {
    try {
        let tweet = webToShow.value.noEmbedCode;
        console.log('tweet: ', tweet)

        if (bodyOnly) {
            // Create a temporary div to parse HTML
            const div = document.createElement('div');
            div.innerHTML = tweet;
            // Find and return only tweet content text
            const tweetContent = div.querySelector('.tweet-content');
            return tweetContent ? tweetContent.textContent : '';
        }

        // Clean up tweet HTML if not bodyOnly
        tweet = tweet.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        tweet = tweet.replace(/T\d+:\d+:\d+\.\d+Z"/g, '"');
        tweet = tweet.replace('twitter-tweet', 'tweet');
        return tweet;
    } catch (error) {
        return '';
    }
};


// Error bodies reach us in three shapes: the backend's
// `{success:false, message, error}`, Nuxt's `{error: true, statusCode,
// statusMessage, message}` and plain non-JSON. `error` is a *boolean flag* in
// the Nuxt shape, which is why the alert used to read literally "true".
function errorMessageFrom(payload, response) {
  const candidates = [
    payload?.message,
    payload?.statusMessage,
    typeof payload?.error === 'string' ? payload.error : null,
    payload?.data?.message,
    typeof payload?.data?.error === 'string' ? payload.data.error : null,
    response?.statusText
  ];
  return candidates.find(value => typeof value === 'string' && value.length > 0)
    || t('reader_view.error_try_again');
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function listenToArticle() {
  // Clean up existing audio if it exists
  if (globalAudioInstance.value) {
    globalAudioInstance.value.pause();
    globalAudioInstance.value.src = '';
    globalAudioInstance.value = null;
    isPlaying.value = false;
    currentTime.value = 0;
  }

  try {
    audioLoading.value = true;
    let textToRead = removeHtml(webToShow.value.siteBody);
    

    if(isTweet.value) textToRead = getTweet(true);
    const requestPayload = {
      text: textToRead,
      url: webToShow.value.url,
      userId: Parse.User.current().id,
      websiteID: webToShow.value.objectId,
      voice: userOptions.value.aiVoice,
      accent: userOptions.value.aiAccent
    };

    // Fetch the audio endpoint info
    let getEndpoint;

    try {
      const endpointResponse = await fetch(`/api/v1/audio/getAudio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      getEndpoint = await readJsonSafely(endpointResponse);

      if (!endpointResponse.ok || !getEndpoint?.endpoint) {
        throw new Error(errorMessageFrom(getEndpoint, endpointResponse));
      }
    } catch (fetchError) {
      console.error("Error getting audio endpoint:", fetchError);
      showAlert({ message: fetchError.message || t('reader_view.error_try_again'), type: 'error' });
      audioLoading.value = false;
      return null;
    }

    // Use fetch with ReadableStream for progressive streaming
    try {
      const response = await fetch(`/api/v1/audio/streamAudio?endpoint=${encodeURIComponent(getEndpoint.endpoint)}`, {
        method: 'GET',
        headers: {
          'Accept': 'audio/mpeg'
        }
      });

      console.log('Response info:', response);

      if (!response.ok) {
        const errorData = await readJsonSafely(response);
        throw new Error(errorMessageFrom(errorData, response), { cause: errorData ?? null });
      }

      // Check content type
      const contentType = response.headers.get('Content-Type') || '';

      if (contentType.includes('application/json')) {
        // Handle JSON response (cached audio or error)
        const jsonData = await response.json();
        if (jsonData.success && jsonData.audioUrl) {
          console.log('Received cached audio URL:', jsonData.audioUrl);
          globalAudioInstance.value = new Audio(jsonData.audioUrl);
          webToShow.value.articleAudio = {
            url: () => jsonData.audioUrl,
            audio: globalAudioInstance.value
          };

          globalAudioInstance.value.play().catch(e => {
            console.error('Error playing cached audio:', e);
          });

          audioLoading.value = false;
          return globalAudioInstance.value;
        } else {
          throw new Error(jsonData.error || 'Unknown error in JSON response');
        }
      }


      // For streaming audio, we'll use MediaSource API
      console.log('Setting up MediaSource for streaming');
      const mediaSource = new MediaSource();
      const audioUrl = URL.createObjectURL(mediaSource);

      // Create audio element
      globalAudioInstance.value = new Audio(audioUrl);
      webToShow.value.articleAudio = {
        url: () => audioUrl,
        audio: globalAudioInstance.value
      };

      // Set up events on audio element
      globalAudioInstance.value.addEventListener('canplay', () => {
        console.log('Audio can now play');
        // Start playback when enough data is buffered
        if (!isPlaying.value) {
          isPlaying.value = true;
          globalAudioInstance.value.play().catch(e => {
            console.error('Error starting playback:', e);
          });
        }
      });

      globalAudioInstance.value.addEventListener('ended', () => {
        console.log('Audio playback completed');
        isPlaying.value = false;
      });

      // Track buffer level and playback state
      let sourceBuffer;
      let playbackStarted = false;
      let totalBytesReceived = 0;
      const minBufferSize = 65536; // 64KB initial buffer size

      // Handle MediaSource events
      mediaSource.addEventListener('sourceopen', async () => {
        console.log('MediaSource opened');
        try {
          // Create source buffer for MP3
          sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');

          // Get reader from response body
          const reader = response.body.getReader();

          // Read chunks and append to buffer
          async function readChunks() {
            let receivedFirstChunk = false;

            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                console.log('Stream complete, closing MediaSource');
                try {
                  if (mediaSource.readyState === 'open') {
                    mediaSource.endOfStream();
                  }
                } catch (e) {
                  console.error('Error ending media source:', e);
                }
                break;
              }

              // Process chunk
              if (value && value.length > 0) {
                totalBytesReceived += value.length;

                // Wait if sourceBuffer is currently updating
                if (sourceBuffer.updating) {
                  await new Promise(resolve => {
                    sourceBuffer.addEventListener('updateend', resolve, { once: true });
                  });
                }

                if(!showWebsiteModal.value) {
                  // Stop playback and close connection if modal is closed
                  if (globalAudioInstance.value) {
                    globalAudioInstance.value.pause();
                    globalAudioInstance.value.src = '';
                    mediaSource.endOfStream();
                  }
                  return;
                }

                try {
                  // Append the chunk to the source buffer
                  sourceBuffer.appendBuffer(value);

                  // Mark first data received
                  if (!receivedFirstChunk) {
                    receivedFirstChunk = true;
                    console.log('Received first audio chunk');
                  }

                  // Start playback once we have enough data
                  if (!playbackStarted && totalBytesReceived >= minBufferSize) {
                    console.log(`Buffered ${totalBytesReceived} bytes, starting playback`);
                    playbackStarted = true;

                    // Small delay to ensure buffer is processed
                    setTimeout(() => {
                      globalAudioInstance.value.play().catch(e => {
                        console.error('Error starting playback:', e);
                        // Try again after a moment
                        setTimeout(() => {
                          globalAudioInstance.value.play().catch(e2 => {
                            console.error('Retry playback failed:', e2);
                          });
                        }, 1000);
                      });
                    }, 500);
                  }
                } catch (appendError) {
                  console.error('Error appending buffer:', appendError);

                  // If we can't append to buffer, wait for updateend event
                  if (sourceBuffer.updating) {
                    await new Promise(resolve => {
                      sourceBuffer.addEventListener('updateend', resolve, { once: true });
                    });
                  }
                }
              }
            }
          }

          // Start reading chunks
          readChunks().catch(streamError => {
            console.error('Error in stream processing:', streamError);
            // Fallback to blob if streaming fails
            fallbackToBlob(response);
          });

        } catch (sourceBufferError) {
          console.error('Error setting up source buffer:', sourceBufferError);
          // Fallback to blob method
          fallbackToBlob(response);
        }
      });

      mediaSource.addEventListener('sourceclose', () => {
        console.log('MediaSource closed');
      });

      mediaSource.addEventListener('error', (e) => {
        console.error('MediaSource error:', e);
        fallbackToBlob(response);
      });

      audioLoading.value = false;
      return globalAudioInstance.value;

    } catch (fetchError) {
      console.log("Error fetching audio 2:", fetchError.cause)
      showAlert({message: fetchError.message || t('reader_view.error_try_again'), type: 'error'});
      audioLoading.value = false;
      return null;
    }

    // Fallback function if streaming fails
    async function fallbackToBlob(response) {
      console.log('Falling back to blob method');
      try {
        // Clone response if needed
        const responseForBlob = response.clone ? response.clone() : response;

        // Get the entire audio as a blob
        const blob = await responseForBlob.blob();
        console.log(`Blob created, size: ${blob.size} bytes`);

        // Create audio from blob
        const blobUrl = URL.createObjectURL(blob);

        // Clean up previous audio if exists
        if (globalAudioInstance.value) {
          globalAudioInstance.value.pause();
          globalAudioInstance.value.src = '';
        }

        globalAudioInstance.value = new Audio(blobUrl);
        webToShow.value.articleAudio = {
          url: () => blobUrl,
          audio: globalAudioInstance.value
        };

        // Play when ready
        globalAudioInstance.value.oncanplay = () => {
          console.log('Fallback audio can play');
          isPlaying.value = true;
          globalAudioInstance.value.play().catch(e => {
            console.error('Error playing fallback audio:', e);
            isPlaying.value = false;
          });
        };

        return globalAudioInstance.value;
      } catch (blobError) {
        console.error('Blob fallback failed:', blobError);
        audioLoading.value = false;
        return null;
      }
    }

  } catch (error) {
    console.error("Unhandled error in listenToArticle:", error);
    audioLoading.value = false;
    return null;
  } finally {
    // Safety timeout to ensure loading state is cleared
    setTimeout(() => {
      if (audioLoading.value) {
        audioLoading.value = false;
      }
    }, 30000);

    console.log("listenToArticle function completed");
  }
}

function getDate(date) {
    return new Date(date).toLocaleDateString(locale.value, { year: 'numeric', month: 'long', day: 'numeric' })
}

function is(type) {
    return webToShow.value.subType ? webToShow.value.subType.includes(type) : false;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function togglePlay() {
  if (!webToShow.value.articleAudio?.audio) return

  if (isPlaying.value) {
    globalAudioInstance.value.pause()
    // webToShow.value.articleAudio.audio.pause()
  } else {
    globalAudioInstance.value.play()
    // webToShow.value.articleAudio.audio.play()
  }
  isPlaying.value = !isPlaying.value
}

function seek(event) {
  try{
    if (!globalAudioInstance.value) return
    // if (!webToShow.value.articleAudio?.audio) return

    const time = Number(event.target.value)
    // webToShow.value.articleAudio.audio.currentTime = time
    globalAudioInstance.value.currentTime = time
    currentTime.value = time
  } catch(error){
    console.log("Error in seek:", error)
  }
}


function processTextWithTimestamps(html) {
  return html
  // TODO: Fix position, so it doesn't go too far ahead of behind.
  if (!html) return ''

  // Create a temporary container
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = cleanHtml(html)

  // Process text nodes while preserving HTML structure
  const averageWordsPerSecond = 2.64 * playbackSpeed.value
  let wordCount = 0

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const words = node.textContent.split(/\s+/).filter(word => word.length > 0)
      const spans = words.map(word => {
        const timestamp = Math.floor(wordCount / averageWordsPerSecond)
        wordCount++
        return `<span data-timestamp="${timestamp}">${word}</span>`
      })
      node.parentNode.replaceChild(
        document.createRange().createContextualFragment(spans.join(' ')),
        node
      )
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      Array.from(node.childNodes).forEach(processNode)
    }
  }

  Array.from(tempDiv.childNodes).forEach(processNode)
  return tempDiv.innerHTML
}

watch(globalAudioInstance, (newAudio) => {
  if (newAudio) {
    newAudio.addEventListener('pause', () => {
      isPlaying.value = false
    })

    newAudio.addEventListener('play', () => {
      isPlaying.value = true
    })
  }
})

// Watch for showWebsiteModal changes to stop audio when modal closes
watch(showWebsiteModal, (newValue) => {
  console.log('newValue showWebsiteModal:', newValue)
  if (!newValue) {
    // Stop audio if it exists
    if (webToShow.value?.articleAudio?.audio) {
      try {
        globalAudioInstance.value.pause()
        globalAudioInstance.value.src = ''
        globalAudioInstance.value = null
        currentTime.value = 0
      } catch (error) {
        console.error('Error stopping audio 3:', error)
      }
    }
  }
}, { immediate: true })


// Modify the watch effect for articleAudio
watch(() => webToShow.value.articleAudio, (newAudioData) => {
  if (newAudioData) {
    // Reset values
    currentTime.value = 0
    duration.value = 0

    // If we have a URL but no audio object, create one
    if (newAudioData.url && !newAudioData.audio) {
      const audioUrl = typeof newAudioData.url === 'function' ? newAudioData.url() : newAudioData.url
      globalAudioInstance.value = new Audio(audioUrl)
      webToShow.value.articleAudio.audio = globalAudioInstance.value
    }

    if (webToShow.value.articleAudio.audio) {
      const audio = globalAudioInstance.value

      // Add loadedmetadata event listener to get duration
      globalAudioInstance.value.addEventListener('loadedmetadata', () => {
        duration.value = audio.duration
      })

      // Keep the existing duration check as fallback
      if (audio.duration && !isNaN(audio.duration)) {
        duration.value = audio.duration
      }

      globalAudioInstance.value.addEventListener('timeupdate', () => {
        currentTime.value = audio.currentTime
        // Update highlighting
        const currentTimeInSeconds = Math.floor(audio.currentTime)
        const spans = document.querySelectorAll('.reader span[data-timestamp]')
        spans.forEach(span => {
          const timestamp = parseInt(span.dataset.timestamp)
          if (timestamp === currentTimeInSeconds) {
            span.classList.add('highlight')
          } else if (timestamp < currentTimeInSeconds - 1) {
            span.classList.remove('highlight')
          }
        })
      })
    }
  }
}, { deep: true })

function skipBackward() {
  if (!webToShow.value.articleAudio?.audio) return
  globalAudioInstance.value.currentTime = Math.max(0, globalAudioInstance.value.currentTime - 15)
}

function skipForward() {
  if (!webToShow.value.articleAudio?.audio) return
  globalAudioInstance.value.currentTime = Math.min(
    globalAudioInstance.value.duration,
    globalAudioInstance.value.currentTime + 15
  )
}

function setPlaybackSpeed(speed) {
  if (!webToShow.value.articleAudio?.audio) return
  playbackSpeed.value = speed
  globalAudioInstance.value.playbackRate = speed
}
</script>


<style>
@import 'vue-sound/style.css';
@reference "../assets/css/tailwind.css";

  :root {
  --player-font-size: 0.9rem;
  --player-font-size-small: 0.7rem;
  --player-font-weight: 300;
  --player-font-weight-bold: 600;
  --player-text-color: black;
  --player-icon-color: var(--player-text-color);
  --player-link-color: var(--player-text-color);
  --player-progress-color: theme('colors.neutral.200');
  --player-buffered-color: theme('colors.neutral.300');
  --player-input-range-color: var(--player-text-color);

  @media screen and (prefers-color-scheme: dark) {
    --player-text-color: white;
  }
}

.player{
  @apply
    max-w-lg
    min-w-80
    rounded-xl
    pb-8
    shadow-md
    overflow-hidden
    border border-neutral-200 dark:border-neutral-700
    bg-neutral-100 dark:bg-neutral-900
  ;
}

.player-track{
  @apply
    absolute
    bottom-1
    px-2
    left-1/2
    -translate-x-1/2
    flex
    flex-col-reverse
  ;
}

.player-controls{
  @apply flex justify-center;
}

.player-back-15-icon, .player-play-pause-icon, .player-ahead-15-icon{
  @apply cursor-pointer;
}

.player-back-15-icon, .player-ahead-15-icon{
  @apply transition duration-200 opacity-50 hover:opacity-100;
}

.player-volume{
  display: none;
}


.player-track-progress{
  @apply
    h-2
    mt-2
    rounded-xl
    overflow-hidden
  ;
}

.player-track-seeker{
  @apply bg-neutral-800;
}

.sticky-top {
  @apply sticky top-16 md:top-3 z-10;
}

.custom-audio-player {
  @apply
    w-full
    md:w-[80%]
    px-4
    pt-4
    pb-3
    rounded-2xl
    bg-white dark:bg-neutral-900
    border border-neutral-200 dark:border-neutral-700
    shadow-lg
  ;

  .audio-controls {
    @apply
      flex
      flex-col
      md:flex-row
      items-center
      gap-4
    ;


    .progress-bar {
      @apply
        relative
        flex-1
        flex
        flex-col
        gap-1
      ;

      .time-display {
        @apply
          flex
          justify-between
          text-sm
          text-neutral-500
          dark:text-neutral-400;
        min-height: 20px;
      }
    }
  }
}
.reader {
  padding-bottom: 4rem;

  span[data-timestamp] {
    transition: all 0.3s ease;
    margin-right: -1px;
    padding: 0 1px;

    &.highlight {
      @apply
        rounded-md
        bg-emerald-500 dark:bg-emerald-600
      ;

      & + .highlight {
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
        margin-left: -4px;
        padding-left: 5px;
      }

      &:has(+ .highlight) {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
      }
    }
  }
}

</style>
