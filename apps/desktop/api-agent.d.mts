import type { AIEvent, ChatConfig, ChatMessage } from '../../packages/core/ai';
export function validateRounds(value: number): number;
export function runAPIAgent(
  config: ChatConfig,
  input: { messages: ChatMessage[]; maxRounds: number },
  emit: (
    event:
      | Omit<Extract<AIEvent, { type: 'text' }>, 'runId' | 'projectId'>
      | Omit<Extract<AIEvent, { type: 'activity' }>, 'runId' | 'projectId'>
      | Omit<Extract<AIEvent, { type: 'usage' }>, 'runId' | 'projectId'>,
  ) => void,
  execute: (
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<{ success: boolean; value: unknown }>,
  signal: AbortSignal,
  fetcher?: typeof fetch,
): Promise<void>;
