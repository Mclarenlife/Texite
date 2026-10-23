import { AgentSettings } from './AgentSettings';
import { AIConversationList } from './AIConversationList';
import { selectionLabel, type InlineScope } from '../core/ai';
import { Plus, History } from 'lucide-react';
import { Select } from './Select';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileCode2,
  LoaderCircle,
  Plug,
  Unplug,
  RotateCcw,
  Sparkles,
  Square,
  X,
  Minus,
  Settings2,
  MessageSquare,
  CircleHelp,
  Trash2,
} from 'lucide-react';
import type { AIController } from '../workbench/useAI';
import type { AITask } from '../core/ai';
import { DiffLines } from '../editor/HistoryReview';
import { Dialog } from './Dialog';
import { usePreference } from './preferences';
import './ai.css';

const statuses = {
  running: '进行中',
  completed: '已完成',
  interrupted: '已停止',
  failed: '未完成',
  undone: '已撤回',
};
export function AIPanel({
  ai,
  focusAgent,
  projectName,
  activeFile,
  selection,
  onClose,
}: {
  ai: AIController;
  focusAgent?: number;
  projectName: string;
  activeFile: string;
  selection?: InlineScope;
  onClose(): void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cliSettings, setCliSettings] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [prompt, setPrompt] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const [model, setModel] = usePreference<string>('ai-model', '');
  const [mode, setMode] = usePreference<'agent' | 'chat'>('ai-mode', 'agent');
  useEffect(() => {
    if (focusAgent) {
      setMode('agent');
      setMinimized(false);
    }
  }, [focusAgent]);
  const [provider, setProvider] = usePreference<'codex' | 'api'>('chat-provider', 'codex');
  const [minimized, setMinimized] = useState(false);
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || minimized) return;
    el.style.height = '0px';
    el.style.height = Math.min(160, Math.max(60, el.scrollHeight)) + 'px';
  }, [prompt, minimized]);

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const [windowSize, setWindowSize] = useState<{ width: number; height: number } | null>(null);
  const resizing = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [baseURL, setBaseURL] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [configError, setConfigError] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const custom = mode === 'chat' && provider === 'api';
  const visibleTasks = ai.tasks.filter(
    (t) =>
      (t.mode || 'agent') === mode &&
      (t.conversationId || 'legacy-' + (t.mode || 'agent')) === ai.conversations.selected[mode],
  );
  useEffect(() => {
    const resize = () => setPosition(null);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!panel.current) return;
    const observer = new ResizeObserver(() => {
      const r = panel.current?.getBoundingClientRect();
      if (!r) return;
      if (r.right > window.innerWidth - 8 || r.bottom > window.innerHeight - 8)
        setPosition({
          x: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
          y: Math.max(8, Math.min(r.top, window.innerHeight - r.height - 8)),
        });
    });
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, []);
  const configure = () => {
    setProfileId(ai.chatConfig.id || '');
    setProfileName(ai.chatConfig.name || '');
    setBaseURL(ai.chatConfig.baseURL);
    setApiModel(ai.chatConfig.model);
    setApiKey('');
    setConfigError('');
    setConfigOpen(true);
  };

  const [review, setReview] = useState<AITask | null>(null);
  const [clearMode, setClearMode] = useState<'agent' | 'chat' | null>(null);
  const [clearError, setClearError] = useState('');
  const [showConnection, setShowConnection] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const desktop = !!window.texite?.ai;
  const models = ai.connection?.models || [];
  const selected =
    models.find((m) => m.id === model)?.id ||
    models.find((m) => m.isDefault)?.id ||
    models[0]?.id ||
    '';
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [ai.tasks.at(-1)?.reply, ai.tasks.length, ai.conversations.selected[mode]]);
  const send = () => {
    if (!prompt.trim() || ai.busy || ai.connecting || (custom ? !ai.chatConfig.model : !desktop))
      return;
    const message = prompt;
    setPrompt('');
    if (custom) void ai.startChat(message);
    else
      void ai.start(message, selected, mode === 'chat', mode === 'agent' ? selection : undefined);
  };
  const currentReview = review && ai.tasks.find((t) => t.id === review.id);
  return (
    <aside
      ref={panel}
      className={'ai-panel' + (minimized ? ' ai-minimized' : '')}
      aria-label="AI 助手"
      style={{
        ...(position ? { left: position.x, top: position.y, right: 'auto' } : {}),
        ...(windowSize && !minimized ? windowSize : {}),
      }}
    >
      <div
        className="ai-heading"
        tabIndex={0}
        aria-label="移动 AI 浮动窗口"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          const rect = panel.current!.getBoundingClientRect();
          drag.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const rect = panel.current!.getBoundingClientRect();
          setPosition({
            x: Math.max(
              8,
              Math.min(
                window.innerWidth - rect.width - 8,
                drag.current.left + e.clientX - drag.current.x,
              ),
            ),
            y: Math.max(
              8,
              Math.min(
                window.innerHeight - rect.height - 8,
                drag.current.top + e.clientY - drag.current.y,
              ),
            ),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          const r = panel.current!.getBoundingClientRect();
          setPosition({
            x: Math.max(
              8,
              Math.min(
                window.innerWidth - r.width - 8,
                r.left + (e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0),
              ),
            ),
            y: Math.max(
              8,
              Math.min(
                window.innerHeight - r.height - 8,
                r.top + (e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0),
              ),
            ),
          });
        }}
      >
        <span>
          <Sparkles size={17} />
          <strong>AI 助手</strong>
          <button className="icon-button ai-help" aria-label="AI 使用说明" type="button">
            <CircleHelp size={15} />
            <span role="tooltip">
              AI 需要联网；相关文稿会作为上下文发送。
              {mode === 'agent' ? '修改自动保留恢复记录。' : '对话模式仅回答问题，不修改文稿。'}
            </span>
          </button>
        </span>
        <div className="ai-mode-tabs" role="tablist" aria-label="AI 模式">
          <button
            role="tab"
            aria-selected={mode === 'agent'}
            disabled={ai.busy}
            onClick={() => setMode('agent')}
          >
            <Sparkles size={14} />
            Agent
          </button>
          <button
            role="tab"
            aria-selected={mode === 'chat'}
            disabled={ai.busy}
            onClick={() => setMode('chat')}
          >
            <MessageSquare size={14} />
            对话
          </button>
        </div>
        <div className="ai-window-actions">
          <button
            className="icon-button"
            aria-label={minimized ? '展开 AI 窗口' : '最小化 AI 窗口'}
            onClick={() => setMinimized(!minimized)}
          >
            <Minus size={15} />
          </button>
          <button className="icon-button" aria-label="关闭 AI 面板" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="ai-toolbar">
        <button
          className="ai-history-toggle"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen(!historyOpen)}
        >
          <History size={15} />
          对话记录
          <ChevronDown size={12} />
        </button>
        <button
          className="icon-button"
          aria-label="新建对话"
          title="新建对话"
          disabled={ai.busy || ai.loading}
          onClick={() => {
            void ai.newConversation(mode).catch((e) => setClearError(e.message));
            setHistoryOpen(false);
          }}
        >
          <Plus size={16} />
        </button>
        <button
          className="icon-button ai-clear-history"
          aria-label={mode === 'agent' ? '清空当前项目 Agent 记录' : '清空当前项目对话记录'}
          title={mode === 'agent' ? '清空 Agent 记录' : '清空对话记录'}
          disabled={
            ai.busy ||
            ai.loading ||
            (!ai.tasks.some((t) => (t.mode || 'agent') === mode) &&
              !ai.conversations.items.some((c) => c.mode === mode))
          }
          onClick={() => {
            setClearMode(mode);
            setClearError('');
          }}
        >
          <Trash2 size={15} />
        </button>
        <div className="ai-service-controls">
          {mode === 'chat' && (
            <Select
              aria-label="对话服务"
              value={provider}
              disabled={ai.busy}
              onValueChange={(value) => setProvider(value as 'codex' | 'api')}
            >
              <option value="codex">Agent CLI</option>
              <option value="api">自定义 API</option>
            </Select>
          )}
          {!custom && ai.connection && (
            <button
              className="icon-button"
              aria-label="断开 CLI 连接"
              title="断开连接并关闭 CLI 进程"
              disabled={ai.connecting}
              onClick={() => void ai.disconnect()}
            >
              <Unplug size={15} />
            </button>
          )}
          {custom ? (
            <button
              className="icon-button"
              aria-label="配置对话 API"
              title="配置对话 API"
              onClick={configure}
            >
              <Settings2 size={16} />
            </button>
          ) : (
            <button
              className="ai-connection-toggle"
              aria-expanded={showConnection}
              onClick={() => setShowConnection(!showConnection)}
            >
              <span className={ai.connection?.authenticated ? 'ai-dot connected' : 'ai-dot'} />
              <span>{ai.connection?.authenticated ? '已连接' : '连接设置'}</span>
              <ChevronDown size={13} />
            </button>
          )}
        </div>
      </div>
      {historyOpen && (
        <AIConversationList
          key={mode + projectName}
          ai={ai}
          mode={mode}
          onSelect={() => setHistoryOpen(false)}
        />
      )}
      {!custom && !ai.connection?.authenticated && !showConnection && (
        <div className="ai-connect-prompt">
          <span>
            {desktop
              ? ai.connectionNote || '发送指令时自动连接 Agent CLI'
              : 'Agent CLI 需要桌面版；网页可使用对话 API。'}
          </span>
          {desktop && (
            <button
              className="secondary-button"
              disabled={ai.connecting || ai.busy}
              onClick={() => void ai.connect()}
            >
              {ai.connecting ? <LoaderCircle size={14} className="spin" /> : <Plug size={14} />}
              连接 Agent CLI
            </button>
          )}
        </div>
      )}
      {!custom && showConnection && (
        <div className="ai-connection">
          {desktop ? (
            <>
              <p>
                {ai.connection?.account ||
                  '使用所选 Agent CLI 的本机登录状态；首次使用请先在终端登录。'}
              </p>
              {ai.connection?.version && <small>{ai.connection.version}</small>}
              <div className="ai-inline-actions">
                <button
                  className="secondary-button"
                  disabled={ai.connecting || ai.busy}
                  onClick={() => void ai.connect()}
                >
                  {ai.connecting ? <LoaderCircle size={14} className="spin" /> : <Plug size={14} />}
                  {ai.connection ? '刷新连接' : '连接 Agent CLI'}
                </button>
                <button
                  className="text-button"
                  disabled={ai.connecting || ai.busy}
                  onClick={() => setCliSettings(true)}
                >
                  选择 Agent CLI
                </button>
              </div>
              <small>
                当前：{ai.agentConfig.preset === 'custom' ? '自定义 ACP' : ai.agentConfig.preset} ·
                可更换程序与模型服务。
              </small>
              <label className="ai-idle-setting">
                <span>
                  空闲自动断开<small>任务进行时保持连接，发送指令时自动重连。</small>
                </span>
                <Select
                  aria-label="空闲自动断开"
                  value={String(ai.idleMinutes)}
                  disabled={ai.connecting}
                  onValueChange={(v) => void ai.changeIdleMinutes(Number(v))}
                >
                  <option value="0">从不</option>
                  {[1, 5, 10, 30].map((m) => (
                    <option key={m} value={String(m)}>
                      {m} 分钟
                    </option>
                  ))}
                </Select>
              </label>
            </>
          ) : (
            <p>连接 Agent CLI 需要 Texite 桌面版。网页版可在对话模式配置 API。</p>
          )}
        </div>
      )}
      <div className="ai-thread" aria-label="AI 对话记录">
        {!visibleTasks.length && (
          <div className="ai-empty">
            <span className="ai-empty-label">
              {mode === 'agent' ? '编辑当前文稿' : '围绕文稿提问'}
            </span>
            <div className="ai-suggestions">
              {(mode === 'agent'
                ? ['检查并修复编译错误', '整理当前文件的结构', '润色选中文字，保留 LaTeX 命令']
                : ['解释当前文件中的公式', '这篇文稿的结构可以如何改进？']
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setPrompt(s);
                    input.current?.focus();
                  }}
                >
                  {s}
                  <ArrowUp size={13} />
                </button>
              ))}
            </div>
          </div>
        )}
        {visibleTasks.map((task) => (
          <article className="ai-task" key={task.id}>
            <div className="ai-user-message">{task.prompt}</div>
            <div className="ai-response-label">
              <Sparkles size={13} />
              <span className="ai-provider-name" title={task.cliName}>
                {task.provider === 'api' ? task.model || 'API' : 'Agent CLI'}
              </span>
              <span>{statuses[task.status]}</span>
            </div>
            {task.activities.length > 0 && (
              <details className="ai-activity">
                <summary>
                  {task.status === 'running' ? (
                    <LoaderCircle size={12} className="spin" />
                  ) : (
                    <Check size={12} />
                  )}
                  {task.activities.at(-1)}
                  <span>{task.activities.length} 步</span>
                </summary>
                <ol>
                  {task.activities.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ol>
              </details>
            )}
            {task.reply && <div className="ai-reply">{task.reply}</div>}
            {task.error && <p className="ai-task-error">{task.error}</p>}
            {!!task.changes.length && (
              <button className="ai-changes" onClick={() => setReview(task)}>
                <FileCode2 size={14} />
                <span>{task.changes.length} 个文件 · 查看差异</span>
                {task.status === 'undone' ? <Check size={13} /> : <ChevronDown size={13} />}
              </button>
            )}
          </article>
        ))}
        <div ref={bottom} />
      </div>
      <div className="ai-composer">
        {ai.error && (
          <p className="form-error" role="alert">
            {ai.error}
          </p>
        )}
        {clearError && !clearMode && (
          <p className="form-error" role="alert">
            {clearError}
          </p>
        )}
        <div className="ai-context">
          <FileCode2 size={12} />
          <span title={projectName + '/' + activeFile}>{activeFile}</span>
          {selectionLabel(selection) && (
            <span
              className="ai-selection-range"
              title="本次指令优先参考此选区；Agent 仅编辑所选范围"
            >
              {selectionLabel(selection)}
            </span>
          )}
          <span>{mode === 'agent' ? '可编辑项目' : '仅对话'}</span>
        </div>
        <div className="ai-input-box">
          <textarea
            ref={input}
            aria-label={custom ? '发送给 API 的消息' : '发送给 Agent CLI 的指令'}
            placeholder={mode === 'agent' ? '描述你想修改的内容…' : '输入消息，Shift + Enter 换行…'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={20000}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="ai-composer-controls">
            {custom ? (
              <Select
                aria-label="已保存的 API"
                value={ai.chatConfig.id || ''}
                disabled={ai.busy}
                onValueChange={(id) =>
                  void ai.selectChatProfile(id).catch((e) => setClearError(e.message))
                }
              >
                {!ai.chatProfiles.length && <option value="">未配置 API</option>}
                {ai.chatProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.model}
                  </option>
                ))}
              </Select>
            ) : (
              <Select
                aria-label="AI 模型"
                value={selected}
                disabled={ai.busy || !models.length}
                onValueChange={setModel}
              >
                {!models.length && <option value="">连接后选择模型</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
            <button
              className="ai-send"
              aria-label={ai.busy ? '停止 AI 任务' : '发送 AI 指令'}
              disabled={
                !ai.busy &&
                (!prompt.trim() ||
                  ai.loading ||
                  ai.connecting ||
                  (custom ? !ai.chatConfig.model : !desktop))
              }
              onClick={() => (ai.busy ? void ai.cancel() : send())}
            >
              {ai.busy ? <Square size={14} fill="currentColor" /> : <ArrowUp size={18} />}
            </button>
          </div>
        </div>
      </div>
      {!minimized && (
        <div
          className="ai-resize-handle"
          role="separator"
          aria-label="调整 AI 窗口大小"
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            const r = panel.current!.getBoundingClientRect();
            resizing.current = { x: e.clientX, y: e.clientY, width: r.width, height: r.height };
            setPosition({ x: r.left, y: r.top });
          }}
          onPointerMove={(e) => {
            if (!resizing.current) return;
            const r = panel.current!.getBoundingClientRect();
            setWindowSize({
              width: Math.max(
                Math.min(360, window.innerWidth - 24),
                Math.min(
                  window.innerWidth - r.left - 8,
                  resizing.current.width + e.clientX - resizing.current.x,
                ),
              ),
              height: Math.max(
                Math.min(420, window.innerHeight - 32),
                Math.min(
                  window.innerHeight - r.top - 8,
                  resizing.current.height + e.clientY - resizing.current.y,
                ),
              ),
            });
          }}
          onPointerUp={(e) => {
            resizing.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            resizing.current = null;
          }}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
            e.preventDefault();
            const r = panel.current!.getBoundingClientRect();
            setWindowSize({
              width: Math.max(
                360,
                Math.min(
                  window.innerWidth - r.left - 8,
                  r.width + (e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0),
                ),
              ),
              height: Math.max(
                420,
                Math.min(
                  window.innerHeight - r.top - 8,
                  r.height + (e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0),
                ),
              ),
            });
          }}
        />
      )}
      <Dialog
        open={configOpen}
        onClose={() => {
          setConfigOpen(false);
          setApiKey('');
        }}
        title="配置对话 API"
        description="支持 OpenAI 兼容的 Chat Completions 接口。"
      >
        <form
          className="api-settings"
          onSubmit={async (e) => {
            e.preventDefault();
            if (savingConfig) return;
            setSavingConfig(true);
            try {
              await ai.saveChatConfig({
                id: profileId,
                name: profileName,
                baseURL,
                model: apiModel,
                apiKey,
              });
              setConfigOpen(false);
              setApiKey('');
            } catch (err) {
              setConfigError((err as Error).message);
            } finally {
              setSavingConfig(false);
            }
          }}
        >
          <div className="ai-inline-actions">
            <Select
              aria-label="编辑 API 配置"
              value={profileId}
              onValueChange={(id) => {
                const c = ai.chatProfiles.find((p) => p.id === id);
                if (!c) return;
                setProfileId(id);
                setProfileName(c.name || '');
                setBaseURL(c.baseURL);
                setApiModel(c.model);
                setApiKey('');
              }}
            >
              <option value="">新 API 配置</option>
              {ai.chatProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.model}
                </option>
              ))}
            </Select>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setProfileId('');
                setProfileName('');
                setBaseURL('');
                setApiModel('');
                setApiKey('');
              }}
            >
              新增 API
            </button>
          </div>
          <label>
            配置名称
            <input
              aria-label="API 配置名称"
              value={profileName}
              maxLength={100}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="例如：论文助手"
            />
          </label>
          <label>
            API 地址
            <input
              aria-label="API 地址"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="https://api.openai.com/v1"
              required
            />
          </label>
          <label>
            模型
            <input
              aria-label="API 模型名称"
              value={apiModel}
              onChange={(e) => setApiModel(e.target.value)}
              placeholder="服务商提供的模型 ID"
              required
            />
          </label>
          <label>
            API Key
            <input
              aria-label="API Key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                ai.chatProfiles.find((p) => p.id === profileId)?.hasKey
                  ? '已配置，留空保留'
                  : '本机无鉴权服务可留空'
              }
            />
          </label>
          <p>
            {window.texite?.chat
              ? '密钥使用系统加密保存；系统加密不可用时仅在本次运行保留。'
              : '网页版密钥仅在内存保留，刷新后需重新填写；接口需允许浏览器跨域访问。'}
          </p>
          {configError && (
            <p className="form-error" role="alert">
              {configError}
            </p>
          )}
          <div className="ai-inline-actions">
            <button className="primary-button" disabled={ai.busy || savingConfig}>
              保存配置
            </button>
            <button
              type="button"
              className="text-button"
              disabled={ai.busy}
              onClick={async () => {
                try {
                  await ai.saveChatConfig({
                    id: profileId,
                    name: profileName,
                    baseURL,
                    model: apiModel,
                    apiKey: '',
                    clearKey: true,
                  });
                  setApiKey('');
                } catch (err) {
                  setConfigError((err as Error).message);
                }
              }}
            >
              清除密钥
            </button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={cliSettings}
        onClose={() => !ai.connecting && setCliSettings(false)}
        title="Agent CLI"
        description="选择本机 Agent 程序与连接方式。"
      >
        <AgentSettings ai={ai} onDone={() => setCliSettings(false)} />
      </Dialog>
      <Dialog
        open={!!currentReview}
        onClose={() => setReview(null)}
        title="AI 修改差异"
        description="检查这次任务的全部修改。撤回会保留修改记录；有后续编辑的文件不会被覆盖。"
        className="ai-diff-dialog"
        resizable
      >
        {currentReview && (
          <>
            <div className="ai-diff-files">
              {currentReview.changes.map((change) => (
                <section key={change.path}>
                  <h4>
                    {change.path}
                    <small>{change.before === null ? '新建文件' : '修改文件'}</small>
                  </h4>
                  <DiffLines before={change.before || ''} after={change.after} />
                </section>
              ))}
            </div>
            <div className="ai-review-footer">
              <span>
                {currentReview.status === 'undone'
                  ? '已撤回，修改记录仍保留'
                  : '撤回前会核对当前文件内容'}
              </span>
              <button
                className="secondary-button"
                disabled={
                  ai.busy || currentReview.status === 'undone' || currentReview.status === 'running'
                }
                onClick={() => void ai.undo(currentReview)}
              >
                <RotateCcw size={14} />
                撤回整次修改
              </button>
            </div>
            {ai.error && (
              <p className="form-error" role="alert">
                {ai.error}
              </p>
            )}
          </>
        )}
      </Dialog>
      <Dialog
        open={!!clearMode}
        onClose={() => !ai.busy && setClearMode(null)}
        title={clearMode === 'agent' ? '清空 Agent 记录？' : '清空对话记录？'}
        description={
          '仅清理当前项目「' +
          projectName +
          '」的' +
          (clearMode === 'agent' ? 'Agent' : 'Agent CLI 和 API 对话') +
          '记录，无法撤销。'
        }
      >
        <p className="cleanup-confirm">
          {clearMode === 'agent'
            ? '文稿修改会保留，任务记录与对应的撤回记录将被删除。'
            : '文稿文件和 Agent 记录保持不变。'}
          之后的对话将从新上下文开始。
        </p>
        {clearError && (
          <p role="alert" className="form-error">
            {clearError}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={ai.busy}
            onClick={() => setClearMode(null)}
          >
            取消
          </button>
          <button
            className="primary-button"
            disabled={ai.busy}
            onClick={async () => {
              if (!clearMode) return;
              try {
                await ai.clearHistory(clearMode);
                setClearMode(null);
                setReview(null);
              } catch (e) {
                setClearError((e as Error).message);
              }
            }}
          >
            {ai.busy ? '正在清理…' : '确认清空'}
          </button>
        </div>
      </Dialog>
    </aside>
  );
}
