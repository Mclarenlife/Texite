import { Select } from './Select';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileCode2,
  LoaderCircle,
  Plug,
  RotateCcw,
  Sparkles,
  Square,
  X,
  Minus,
  Settings2,
  MessageSquare,
  CircleHelp,
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
  onClose,
}: {
  ai: AIController;
  focusAgent?: number;
  projectName: string;
  activeFile: string;
  onClose(): void;
}) {
  const [prompt, setPrompt] = useState('');
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
  const custom = mode === 'chat' && provider === 'api';
  const visibleTasks = ai.tasks.filter(
    (t) =>
      (t.mode || 'agent') === mode && (mode === 'agent' || (t.provider || 'codex') === provider),
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
    setBaseURL(ai.chatConfig.baseURL);
    setApiModel(ai.chatConfig.model);
    setApiKey('');
    setConfigError('');
    setConfigOpen(true);
  };

  const [review, setReview] = useState<AITask | null>(null);
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
  }, [ai.tasks.at(-1)?.reply, ai.tasks.length]);
  const send = () => {
    if (
      !prompt.trim() ||
      ai.busy ||
      (custom ? !ai.chatConfig.model : !ai.connection?.authenticated)
    )
      return;
    const message = prompt;
    setPrompt('');
    if (custom) void ai.startChat(message);
    else void ai.start(message, selected, mode === 'chat');
  };
  const currentReview = review && (ai.tasks.find((t) => t.id === review.id) || review);
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
          <small>{mode === 'agent' ? 'Agent' : '对话'}</small>
        </span>
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
        {mode === 'chat' && (
          <Select
            aria-label="对话服务"
            value={provider}
            disabled={ai.busy}
            onValueChange={(value) => setProvider(value as 'codex' | 'api')}
          >
            <option value="codex">Codex</option>
            <option value="api">自定义 API</option>
          </Select>
        )}
      </div>
      {custom ? (
        <button className="ai-connection-row" onClick={configure}>
          <Settings2 size={14} />
          <span>{ai.chatConfig.model || '配置对话 API'}</span>
          <ChevronDown size={13} />
        </button>
      ) : (
        <>
          <button
            className="ai-connection-row"
            aria-expanded={showConnection}
            onClick={() => setShowConnection(!showConnection)}
          >
            <span className={ai.connection?.authenticated ? 'ai-dot connected' : 'ai-dot'} />
            <span>{ai.connection?.authenticated ? '已连接本机 Codex' : '连接 Codex'}</span>
            <ChevronDown size={13} />
          </button>
          {(!ai.connection?.authenticated || showConnection) && (
            <div className="ai-connection">
              {desktop ? (
                <>
                  <p>
                    {ai.connection?.account ||
                      '使用本机 Codex 的登录状态。首次使用请先在终端执行 codex login。'}
                  </p>
                  {ai.connection?.version && <small>{ai.connection.version}</small>}
                  <div className="ai-inline-actions">
                    <button
                      className="secondary-button"
                      disabled={ai.connecting || ai.busy}
                      onClick={() => void ai.connect()}
                    >
                      {ai.connecting ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Plug size={14} />
                      )}
                      {ai.connection ? '刷新连接' : '连接本机 Codex'}
                    </button>
                    <button
                      className="text-button"
                      disabled={ai.connecting || ai.busy}
                      onClick={() => void ai.chooseBinary()}
                    >
                      选择 Codex CLI
                    </button>
                  </div>
                  <small>选择 codex 可执行文件。Mac 可在终端运行 command -v codex 查找路径。</small>
                </>
              ) : (
                <p>连接本机 Codex 需要 Texite 桌面版。网页版可在对话模式配置 API。</p>
              )}
            </div>
          )}
        </>
      )}
      <div className="ai-thread" aria-label="AI 对话记录">
        {!visibleTasks.length && (
          <div className="ai-empty">
            <div className="ai-orbit">
              <Sparkles size={25} />
            </div>
            <h3>{mode === 'agent' ? '让想法落在文稿里' : '一起理清思路'}</h3>
            <p>
              {mode === 'agent'
                ? '编辑、编译与修复，修改可查看和撤回。'
                : '解释公式、讨论写法，不修改项目文件。'}
            </p>
            <div className="ai-suggestions">
              {(mode === 'agent'
                ? ['检查并修复编译错误', '整理当前文件的结构', '润色选中文字，保留 LaTeX 命令']
                : ['解释当前文件中的公式', '这篇文稿的结构可以如何改进？']
              ).map((s) => (
                <button key={s} onClick={() => setPrompt(s)}>
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
              {task.provider === 'api' ? task.model || 'API' : 'Codex'}
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
        <div className="ai-context">
          <FileCode2 size={12} />
          <span title={projectName + '/' + activeFile}>{activeFile}</span>
          <span>当前项目</span>
        </div>
        <textarea
          aria-label={custom ? '发送给 API 的消息' : '发送给 Codex 的指令'}
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
          <span className="ai-mode-label">{mode === 'agent' ? '可编辑项目' : '仅对话'}</span>
          {custom ? (
            <span className="ai-api-model">{ai.chatConfig.model}</span>
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
                (custom
                  ? !ai.chatConfig.model
                  : !desktop || !ai.connection?.authenticated || !selected))
            }
            onClick={() => (ai.busy ? void ai.cancel() : send())}
          >
            {ai.busy ? <Square size={14} fill="currentColor" /> : <ArrowUp size={18} />}
          </button>
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
            try {
              await ai.saveChatConfig({ baseURL, model: apiModel, apiKey });
              setConfigOpen(false);
              setApiKey('');
            } catch (err) {
              setConfigError((err as Error).message);
            }
          }}
        >
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
              placeholder={ai.chatConfig.hasKey ? '已配置，留空保留' : '本机无鉴权服务可留空'}
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
            <button className="primary-button" disabled={ai.busy}>
              保存配置
            </button>
            <button
              type="button"
              className="text-button"
              disabled={ai.busy}
              onClick={async () => {
                try {
                  await ai.saveChatConfig({ baseURL, model: apiModel, apiKey: '', clearKey: true });
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
        open={!!currentReview}
        onClose={() => setReview(null)}
        title="AI 修改差异"
        description="检查这次任务的全部修改。撤回会保留修改记录；有后续编辑的文件不会被覆盖。"
        className="ai-diff-dialog"
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
    </aside>
  );
}
