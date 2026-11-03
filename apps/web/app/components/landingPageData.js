const features = [
  {
      id: 'ai',
      icon: '✨',
      title: "AI-Powered Organization",
      description: "Automatic tag creation and content extraction using AI.",
      image: "/images/ai.jpg"
  },
  {
      id: 'search',
      icon: '🔍',
      title: "Powerful Search",
      description: "Search by tags, full-text search, notes and even color!",
      image: "/images/search.jpg"
  },
  {
      id: 'screenshots',
      icon: '📖',
      title: "Full page screenshots",
      description: "A full page screenshot will be created for every page you save.",
      image: "/images/screenshot.jpg"
  },
  {
      id: 'media',
      icon: '📝 🎬 👾 🌌',
      title: "Multi Media Support",
      description: "Bookmark websites, images, videos, movies, games and more!",
      image: "/images/games.jpg"
  }
]

const moreFeatures = [
  {
      id: 'ai_organisation',
      icon: '🏷️',
      title: "AI Organisation",
      // title: t('landing.features.ai_organization.title'),
      description: "Automatically categorise and tag your bookmarks using advanced AI."
      // description: t('landing.features.ai_organization.description')
  },
//   {
//       icon: '🔍',
//       title: "Smart Search",
//       // title: t('landing.features.smart_search.title'),
//       description: 'Find anything with by searching by tags, full-text search, notes and even color!'
//       // description: t('landing.features.smart_search.description')
//   },
  {
      id: 'cross_platform',
      icon: '📱',
      title: "Cross-Platform Sync",
      // title: t('landing.features.cross_platform.title'),
      description: "Access your bookmarks anywhere, anytime, across all your devices. Web based for now, native apps coming soon."
      // description: t('landing.features.cross_platform.description')
  },
  {
      id: 'reader',
      icon: '📖',
      title: "Reader mode",
      description: "Articles will automtically be formatted for better reading experience, even those behind paywalls!"
  },
  {
      id: 'raycast',
      icon: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M7 18.079V21L0 14L1.46 12.54L7 18.081V18.079ZM9.921 21H7L14 28L15.46 26.54L9.921 21ZM26.535 15.462L27.996 14L13.996 0L12.538 1.466L18.077 7.004H14.73L10.864 3.146L9.404 4.606L11.809 7.01H10.129V17.876H20.994V16.196L23.399 18.6L24.859 17.14L20.994 13.274V9.927L26.535 15.462ZM7.73 6.276L6.265 7.738L7.833 9.304L9.294 7.844L7.73 6.276ZM20.162 18.708L18.702 20.17L20.268 21.738L21.73 20.276L20.162 18.708ZM4.596 9.41L3.134 10.872L7 14.738V11.815L4.596 9.41ZM16.192 21.006H13.268L17.134 24.872L18.596 23.41L16.192 21.006Z" fill="#FF6363"/>
</svg>`,
      title: "Raycast ready",
      description: "With our Raycast extension, all your bookmarks are just one keystroke away!"
  },
  {
      id: 'browsers',
      icon: '<img src="/images/browsers-logos.png" class="w-1/2"/>',
      title: "Browser extensions",
      description: "Save and view your bookmarks from any browser!"
  },
  {
      id: 'colors',
      icon: '<img src="/images/colors.png" class="w-[40%]"/>',
      title: "Extract colors",
      description: "The main colors of all your bookmarks are extracted for you, making it possible to search by color!"
  },
  {
      id: 'tts',
      icon: '🎧',
      title: "Text to speech",
      description: "Listen to your saved articles with our built in text to speech feature!"
  },
  {
      id: 'screenshots',
      icon: '✨',
      title: "Full page screenshots",
      description: "A full page screenshot will be created for every page you save."
  },
  {
      id: 'annotate',
      icon: '✏️',
      title: "Annotate screenshots",
      description: "Clik anywhere on the screenshot to add an annotation."
  },
//   {
//       icon: '🏞️',
//       title: "Save your images",
//       description: "Drag and drop an image to save it, and WebBites will tag it and save it for you!"
//   },
  {
      id: 'ocr',
      icon: '💬',
      title: "OCR",
      description: "Optical Character Recognition (OCR) will be applied to all images saved, making it possible to search them by text."
  },
//   {
//       icon: '📝',
//       title: "Notes",
//       description: "Add notes with a Notion-like rich text editor."
//   },
//   {
//       icon: '🎮',
//       title: "Games",
//       description: "Search an save games as bookmarks"
//   },
//   {
//       icon: '🎬',
//       title: "Movies",
//       description: "Search an save movies as bookmarks"
//   },
//   {
//       icon: '🎸',
//       title: "Music",
//       description: "When saving a song, we will extract the album cover and save it as a bookmark for you!"
//   },
  {
      id: 'pin',
      icon: '📌',
      title: "Pin your bookmarks",
      description: "Pin your bookmarks to the top of your list for easy access."
  },
  {
      id: 'multilingual',
      icon: '🗣️',
      title: "Multi-linugal",
      description: "Support for multiple languages."
  },
]

const whatsNext = [
  {
    icon: '🎬',
    title: "Movies",
    description: "Search an save movies as bookmarks"
  },
  {
      icon: '🎸',
      title: "Music",
      description: "When saving a song, we will extract the album cover and save it as a bookmark for you!"
  },
  {
      icon: '📌',
      title: "Pin your bookmarks",
      description: "Pin your bookmarks to the top of your list for easy access."
  },
  {
      icon: '🗣️',
      title: "Multi-linugal",
      description: "Support for multiple languages."
  }
]

const timelineData = [
  {
    id: "1",
    label: "Capture Instantly",
    description: "Save any digital content with a single click — websites, articles, images, videos, and personal notes.",
    // description: "Capture websites, articles, movies, games, images, and personal notes in one place with our intuitive Notion-like editor.",
    imgUrl: "https://cdn.prod.website-files.com/671f9e6bc06267864b5770e6/67c1ec496b9b203c2873c774_AI%20Article%20Writer%20Component.png"
  },
  {
    id: "2",
    label: "Smart Organization",
    description: "Our AI automatically categorizes, tags, and extracts key information while you focus on what matters.",
    // description: "WebBites will auto-tag your content, capture full-page screenshots, create page summaries and much more.",
    imgUrl: "https://cdn.prod.website-files.com/671f9e6bc06267864b5770e6/67c1ec496b9b203c2873c774_AI%20Article%20Writer%20Component.png"
  },
  {
    id: "3",
    label: "Find in Seconds",
    description: "Powerful smart search bring back exactly what you need, exactly when you need it.",
    // description: "Powerful full-page text search and AI-generated tags make finding any saved content effortless.",
    imgUrl: "https://cdn.prod.website-files.com/671f9e6bc06267864b5770e6/67c1ec496b9b203c2873c774_AI%20Article%20Writer%20Component.png"
  },
];

const faqs = ref([
  {
      question: "How does WebBites organize my bookmarks?",
      answer: "WebBites uses advanced AI technology to automatically categorize and tag your bookmarks based on their content. Our system understands context and creates a smart organization system that makes finding your saved content effortless."
  },
  {
      question: "Is WebBites available on all browsers?",
      answer: "Yes! WebBites offers extensions for Chrome, Firefox, Safari, and Edge. Our platform is designed to work seamlessly across all major browsers."
  },
  {
      question: "Can I access my bookmarks on mobile devices?",
      answer: "Absolutely. WebBites offers native mobile apps for iOS and Android, plus a responsive web application that works on any device with a browser."
  },
  {
      question: "How secure are my bookmarks?",
      answer: "Your data's security is our priority. We use industry-standard encryption to protect your bookmarks and personal information. WebBites never sells your data to third parties."
  },
  {
      question: "Is there a limit to how many bookmarks I can save?",
      answer: "Our free plan includes up to 500 bookmarks. For unlimited bookmarks and advanced features, check out our premium plans."
  }
]);

export default { features, moreFeatures, whatsNext, timelineData, faqs };
