import {
  createTranslationService,
  type TranslationConfig,
} from '../../apps/desktop/translation.mjs';
const key = 'texite.translation';
const browser = createTranslationService({
  persistent: () => false,
  read() {
    const value = localStorage.getItem(key);
    return value ? { ...(JSON.parse(value) as TranslationConfig), apiKey: '' } : null;
  },
  write({ apiKey: _key, ...config }) {
    localStorage.setItem(key, JSON.stringify(config));
  },
});
export const translationAPI = () => window.texite?.translation ?? browser;
