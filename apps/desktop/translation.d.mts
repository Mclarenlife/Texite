export type Provider = 'libre' | 'ai' | 'deepl';
export type Target = 'zh' | 'en' | 'ja' | 'de' | 'fr';
export type TranslationConfig = { provider: Provider; target: Target; url: string; model: string };
export type Stored = TranslationConfig & { apiKey: string };
export type PublicConfig = TranslationConfig & { hasKey: boolean; persistent: boolean };
export interface TranslationAPI {
  get(): Promise<PublicConfig>;
  save(config: Stored & { clearKey?: boolean }): Promise<PublicConfig>;
  translate(id: string, text: string): Promise<string>;
  cancel(id: string): void | Promise<void>;
}
export const languages: Record<Target, string>;
export const providers: Record<Provider, string>;
export const defaults: Stored;
export function createTranslationService(
  storage: {
    read(): Stored | null | Promise<Stored | null>;
    write(config: Stored): void | Promise<void>;
    persistent(): boolean;
  },
  fetcher?: typeof fetch,
): TranslationAPI;
