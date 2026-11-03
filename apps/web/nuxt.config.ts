// https://nuxt.com/docs/4.x/api/nuxt-config
import { fileURLToPath } from 'node:url'

// Paths in this file are absolute, not `~/...`: `~` means the srcDir of the project being built, so
// when another project extends this one (the hosted overlay) it would look in the wrong place.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

const disableSourceMaps = process.env.NUXT_DISABLE_SOURCEMAPS === '1';

export default defineNuxtConfig({
  // A name for this layer, so a project that extends it can import its files as
  // `#layers/webbites/app/...` (`~` and `@@` mean the extending project's own directories).
  $meta: { name: 'webbites' },

  // ─── Nuxt 4 compatibility ───────────────────────────────────────────
  // Update to a current date (Nuxt 4 requires this)
  compatibilityDate: '2025-06-01',

  app: {
    pageTransition: { name: 'page', mode: 'out-in' },

    head: {
      title: 'WebBites: your library for the web',
      meta: [
        // charset and viewport are now included by Nuxt 4 by default,
        // but we override viewport for custom settings
        { charset: 'utf-8' },
        {
          name: 'viewport',
          content:
            'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
        },
        {
          name: 'description',
          content:
            'Save anything you find, follow the sites you love, and find it all again. A bookmark manager and feed reader in one, organised for you.',
        },

        {
          name: 'theme-color',
          media: '(prefers-color-scheme: light)',
          content: '#FFFFFF',
        },
        {
          name: 'theme-color',
          media: '(prefers-color-scheme: dark)',
          content: '#222222',
        },

        // Facebook / Open Graph Meta Tags
        // Note: OG tags use `property` not `name`
        { property: 'og:type', content: 'website' },
        {
          property: 'og:title',
          content: 'WebBites: your library for the web',
        },
        {
          property: 'og:description',
          content:
            'Save anything you find, follow the sites you love, and find it all again. A bookmark manager and feed reader in one, organised for you.',
        },

        // Twitter Meta Tags
        { name: 'twitter:card', content: 'summary_large_image' },
        {
          name: 'twitter:title',
          content: 'WebBites: your library for the web',
        },
        {
          name: 'twitter:description',
          content:
            'Save anything you find, follow the sites you love, and find it all again. A bookmark manager and feed reader in one, organised for you.',
        },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'manifest', href: '/manifest.json' },
      ],
      script: [
        // MS Clarity is now loaded conditionally via CookieCard component based on user consent
      ],
    },
  },

  telemetry: false,

  // ─── Components ─────────────────────────────────────────────────────
  // In Nuxt 4, components in ~/components/global/ are auto-registered
  // as global. The default config handles this, but if you need ALL
  // components to be global:
  components: [
    {
      global: true,
      path: here('./app/components'),
      pathPrefix: false,
    },
  ],

  // ─── Vite ───────────────────────────────────────────────────────────
  vite: {
    optimizeDeps: {
      include: [
        'clsx',
        'tailwind-merge',
        'lodash', // CJS
        '@tiptap/vue-3',
        '@tiptap/starter-kit',
        '@tiptap/extension-heading',
        '@tiptap/extension-link',
        '@tiptap/extension-list',
        '@tiptap/extension-highlight',
        '@tiptap/extension-image',
        '@tiptap/extensions',
        '@tiptap/extension-drag-handle',
        '@tiptap/extension-node-range',
        'highlight.js/lib/core',
        'highlight.js/lib/languages/bash',
        'highlight.js/lib/languages/css',
        'highlight.js/lib/languages/javascript',
        'highlight.js/lib/languages/json',
        'highlight.js/lib/languages/python',
        'highlight.js/lib/languages/typescript',
        'highlight.js/lib/languages/xml',
        '@tiptap/extension-code-block',
        'lowlight',
        '@tiptap/vue-3/menus',
        '@tiptap/core',
        '@vue/devtools-core',
        '@vue/devtools-kit',
        'vue-easy-lightbox',
        'vue-virtual-scroller',
        '@braks/revue-draggable',
        'parse', // CJS
        'file-saver', // CJS
        'fuse.js',
        'micromark',
        'parse/dist/parse.min.js', // CJS
        'party-js', // CJS
        '@vueuse/core',
        'vanilla-tilt',
        'interactjs', // CJS
        'gsap',
        'vue-sound',
        'vue3-circle-progress', // CJS
      ]
    },
    css: {
      preprocessorOptions: {
        scss: {
          quietDeps: true,
        },
      },
    },
    clearScreen: false,
    envPrefix: ['VITE_'],

    // server: {
    //   strictPort: true,
    //   host: '0.0.0.0',
    // },
  },

  // @tailwindcss/vite only transforms *.css ids; SFC <style lang="scss"> blocks
  // are skipped, so @apply in them needs the PostCSS plugin.
  postcss: {
    plugins: {
      '@tailwindcss/postcss': {},
    },
  },

  // ─── CSS ────────────────────────────────────────────────────────────
  css: [
    here('./app/assets/css/transitions.css'),
    here('./app/assets/css/tailwind.css'), 
    here('./app/assets/css/main.css')],


  // ─── Nuxt UI ────────────────────────────────────────────────────────
  // Register every color token used by U* components so the v4 theme
  // generator can emit the matching variant classes.
  ui: {
    theme: {
      colors: [
        'primary',
        'secondary',
        'success',
        'info',
        'warning',
        'error',
        'red',
        'green',
        'blue',
        'amber',
        'orange',
        'gray',
      ],
      defaultVariants: {
        color: 'primary',
        size: 'sm',
      },
    },
  },

  // ─── i18n ───────────────────────────────────────────────────────────
  i18n: {
    // bundle: {
    //   optimizeTranslationDirective: false,
    // },

    // A few messages (FAQ answers, the browser export guide) carry our own inline
    // <a>/<strong>/<kbd> markup and are rendered with v-html. Strict mode would
    // reject the whole locale file over them.
    compilation: {
      strictMessage: false,
    },

    locales: [
      {
        code: 'en-GB',
        label: '🇬🇧 English',
        file: 'en.json',
      },
      // Listed before es-ES on purpose: browser detection exact-matches first and then
      // falls back to the first locale sharing the language, so es-MX/es-AR/... land
      // here while an es-ES browser still gets Spain's Spanish.
      {
        code: 'es-419',
        label: '🌎 Español (Latinoamérica)',
        file: 'es-419.json',
      },
      {
        code: 'es-ES',
        label: '🇪🇸 Español (España)',
        file: 'es.json',
      },
      {
        code: 'ca',
        label: '🇦🇩 Català',
        file: 'ca.json',
      },
      {
        code: 'zh',
        label: '🇨🇳 中文',
        file: 'zh.json',
      },
      {
        code: 'ja',
        label: '🇯🇵 日本語',
        file: 'ja.json',
      },
      {
        code: 'ko',
        label: '🇰🇷 한국어',
        file: 'ko.json',
      },
      {
        code: 'fr',
        label: '🇫🇷 Français',
        file: 'fr.json',
      },
      {
        code: 'de',
        label: '🇩🇪 Deutsch',
        file: 'de.json',
      },
    ],
    defaultLocale: 'en-GB',
    skipSettingLocaleOnNavigate: false,
    strategy: 'no_prefix',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root',
    },
  },

  // ─── Nitro ──────────────────────────────────────────────────────────
  nitro: {
    experimental: {
      openAPI: true,
    },
    vercel: {
      functions: {
        maxDuration: 60,
      },
    },
    routeRules: {
      // The library is rendered per user and per bookmark: served from a cache
      // (the browser's, a proxy's) it comes back with whatever bookmarks the
      // page had when it was built, which is why the newest ones only showed
      // up on a second reload. The client revalidates anyway; this stops the
      // stale paint that preceded it.
      '/app': {
        headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
      },
      '/.well-known/apple-app-site-association': {
        headers: { 'content-type': 'application/json' },
      },
      // The consent page an AI assistant sends you to. Never inside a frame
      // (an invisible one over "Approve" is the classic clickjack), never
      // cached, and the request id in its URL is not passed on as a referrer.
      '/oauth/**': {
        headers: {
          'x-frame-options': 'DENY',
          'content-security-policy': "frame-ancestors 'none'",
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        },
      },
    },
    // rollupConfig: {
    //   external: ['re2'],
    // },
    alias: {
      're2': 'unenv/runtime/mock/empty',
    },
    externals: {
      inline: ['cheerio', 'ofetch', 'ipx', 'jose'],
    },
  },

  // ─── Modules ────────────────────────────────────────────────────────
  modules: [
    '@nuxt/ui',
    '@nuxt/image',
    '@nuxtjs/device',
    'motion-v/nuxt',
    '@nuxtjs/i18n',
    '@pinia/nuxt',
    
    // 'z-vue-scan-nuxt-module',
    // '@sentry/nuxt/module',
  ],

  // ─── Runtime Config ─────────────────────────────────────────────────
  runtimeConfig: {
    // Private keys (server-only)
    parseMasterKey: process.env.PARSE_MASTER_KEY || '',
    // LLM calls go through the LiteLLM proxy
    litellmApiKey: process.env.LITELLM_API_KEY || '',
    litellmApiBaseUrl: process.env.LITELLM_API_BASE_URL || '',
    // Same text model as the backend (its LITELLM_TEXT_MODEL / LITELLM_TEXT_VENDOR)
    litellmTextModel: process.env.LITELLM_TEXT_MODEL || '',
    litellmTextVendor: process.env.LITELLM_TEXT_VENDOR || '',
    appUrl: process.env.VITE_APP_URL || '',
    // How this server reaches the API and Parse inside the Docker network (the browser uses the
    // public addresses below). Empty means "use the public address".
    backendInternalUrl: process.env.BACKEND_INTERNAL_URL || '',
    parseInternalUrl: process.env.PARSE_INTERNAL_URL || '',
    // HelpBites project secret (sk_…): signs the identity tokens for the chat and
    // the feedback board (GET /api/support/token). Server only. Optional: with no
    // HELPBITES_* the support chat and feedback board are simply not shown.
    helpbitesPrivateKey: process.env.HELPBITES_PRIVATE_KEY || '',

    // Keys within public are also exposed client-side
    public: {
      // HelpBites (support chat + feedback board): where it runs and this app's public key
      helpbitesApiUrl: process.env.HELPBITES_API_URL || '',
      helpbitesPublicKey: process.env.HELPBITES_PUBLIC_KEY || '',
      backendUrl: process.env.VITE_BACKEND_URL || '',
      appUrl: process.env.VITE_APP_URL || '',
      parseAppId: process.env.VITE_PARSE_ID || '',
      parseJsKey: process.env.VITE_PARSE_JS_KEY || '',
      parseServerUrl: process.env.VITE_PARSE_URL || '',
      parseLiveServerUrl: process.env.VITE_PARSE_LIVESERVER_URL || '',
      // Numeric App Store id behind Safari's native Smart App Banner. Empty
      // means the banner is simply not rendered.
      appleAppId: process.env.VITE_APPLE_APP_ID || '',
      // This installation is a self-hosted one (no marketing site, no pricing). On by default;
      // a deployment that runs the hosted service sets SELF_HOSTED=false.
      selfHosted: process.env.SELF_HOSTED !== 'false',
    },
  },

  devtools: { enabled: true },

  // ─── Dev Server ─────────────────────────────────────────────────────
  // Enables the development server to be discoverable by other devices
  // when running on iOS physical devices
  // devServer: {
  //   host: '0',
  // },

  // ─── Experimental ───────────────────────────────────────────────────
  // Note: `watcher: 'parcel'` was removed — Nuxt 4 uses its own
  // optimised native file watching by default.
  // The following experimental flags from Nuxt 3 have been removed
  // in Nuxt 4 (they are now the default or no longer needed):
  //   - treeshakeClientOnly
  //   - configSchema
  //   - polyfillVueUseHead
  //   - respectNoSSRHeader

  // ─── Sentry ─────────────────────────────────────────────────────────
  // sentry: {
  //   sourceMapsUploadOptions: {
  //     // org: 'webbites',
  //     // project: 'javascript-vue',
  //     telemetry: false,
  //   },
  //   autoInjectServerSentry: 'top-level-import',
  // },

  // ─── Source Maps ────────────────────────────────────────────────────
  sourcemap: disableSourceMaps
    ? false
    : {
        client: 'hidden',
      },
});
