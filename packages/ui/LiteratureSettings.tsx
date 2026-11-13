import { useState } from 'react';
import type { AIController } from '../workbench/useAI';
import { AgentSettings } from './AgentSettings';
import { ChatProfileSettings } from './ChatProfileSettings';
import { Select } from './Select';
import './literature.css';

export type LiteratureMode = 'cli' | 'api';
export function LiteratureSettings({
  ai,
  mode,
  onMode,
}: {
  ai: AIController;
  mode: LiteratureMode;
  onMode(mode: LiteratureMode): void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="literature-settings">
      <h3>文献检索</h3>
      <p>与 AI 对话共用连接配置。检索时，AI 读取文章节选，Crossref 接收检索词。</p>
      <label>
        AI 接入方式
        <Select
          aria-label="文献检索接入方式"
          value={mode}
          onValueChange={(v) => {
            onMode(v as LiteratureMode);
            setEditing(false);
          }}
        >
          <option value="api">API</option>
          {window.texite?.ai && <option value="cli">本机 CLI</option>}
        </Select>
      </label>
      {mode === 'api' && ai.chatProfiles.length > 0 && (
        <label>
          对话 API
          <Select
            aria-label="文献检索 API"
            value={ai.chatConfig.id || ''}
            onValueChange={(id) => void ai.selectChatProfile(id)}
          >
            {ai.chatProfiles.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name || p.model}
              </option>
            ))}
          </Select>
        </label>
      )}
      {mode === 'cli' && <p>当前程序 · {ai.agentConfig.command || ai.agentConfig.preset}</p>}
      {editing ? (
        mode === 'cli' ? (
          <AgentSettings ai={ai} onDone={() => setEditing(false)} />
        ) : (
          <ChatProfileSettings ai={ai} onSaved={() => setEditing(false)} />
        )
      ) : (
        <button className="secondary-button" onClick={() => setEditing(true)}>
          {mode === 'cli' ? '配置 CLI' : '配置 API'}
        </button>
      )}
    </section>
  );
}
