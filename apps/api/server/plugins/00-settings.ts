import { startSettingsLoad } from '../utils/settings';

/**
 * Applies the settings saved on the admin page before the other plugins start. It does not hold the
 * server up: plugins that read configuration at start-up await `settingsReady()` themselves, and
 * everything else reads the environment per request.
 */
export default defineNitroPlugin(() => {
    startSettingsLoad().catch((error) => console.error('[settings] start-up load failed:', error));
});
