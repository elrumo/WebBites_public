// Map custom icon names to Tabler icons (which are included with Nuxt UI)
const iconMapping = {
    // Common icons
    'add': 'i-tabler-plus',
    'check': 'i-tabler-check',
    'close': 'i-tabler-x',
    'search': 'i-tabler-search',
    'settings': 'i-tabler-settings',
    'trash': 'i-tabler-trash',
    'edit': 'i-tabler-edit',
    'pencil': 'i-tabler-pencil',
    'brush': 'i-tabler-brush',
    'link': 'i-tabler-link',
    'star': 'i-tabler-star',
    'heart': 'i-tabler-heart',
    'home': 'i-tabler-home',
    'house': 'i-tabler-home',
    'user': 'i-tabler-user',
    'person': 'i-tabler-user',
    'email': 'i-tabler-mail',
    'bell': 'i-tabler-bell',
    'calendar': 'i-tabler-calendar',
    'clock': 'i-tabler-clock',
    'folder': 'i-tabler-folder',
    'folders': 'i-tabler-folders',
    'document': 'i-tabler-file',
    'filetext': 'i-tabler-file-text',
    'pdf': 'i-tabler-file-text',
    'photo': 'i-tabler-photo',
    'camera': 'i-tabler-camera',
    'download': 'i-tabler-download',
    'upload': 'i-tabler-upload',
    'cloud': 'i-tabler-cloud',
    'share': 'i-tabler-share',
    'copy': 'i-tabler-copy',
    'pin': 'i-tabler-pin',
    'flag': 'i-tabler-flag',
    'tag': 'i-tabler-tag',
    'tags': 'i-tabler-tags',
    'bookmark': 'i-tabler-bookmark',
    'archive': 'i-tabler-archive',
    'key': 'i-tabler-key',
    'locked': 'i-tabler-lock',
    'unlocked': 'i-tabler-lock-open',
    'eye': 'i-tabler-eye',
    'filters': 'i-tabler-filter',
    'grid': 'i-tabler-grid-dots',
    'list': 'i-tabler-list',

    // Arrows
    'arrowup': 'i-tabler-arrow-up',
    'arrowdown': 'i-tabler-arrow-down',
    'arrowleft': 'i-tabler-arrow-left',
    'arrowright': 'i-tabler-arrow-right',
    'arrowupleft': 'i-tabler-arrow-up-left',
    'arrowupright': 'i-tabler-arrow-up-right',
    'arrowdownleft': 'i-tabler-arrow-down-left',
    'arrowbottomright': 'i-tabler-arrow-down-right',
    'arrowthickup': 'i-tabler-arrow-big-up',
    'arrowthickdown': 'i-tabler-arrow-big-down',
    'arrowthickleft': 'i-tabler-arrow-big-left',
    'arrowthickright': 'i-tabler-arrow-big-right',
    'arrowswitch': 'i-tabler-arrows-exchange',

    // Chevrons
    'chevronup': 'i-tabler-chevron-up',
    'chevrondown': 'i-tabler-chevron-down',
    'chevronleft': 'i-tabler-chevron-left',
    'chevronright': 'i-tabler-chevron-right',
    'chevrondoubleup': 'i-tabler-chevrons-up',
    'chevrondoubledown': 'i-tabler-chevrons-down',
    'chevrondoubleleft': 'i-tabler-chevrons-left',
    'chevrondoubleright': 'i-tabler-chevrons-right',

    // Media controls
    'play': 'i-tabler-player-play',
    'pause': 'i-tabler-player-pause',
    'stop': 'i-tabler-player-stop',
    'music': 'i-tabler-music',
    'musicnote': 'i-tabler-music',
    'microphone': 'i-tabler-microphone',
    'headphones': 'i-tabler-headphones',
    'film': 'i-tabler-movie',
    'radio': 'i-tabler-radio',

    // Text formatting
    'bold': 'i-tabler-bold',
    'italic': 'i-tabler-italic',
    'underline': 'i-tabler-underline',
    'strikethrough': 'i-tabler-strikethrough',
    'textalignleft': 'i-tabler-align-left',
    'textalignright': 'i-tabler-align-right',
    'textaligncenter': 'i-tabler-align-center',
    'textalignjustified': 'i-tabler-align-justified',
    'bulletlist': 'i-tabler-list',
    'h1': 'i-tabler-h-1',
    'h2': 'i-tabler-h-2',
    'h3': 'i-tabler-h-3',
    'code': 'i-tabler-code',

    // Navigation & UI
    'burgermenu': 'i-tabler-menu-2',
    'ellipseshorizontal': 'i-tabler-dots',
    'ellipsesvertical': 'i-tabler-dots-vertical',
    'fullscreen': 'i-tabler-arrows-maximize',
    'fullscreenarrow': 'i-tabler-maximize',
    'closefullscreenarrow': 'i-tabler-minimize',
    'sidebarleft': 'i-tabler-layout-sidebar-left-collapse',
    'sidebarright': 'i-tabler-layout-sidebar-right-collapse',
    'dashboard': 'i-tabler-layout-dashboard',
    'categories': 'i-tabler-category',
    'widgets': 'i-tabler-apps',

    // Devices
    'laptop': 'i-tabler-device-laptop',
    'iphone': 'i-tabler-device-mobile',
    'globe': 'i-tabler-world',
    'earth': 'i-tabler-world',
    'internetbrowser': 'i-tabler-browser',
    'macwindow': 'i-tabler-browser',

    // Shapes
    'circle': 'i-tabler-circle',
    'square': 'i-tabler-square',
    'rectangle': 'i-tabler-rectangle',
    'triangle': 'i-tabler-triangle',
    'triangleup': 'i-tabler-triangle',
    'triangledown': 'i-tabler-triangle-inverted',
    'triangleleft': 'i-tabler-caret-left',
    'triangleright': 'i-tabler-caret-right',

    // Status & Feedback
    'checkwithcircle': 'i-tabler-circle-check',
    'crosswithcircle': 'i-tabler-circle-x',
    'alertwithcircle': 'i-tabler-alert-circle',
    'questionmarkwithcircle': 'i-tabler-help-circle',
    'exclamationmark': 'i-tabler-alert-triangle',

    // Charts & Data
    'chartbar': 'i-tabler-chart-bar',
    'chartpie': 'i-tabler-chart-pie',
    'graphlineup': 'i-tabler-trending-up',
    'graphlinedown': 'i-tabler-trending-down',
    'linechartup': 'i-tabler-trending-up',
    'linechartdown': 'i-tabler-trending-down',

    // Commerce
    'shoppingcartempty': 'i-tabler-shopping-cart',
    'shoppingcartfull': 'i-tabler-shopping-cart',
    'shoppingbasket': 'i-tabler-basket',
    'creditcard': 'i-tabler-credit-card',
    'wallet': 'i-tabler-wallet',
    'moneynote': 'i-tabler-cash',
    'receipt': 'i-tabler-receipt',
    'store': 'i-tabler-building-store',

    // Communication
    'messagebubble': 'i-tabler-message',
    'messagebubble-with-ellipses': 'i-tabler-message-dots',
    'phonecall': 'i-tabler-phone',
    'phonecallin': 'i-tabler-phone-incoming',
    'phonecallout': 'i-tabler-phone-outgoing',

    // Misc
    'lightning': 'i-tabler-bolt',
    'flame': 'i-tabler-flame',
    'lightbulb': 'i-tabler-bulb',
    'magicwand': 'i-tabler-wand',
    'rocket': 'i-tabler-rocket',
    'crown': 'i-tabler-crown',
    'ribbon': 'i-tabler-ribbon-health',
    'shield': 'i-tabler-shield',
    'target': 'i-tabler-target',
    'location': 'i-tabler-map-pin',
    'moon': 'i-tabler-moon',
    'weather': 'i-tabler-sun',
    'loader': 'i-tabler-loader-2',
    'sparks': 'i-tabler-sparkles',
    'sprout': 'i-tabler-plant',
    'beaker': 'i-tabler-flask',
    'hammer': 'i-tabler-hammer',
    'ruler': 'i-tabler-ruler',
    'power': 'i-tabler-power',
    'activity': 'i-tabler-activity',
    'calculator': 'i-tabler-calculator',
    'car': 'i-tabler-car',
    'truck': 'i-tabler-truck',
    'games': 'i-tabler-device-gamepad-2',
    'book': 'i-tabler-book',
    'academicbook': 'i-tabler-book-2',
    'news': 'i-tabler-news',
    'presentation': 'i-tabler-presentation',
    'chip': 'i-tabler-cpu',
    'database': 'i-tabler-database',
    'databse': 'i-tabler-database',
    'connectivity': 'i-tabler-wifi',
    'connections': 'i-tabler-share-3',
    'lifebuoy': 'i-tabler-lifebuoy',
    'peace': 'i-tabler-peace',
    'basketball': 'i-tabler-ball-basketball',
    'sports': 'i-tabler-trophy',
    'medical': 'i-tabler-first-aid-kit',
    'pharmacy': 'i-tabler-pill',
    'healthandfitness': 'i-tabler-heart-rate-monitor',
    'heartbeatmonitor': 'i-tabler-heart-rate-monitor',
    'entertainment': 'i-tabler-movie',
    'productivity': 'i-tabler-briefcase',
    'graphicsanddesign': 'i-tabler-palette',

    // Brands
    'github': 'i-tabler-brand-github',
    'twitter': 'i-tabler-brand-twitter',
    'spotify': 'i-tabler-brand-spotify',
    'apple': 'i-tabler-brand-apple',
    'figma': 'i-tabler-brand-figma',

    // Tray icons
    'tray': 'i-tabler-inbox',
    'inboxtray': 'i-tabler-inbox',
    'outboxtray': 'i-tabler-send',
    'trayandarrowdown': 'i-tabler-inbox',
    'trayandarrowup': 'i-tabler-send',

    // Add to playlist
    'addtoplaylist': 'i-tabler-playlist-add',

    // Default fallback
    'default': 'i-tabler-point',
}

