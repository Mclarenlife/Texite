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
  projectName,
  activeFile,
  onClose,
}: {
  ai: AIController;
  projectName: string;
  activeFile: string;
  onClose(): void;
}) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = usePreference<string>('ai-model', '');
  const [readOnly, setReadOnly] = useState(false);
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
    if (!prompt.trim() || ai.busy || !ai.connection?.authenticated) return;
    const message = prompt;
    setPrompt('');
    void ai.start(message, selected, readOnly);
  };
  const currentReview = review && (ai.tasks.find((t) => t.id === review.id) || review);
  return (
    <aside className="ai-panel" aria-label="AI 助手">
      <div className="ai-heading">
        <span>
          <Sparkles size={17} />
          <strong>Codex</strong>
          <small>项目助手</small>
        </span>
        <button className="icon-button" aria-label="关闭 AI 面板" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
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
                  {ai.connecting ? <LoaderCircle size={14} className="spin" /> : <Plug size={14} />}
                  {ai.connection ? '刷新连接' : '连接本机 Codex'}
                </button>
                <button
                  className="text-button"
                  disabled={ai.connecting || ai.busy}
                  onClick={() => void ai.chooseBinary()}
                >
                  选择程序
                </button>
              </div>
            </>
          ) : (
            <p>请在 Texite 桌面版中使用 AI。桌面版可连接本机 Codex，直接编辑文稿并运行离线编译。</p>
          )}
        </div>
      )}
      <div className="ai-thread" aria-label="AI 对话记录">
        {!ai.tasks.length && (
          <div className="ai-empty">
            <div className="ai-orbit">
              <Sparkles size={25} />
            </div>
            <h3>从这篇文稿开始</h3>
            <p>选中文字提出修改，或让 Codex 检查整个项目。</p>
            <div className="ai-suggestions">
              {['检查并修复编译错误', '解释当前文件中的公式', '润色选中文字，保留 LaTeX 命令'].map(
                (s) => (
                  <button key={s} onClick={() => setPrompt(s)}>
                    {s}
                    <ArrowUp size={13} />
                  </button>
                ),
              )}
            </div>
          </div>
        )}
        {ai.tasks.map((task) => (
          <article className="ai-task" key={task.id}>
            <div className="ai-user-message">{task.prompt}</div>
            <div className="ai-response-label">
              <Sparkles size={13} />
              Codex<span>{statuses[task.status]}</span>
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
          aria-label="发送给 Codex 的指令"
          placeholder="描述你想修改的内容…"
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
          <select
            aria-label="AI 工作方式"
            disabled={ai.busy}
            value={readOnly ? 'read' : 'edit'}
            onChange={(e) => setReadOnly(e.target.value === 'read')}
          >
            <option value="edit">直接编辑</option>
            <option value="read">只读问答</option>
          </select>
          <select
            aria-label="AI 模型"
            value={selected}
            disabled={ai.busy || !models.length}
            onChange={(e) => setModel(e.target.value)}
          >
            {!models.length && <option value="">连接后选择模型</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            className="ai-send"
            aria-label={ai.busy ? '停止 AI 任务' : '发送 AI 指令'}
            disabled={
              !ai.busy &&
              (!desktop ||
                !ai.connection?.authenticated ||
                !prompt.trim() ||
                ai.loading ||
                !selected)
            }
            onClick={() => (ai.busy ? void ai.cancel() : send())}
          >
            {ai.busy ? <Square size={14} fill="currentColor" /> : <ArrowUp size={18} />}
          </button>
        </div>
        <small className="ai-disclosure">
          AI 需要联网；相关文稿会作为上下文发送。修改自动保留恢复记录。
        </small>
      </div>
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
