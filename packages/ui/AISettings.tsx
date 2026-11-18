import { useState } from 'react';
import type { AIController } from '../workbench/useAI';
import { AgentSettings } from './AgentSettings';
import { ChatProfileSettings } from './ChatProfileSettings';
import { LiteratureSettings, type LiteratureMode } from './LiteratureSettings';
import { TranslationSettings } from './TranslationSettings';
import { ReasoningSelect } from './ReasoningSelect';
import { Select } from './Select';
import './ai.css';

const sections = [
  { id: 'chat', label: 'AI 对话' },
  { id: 'translation', label: '翻译' },
  { id: 'literature', label: '文献检索' },
];

export function AISettings({
  ai,
  literatureMode,
  onLiteratureMode,
  initialSection,
}: {
  ai: AIController;
  literatureMode: LiteratureMode;
  onLiteratureMode(mode: LiteratureMode): void;
  initialSection?: string;
}) {
  const [section, setSection] = useState(
    initialSection === 'translation' || initialSection === 'literature' ? initialSection : 'chat',
  );
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const desktop = !!window.texite?.ai;
  const provider = desktop ? ai.chatProvider : 'api';
  const models = ai.connection?.models || [];
  const model =
    models.find((m) => m.id === ai.model) || models.find((m) => m.isDefault) || models[0];
  return (
    <div className="ai-settings-page">
      <div className="ai-settings-tabs" role="tablist" aria-label="AI 配置分类">
        {sections.map((item, index) => (
          <button
            type="button"
            role="tab"
            key={item.id}
            id={'ai-settings-tab-' + item.id}
            aria-controls={'ai-settings-section-' + item.id}
            aria-selected={section === item.id}
            tabIndex={section === item.id ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const next =
                (index + (e.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
              setSection(sections[next].id);
              setEditing(false);
              setError('');
              (e.currentTarget.parentElement!.children[next] as HTMLButtonElement).focus();
            }}
            onClick={() => {
              setSection(item.id);
              setEditing(false);
              setError('');
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={'ai-settings-section-' + section}
        aria-labelledby={'ai-settings-tab-' + section}
      >
        {section === 'translation' && <TranslationSettings />}
        {section === 'literature' && (
          <LiteratureSettings ai={ai} mode={literatureMode} onMode={onLiteratureMode} />
        )}
        {section === 'chat' && (
          <section className="literature-settings">
            <h3>AI 对话</h3>
            <label>
              接入方式
              <Select
                aria-label="AI 对话接入方式"
                value={provider}
                disabled={ai.busy}
                onValueChange={(v) => {
                  ai.setChatProvider(v as 'codex' | 'api');
                  setEditing(false);
                }}
              >
                {desktop && <option value="codex">本机 CLI</option>}
                <option value="api">API</option>
              </Select>
            </label>
            {provider === 'codex' ? (
              <>
                <p>当前程序 · {ai.agentConfig.command || ai.agentConfig.preset}</p>
                <label>
                  模型
                  <Select
                    aria-label="AI 对话模型"
                    value={model?.id || ''}
                    disabled={ai.busy || !models.length}
                    onValueChange={ai.setModel}
                  >
                    {!models.length && <option value="">连接后选择模型</option>}
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label>
                  思考强度
                  <ReasoningSelect ai={ai} />
                </label>
                {editing ? (
                  <AgentSettings ai={ai} onDone={() => setEditing(false)} />
                ) : (
                  <div className="ai-inline-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setEditing(true)}
                    >
                      配置 CLI
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={ai.busy || ai.connecting}
                      onClick={() => void ai.connect()}
                    >
                      {ai.connecting
                        ? '连接中…'
                        : ai.connection?.connected
                          ? '刷新连接'
                          : '连接 CLI'}
                    </button>
                  </div>
                )}
                {ai.error && (
                  <p role="alert" className="form-error">
                    {ai.error}
                  </p>
                )}
              </>
            ) : (
              <>
                {ai.chatProfiles.length > 0 && (
                  <label>
                    对话 API
                    <Select
                      aria-label="AI 对话 API"
                      value={ai.chatConfig.id || ''}
                      disabled={ai.busy}
                      onValueChange={(id) =>
                        void ai.selectChatProfile(id).catch((e) => setError(e.message))
                      }
                    >
                      {ai.chatProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.model}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                {editing ? (
                  <ChatProfileSettings ai={ai} onSaved={() => setEditing(false)} />
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setEditing(true)}
                  >
                    配置 API
                  </button>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
