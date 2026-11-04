export type Platform = 'web' | 'electrobun';

export interface PlatformAPI {
  platform: Platform;
  isWeb: boolean;
  isElectrobun: boolean;
  isNative: boolean;
  isMacOS: boolean;
  isWindows: boolean;
  isLinux: boolean;
}

export const usePlatform = (): PlatformAPI => {
  const isElectrobun = typeof window !== 'undefined' && 
    'electronAPI' in window && 
    window.electronAPI?.isElectrobun === true;

  const isWeb = !isElectrobun;

  let platform: Platform = 'web';
  if (isElectrobun) platform = 'electrobun';

  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const isMacOS = /mac|macintosh|darwin/.test(userAgent) || 
    (isElectrobun && window.electronAPI?.platform === 'darwin');
  const isWindows = /win/.test(userAgent) || 
    (isElectrobun && window.electronAPI?.platform === 'win32');
  const isLinux = /linux/.test(userAgent) || 
    (isElectrobun && window.electronAPI?.platform === 'linux');

  return {
    platform,
    isWeb,
    isElectrobun,
    isNative: isElectrobun,
    isMacOS,
    isWindows,
    isLinux
  };
};

export const useElectrobunAPI = () => {
  if (typeof window === 'undefined' || !window.electronAPI) {
    return null;
  }
  return window.electronAPI;
};
