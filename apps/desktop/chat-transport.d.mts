export type ChatSettings = { baseURL: string; model: string; apiKey?: string };
export function chatEndpoint(baseURL: string): string;
export function streamChat(
  config: ChatSettings,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  onText: (text: string) => void,
  signal: AbortSignal,
  fetcher?: typeof fetch,
): Promise<void>;
