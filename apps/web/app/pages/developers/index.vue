<template>
  <div class="dev-landing dark">
    <LandingNavBar :isLandingPage="false" />
    <img
      class="pointer-events-none fixed left-0 top-0 h-screen w-screen opacity-40 mix-blend-multiply"
      src="/images/grain_2.webp"
      alt=""
    >

    <!-- Hero -->
    <header class="dev-hero">
      <span class="dev-eyebrow">
        <span class="dev-dot" aria-hidden="true" />
        WebBites API
      </span>

      <h1 class="dev-hero-title">
        Your library,
        <span class="block landing-page-title text-shadow-green">programmable.</span>
      </h1>

      <p class="hero-subtitle">
        Save a page from anything that can make an HTTP request, search everything you have ever saved,
        and get a signed webhook the moment a bookmark comes back with its screenshot, summary and tags.
      </p>

      <div class="flex flex-wrap items-center justify-center gap-3 pt-2">
        <UButton to="/developers/docs/quickstart" color="neutral" size="lg" class="rounded-xl font-bold">
          Start building
        </UButton>
        <UButton to="/developers/docs" color="neutral" variant="outline" size="lg" class="rounded-xl font-bold">
          Read the docs
        </UButton>
        <UButton
          :to="OPENAPI_URL"
          target="_blank"
          color="neutral"
          variant="ghost"
          size="lg"
          icon="i-heroicons-book-open"
          class="rounded-xl font-bold"
        >
          OpenAPI
        </UButton>
      </div>

      <div class="dev-baseurl">
        <span class="text-neutral-500">Base URL</span>
        <code>{{ API_BASE_URL }}</code>
      </div>
    </header>

    <!-- First call -->
    <section class="dev-section">
      <div class="dev-split">
        <div class="flex flex-col gap-4">
          <h2 class="dev-h2">Two calls is most of it</h2>
          <p class="dev-p">
            One to save something, one to read it back. Authenticate with a key in a header, get JSON,
            done — there is no SDK to install and no OAuth dance to implement.
          </p>
          <ul class="dev-list">
            <li v-for="line in FIRST_CALL_POINTS" :key="line">{{ line }}</li>
          </ul>
          <div>
            <UButton to="/developers/docs/quickstart" color="neutral" variant="soft" class="font-semibold">
              Full quickstart
            </UButton>
          </div>
        </div>

        <DevCode :tabs="HERO_TABS" />
      </div>
    </section>

    <!-- Capabilities -->
    <section class="dev-section">
      <div class="dev-section-head">
        <h2 class="dev-h2">What the API gives you</h2>
        <p class="dev-p">Four things, and everything below is built out of them.</p>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <div v-for="item in CAPABILITIES" :key="item.title" class="dev-card">
          <UIcon :name="item.icon" class="size-6 text-green-300" />
          <h3 class="dev-card-title">{{ item.title }}</h3>
          <p class="dev-card-text">{{ item.text }}</p>
          <code class="dev-card-code">{{ item.endpoint }}</code>
        </div>
      </div>

      <!-- The no-code route to the same library: an AI assistant over MCP. -->
      <NuxtLink to="/developers/docs/mcp" class="dev-doclink group">
        <div class="flex items-center gap-3">
          <UIcon name="i-heroicons-sparkles" class="size-5 text-green-300" />
          <h3 class="dev-card-title">Rather ask an AI?</h3>
          <UIcon name="i-heroicons-arrow-right" class="ml-auto size-4 text-neutral-600 transition group-hover:text-green-300" />
        </div>
        <p class="dev-card-text">
          Connect Claude, ChatGPT, Cursor or VS Code to your library through the MCP server at
          <code class="dev-inline-code">{{ MCP_URL }}</code> and search, save and organise by asking. No code, same allowance.
        </p>
      </NuxtLink>
    </section>

    <!-- Enriched payload -->
    <section class="dev-section">
      <div class="dev-split">
        <div class="flex flex-col gap-4">
          <h2 class="dev-h2">Every save comes back enriched</h2>
          <p class="dev-p">
            You post a URL. We fetch the page, screenshot it, summarise it and tag it, then hand the whole
            thing back — through a webhook if you registered one, or the next time you read the bookmark.
          </p>
          <ul class="dev-list">
            <li v-for="line in ENRICHED_POINTS" :key="line">{{ line }}</li>
          </ul>
          <div>
            <UButton to="/developers/docs/webhooks" color="neutral" variant="soft" class="font-semibold">
              How webhooks work
            </UButton>
          </div>
        </div>

        <DevCode :code="WEBHOOK_PAYLOAD" language="json" label="bookmark.saved" />
      </div>
    </section>

    <!-- Ideas -->
    <section class="dev-section">
      <div class="dev-section-head">
        <h2 class="dev-h2">Things worth building</h2>
        <p class="dev-p">
          All of these are an afternoon's work against two endpoints. The
          <NuxtLink to="/developers/docs/recipes" class="dev-link">recipes</NuxtLink> have every one of
          them written out in full, in JavaScript and Python.
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="idea in IDEAS" :key="idea.title" class="dev-idea">
          <span class="dev-idea-emoji" aria-hidden="true">{{ idea.emoji }}</span>
          <h3 class="dev-card-title">{{ idea.title }}</h3>
          <p class="dev-card-text">{{ idea.text }}</p>
          <code class="dev-idea-code">{{ idea.uses }}</code>
        </div>
      </div>
    </section>

    <!-- Limits -->
    <section class="dev-section">
      <div class="dev-section-head">
        <h2 class="dev-h2">Limits, in the open</h2>
        <p class="dev-p">
          A burst limit per minute and a total per month, both following your plan. Every response carries
          the headers that track them.
        </p>
      </div>

      <div class="dev-limits">
        <table class="dev-table">
          <thead>
            <tr><th>Plan</th><th>Per minute</th><th>Per month</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in RATE_LIMITS" :key="row.plan">
              <td class="capitalize">{{ row.plan }}</td>
              <td>{{ row.perMinute.toLocaleString() }}</td>
              <td>{{ row.perMonth.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
        <p class="dev-p text-sm">
          Over the limit you get a <code class="dev-inline-code">429</code> with a
          <code class="dev-inline-code">Retry-After</code>. Your own usage is on
          <NuxtLink to="/developers/docs/usage" class="dev-link">the usage page</NuxtLink>.
        </p>
      </div>
    </section>

    <!-- Docs entry points -->
    <section class="dev-section">
      <div class="dev-section-head">
        <h2 class="dev-h2">The documentation</h2>
        <p class="dev-p">Guides, a playground, your keys and the full endpoint reference.</p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <NuxtLink v-for="link in DOC_LINKS" :key="link.to" :to="link.to" class="dev-doclink group">
          <div class="flex items-center gap-3">
            <UIcon :name="link.icon" class="size-5 text-green-300" />
            <h3 class="dev-card-title">{{ link.title }}</h3>
            <UIcon name="i-heroicons-arrow-right" class="ml-auto size-4 text-neutral-600 transition group-hover:text-green-300" />
          </div>
          <p class="dev-card-text">{{ link.text }}</p>
        </NuxtLink>
      </div>
    </section>

    <!-- CTA -->
    <section class="dev-cta">
      <h2 class="landing-page-title text-4xl font-bold md:text-5xl">Make a key. Save a page.</h2>
      <p class="hero-subtitle">
        Keys are free on every plan, and the first request takes about a minute from here.
      </p>
      <div class="flex flex-wrap justify-center gap-4 pt-2">
        <UButton to="/developers/docs/api-keys" color="neutral" size="lg" class="rounded-xl font-bold">
          Get an API key
        </UButton>
        <UButton to="/developers/docs/playground" color="neutral" variant="outline" size="lg" class="rounded-xl font-bold">
          Try the playground
        </UButton>
      </div>
    </section>

    <LandingFooter />
  </div>
</template>

<script setup>
import { API_BASE_URL, OPENAPI_URL, RATE_LIMITS, WEBHOOK_PAYLOAD, MCP_URL } from '~/utils/devApi'
import DevCode from '~/components/developers/DevCode.vue'

useHead({
  title: 'WebBites - Developers',
  meta: [
    {
      name: 'description',
      content: 'Save, search and sync bookmarks from your own scripts, apps and automations with the WebBites API.',
    },
  ],
})

const FIRST_CALL_POINTS = [
  'REST over HTTPS. JSON in, JSON out.',
  'One header: Authorization: Bearer wb_live_…',
  'Keys are free on every plan, and revoking one is instant.',
]

const HERO_TABS = [
  {
    label: 'cURL',
    language: 'bash',
    code: `# Save a page
curl -X POST ${API_BASE_URL}/bookmarks \\
  -H "Authorization: Bearer $WEBBITES_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://nuxt.com","tags":["reading"]}'

# Read it back
curl -G ${API_BASE_URL}/bookmarks \\
  -H "Authorization: Bearer $WEBBITES_KEY" \\
  --data-urlencode "q=nuxt"`,
  },
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `const headers = {
  Authorization: \`Bearer \${process.env.WEBBITES_KEY}\`,
  'Content-Type': 'application/json',
}

// Save a page
await fetch('${API_BASE_URL}/bookmarks', {
  method: 'POST',
  headers,
  body: JSON.stringify({ url: 'https://nuxt.com', tags: ['reading'] }),
})

// Read it back
const { bookmarks } = await fetch('${API_BASE_URL}/bookmarks?q=nuxt', { headers })
  .then(r => r.json())`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import os, requests

headers = {"Authorization": f"Bearer {os.environ['WEBBITES_KEY']}"}

# Save a page
requests.post(
    "${API_BASE_URL}/bookmarks",
    json={"url": "https://nuxt.com", "tags": ["reading"]},
    headers=headers,
    timeout=30,
)

# Read it back
bookmarks = requests.get(
    "${API_BASE_URL}/bookmarks", params={"q": "nuxt"}, headers=headers, timeout=30
).json()["bookmarks"]`,
  },
]

const CAPABILITIES = [
  {
    icon: 'i-heroicons-bookmark',
    title: 'Save anything',
    text: 'POST a URL and it lands in your library, enriched exactly like a save from the app: screenshot, summary, automatic tags.',
    endpoint: 'POST /bookmarks',
  },
  {
    icon: 'i-heroicons-magnifying-glass',
    title: 'Search everything',
    text: 'Full-text search, filter by tag or type, and page through the whole library with a cursor.',
    endpoint: 'GET /bookmarks?q=…',
  },
  {
    icon: 'i-heroicons-bolt',
    title: 'React to saves',
    text: 'Register an endpoint and we POST the finished bookmark to it, signed with HMAC-SHA256 so you can prove it came from us.',
    endpoint: 'POST /webhooks',
  },
  {
    icon: 'i-heroicons-chart-bar',
    title: 'Know where you stand',
    text: 'Your plan, its limits and what you have spent this month, broken down by key.',
    endpoint: 'GET /usage',
  },
]

const ENRICHED_POINTS = [
  'Title, description, favicon and preview image pulled from the page.',
  'A full-page screenshot, so a dead link is still readable.',
  'A summary and automatic tags, on top of any tags you passed.',
  'A signed delivery with a unique id, so retries are easy to de-duplicate.',
]

const IDEAS = [
  { emoji: '💬', title: 'A /save command in Slack', text: 'Drop a link in a channel and have it filed, tagged and summarised before anyone replies.', uses: 'POST /bookmarks' },
  { emoji: '📬', title: 'A weekly digest', text: 'Everything you saved this week, grouped by tag, mailed to yourself on Friday.', uses: 'GET /bookmarks' },
  { emoji: '🗂️', title: 'A public reading list', text: 'Build a page on your own site from a tag. New save, new entry, no CMS.', uses: 'GET /bookmarks?tag=' },
  { emoji: '⭐', title: 'Mirror your GitHub stars', text: 'Star a repository, get a bookmark tagged with its language and description.', uses: 'POST /bookmarks' },
  { emoji: '🧠', title: 'Sync into your notes', text: 'Write every new save into Obsidian or Notion as markdown, summary and all, from a webhook.', uses: 'bookmark.saved' },
  { emoji: '💾', title: 'Nightly backups', text: 'Walk the cursor once a night and keep your whole library as JSON on a disk you own.', uses: 'GET /bookmarks' },
]

const DOC_LINKS = [
  { to: '/developers/docs/quickstart', icon: 'i-heroicons-rocket-launch', title: 'Quickstart', text: 'A key, a curl and a saved bookmark in about two minutes.' },
  { to: '/developers/docs/recipes', icon: 'i-heroicons-beaker', title: 'Recipes', text: 'Six complete programs in JavaScript and Python: a Slack command, a digest, a reading list, a star mirror, a notes sync, a backup.' },
  { to: '/developers/docs/endpoints', icon: 'i-heroicons-command-line', title: 'Endpoints', text: 'Every route, its parameters and a sample response.' },
  { to: '/developers/docs/playground', icon: 'i-heroicons-play', title: 'Playground', text: 'Send a real request from the browser and read what comes back.' },
]
</script>

<style scoped>
@reference "../../assets/css/tailwind.css";

.dev-landing {
  @apply relative min-h-screen bg-neutral-800 text-white;
  /* main.css colours h1-h6 and p from --text-color, which nothing sets outside
     the landing wrapper — pin the dark value, as .landing-page-wrapper does. */
  --text-color: var(--color--gray-10, #efefef);
}

.dev-hero {
  @apply relative z-[1] mx-auto flex w-[90%] max-w-3xl flex-col items-center gap-4 px-4 pb-10 pt-24 text-center md:pt-32;
}

.dev-eyebrow {
  @apply flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-neutral-300;
}
.dev-dot { @apply size-1.5 rounded-full bg-green-400; box-shadow: 0 0 12px rgba(65, 217, 118, 0.8); }

.dev-hero-title { @apply text-5xl font-black leading-[0.95] tracking-tight md:text-7xl; }

.dev-baseurl {
  @apply mt-4 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-xs;
}
.dev-baseurl code { @apply font-mono text-green-200; }

.dev-section {
  @apply relative z-[1] mx-auto flex w-[90%] max-w-5xl flex-col gap-6 py-14 md:py-20;
}

.dev-section-head { @apply flex max-w-2xl flex-col gap-2; }

.dev-h2 { @apply text-3xl font-bold tracking-tight text-white md:text-4xl; }
.dev-p { @apply max-w-2xl text-[17px] leading-relaxed text-neutral-400; }

.dev-link { @apply text-green-300 underline underline-offset-4 decoration-green-300/40 hover:decoration-green-300; }
.dev-inline-code { @apply rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.85em] text-green-200; }

.dev-split { @apply grid items-start gap-8 lg:grid-cols-2 lg:gap-12; }

.dev-list { @apply flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-neutral-400; }
.dev-list li::marker { @apply text-green-400/70; }

.dev-card {
  @apply flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition duration-300;
  @apply hover:-translate-y-1 hover:border-green-400/40 hover:bg-white/[0.06];
}
.dev-card-title { @apply text-lg font-bold text-white; }
.dev-card-text { @apply text-[15px] leading-relaxed text-neutral-400; }
.dev-card-code {
  @apply mt-1 w-fit rounded-lg border border-white/10 bg-black/40 px-2.5 py-1 font-mono text-xs text-green-200;
}

.dev-idea {
  @apply flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition duration-300;
  @apply hover:border-green-400/40 hover:bg-white/[0.06];
}
.dev-idea-emoji { @apply text-2xl leading-none; }
.dev-idea-code { @apply mt-auto pt-2 font-mono text-xs text-neutral-500; }

.dev-doclink {
  @apply flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition duration-300;
  @apply hover:border-green-400/40 hover:bg-white/[0.06];
}

.dev-limits {
  @apply flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6;
}
.dev-table { @apply w-full border-collapse text-left text-sm; }
.dev-table th {
  @apply border-b border-white/10 pb-2 pr-6 text-xs font-semibold uppercase tracking-wider text-neutral-500;
}
.dev-table td { @apply border-b border-white/5 py-2.5 pr-6 text-neutral-300; }
.dev-table tr:last-child td { @apply border-b-0; }

.dev-cta {
  @apply relative z-[1] mx-auto flex w-[90%] max-w-2xl flex-col items-center gap-4 py-24 text-center;
}

@media (prefers-reduced-motion: reduce) {
  .dev-card, .dev-idea, .dev-doclink { transition: none; }
  .dev-card:hover { transform: none; }
  .text-shadow-green { animation: none; }
}
</style>