// Pre-compute entries for performance
const iconMappingEntries = Object.entries(iconMapping)

// Cache for resolved icon names
const iconCache = new Map()

/**
 * Resolves an icon name to a Tabler icon class
 * @param {string} iconName - The input icon name
 * @returns {string} The resolved Tabler icon class
 */
export const getIconForName = (iconName) => {
    if (!iconName) return iconMapping['default']

    // Normalize the icon name
    const normalizedName = iconName
        .toLowerCase()
        .replace(/[-_ ]/g, '')
        .replace(/icon$/i, '')

    // Check cache first
    if (iconCache.has(normalizedName)) {
        return iconCache.get(normalizedName)
    }

    let result

    // 1. Try direct mapping
    if (iconMapping[normalizedName]) {
        result = iconMapping[normalizedName]
    } else {
        // 2. Try partial match
        // Use pre-computed entries
        const match = iconMappingEntries.find(([key]) => 
            normalizedName.includes(key) || key.includes(normalizedName)
        )
        
        if (match) {
            result = match[1]
        } else {
            // 3. Fallback: construct tabler icon name
            // Note: input is already lowercased, so camelCase conversion won't happen here
            // but preserving original logic for consistency
            const kebabName = normalizedName
                .replace(/([a-z])([A-Z])/g, '$1-$2')
                .toLowerCase()
            
            result = `i-tabler-${kebabName}`
        }
    }

    // Cache the result
    iconCache.set(normalizedName, result)
    
    return result
}
