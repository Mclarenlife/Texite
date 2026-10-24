import type { CapacitorConfig } from '@capacitor/cli';
const ios = process.argv.includes('ios') || process.env.TEXITE_MOBILE_PLATFORM === 'ios';

const config: CapacitorConfig = {
  appId: ios ? 'com.texite.ios' : 'com.texite.android',
  appName: 'Texite',
  webDir: ios ? 'dist-ios' : 'dist-mobile',
  android: { path: 'apps/android', allowMixedContent: false },
  ios: { path: 'apps/ios', contentInset: 'never', preferredContentMode: 'mobile' },
};
export default config;
