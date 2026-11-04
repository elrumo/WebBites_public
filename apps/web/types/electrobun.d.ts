interface ElectronAPI {
  platform: string;
  darkMode: {
    toggle: () => Promise<boolean>;
    system: () => Promise<void>;
  };
  app: {
    getVersion: () => Promise<string>;
  };
  isElectrobun: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
