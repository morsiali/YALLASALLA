import type { CapacitorConfig } from '@capacitor/cli';

// The Android and iOS apps are the SAME web app (web/dist) running in a native WebView shell.
// API_BASE: the native shell has no dev proxy, so set VITE_API_BASE at build time (see docs/OPERATIONS.md).
const config: CapacitorConfig = {
  appId: 'ae.yalasala.app',
  appName: 'Yalasala UAE',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  ios: { contentInset: 'always' },
  android: { allowMixedContent: false },
};
export default config;
