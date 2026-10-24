import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.texite.android',
  appName: 'Texite',
  webDir: 'dist-mobile',
  android: { path: 'apps/android', allowMixedContent: false },
};
export default config;
