import { ArrowUpRight, Code2 } from 'lucide-react';
import packageInfo from '../../package.json';
import { UpdateSettings } from './UpdateSettings';
import { useState } from 'react';
import { Dialog } from './Dialog';
import licenseText from '../../LICENSE?raw';

export function AboutSettings({ onPrepareUpdate }: { onPrepareUpdate(): Promise<void> }) {
  const [licenseOpen, setLicenseOpen] = useState(false);
  return (
    <div className="about-settings">
      <div className="about-brand">
        <div className="brand-symbol" aria-hidden="true">
          t.
        </div>
        <div>
          <h2>Texite</h2>
          <span>版本 {packageInfo.version}</span>
        </div>
      </div>
      <div className="about-links">
        <a href="https://github.com/Mclarenlife/Texite" target="_blank" rel="noreferrer">
          <Code2 size={17} />
          <span>
            GitHub 项目<small>github.com/Mclarenlife/Texite</small>
          </span>
          <ArrowUpRight size={16} />
        </a>
        <a href="https://mclarenlife.github.io/" target="_blank" rel="noreferrer">
          <span className="about-author">M</span>
          <span>
            作者官网<small>mclarenlife.github.io</small>
          </span>
          <ArrowUpRight size={16} />
        </a>
      </div>
      <UpdateSettings onPrepare={onPrepareUpdate} />
      <section className="about-license">
        <strong>GPL-3.0-only</strong>
        <p>
          © 2026 Mclarenlife 和贡献者。可按 GNU GPL 第 3
          版复制、修改和再分发，本软件不提供任何担保。第三方组件保留各自许可证。
        </p>
        <button className="secondary-button" onClick={() => setLicenseOpen(true)}>
          查看许可证
        </button>
      </section>
      <Dialog
        open={licenseOpen}
        onClose={() => setLicenseOpen(false)}
        title="GNU General Public License v3.0"
      >
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.7 }}>{licenseText}</pre>
      </Dialog>
      <div className="about-changelog">
        <h3>更新日志</h3>
        <section>
          <h4>
            {packageInfo.version}
            <time>2026.10.24</time>
          </h4>
          <ul>
            <li>Agent 与对话回复支持 Markdown、表格、代码块复制和数学公式。</li>
            <li>AI 助手可从任意边或角调整窗口大小。</li>
            <li>AI 对话记录独立保存，可更改数据目录，并随云端项目同步。</li>
            <li>关于页显示更新安装包下载位置及清理说明。</li>
          </ul>
        </section>
        <section>
          <h4>
            0.10.0<time>2026.10.23</time>
          </h4>
          <ul>
            <li>AI 连接状态精简为「已连接」，对话记录支持右键重命名和单条删除。</li>
            <li>统一同步与存储页的设置卡片宽度。</li>
            <li>Agent CLI 可彻底断开进程、空闲自动断开，并在发送指令时自动重连。</li>
            <li>退出前检查未上传的项目，项目空间可停止云端关联且保留文件。</li>
            <li>应用 GPL-3.0-only 开源许可证，随包提供许可与源码版本信息。</li>
          </ul>
        </section>
        <section>
          <h4>
            0.10.0-preview.1<time>2026.10.23</time>
          </h4>
          <ul>
            <li>AI 助手显示选区行与字位置，Agent 指令限定选中文字编辑。</li>
            <li>独立对话记录、新建与切换对话，模式切换移至浮窗顶栏中央。</li>
            <li>Agent CLI 支持现有原生连接及 ACP CLI 配置，多套 API 可保存与快速切换。</li>
          </ul>
        </section>
        <section>
          <h4>
            0.9.0
            <time>2026.10.14</time>
          </h4>
          <ul>
            <li>修复设置页滚动遮挡，扩大顶栏空白处的窗口拖动区域。</li>
            <li>AI 差异窗口可调整大小、横向滚动，支持按模式清空记录。</li>
            <li>WebDAV 使用项目名保存，兼容旧命名并保留多设备同步关联。</li>
            <li>同步与存储中可清理备份、修改历史及 AI 记录。</li>
          </ul>
        </section>
        <section>
          <h4>0.9.0-preview.6</h4>
          <ul>
            <li>最近删除支持永久删除与可选本地文件清理。</li>
            <li>拖入文件或目标文件夹导入，底栏展示导入进度。</li>
            <li>WebDAV 未同步提醒、诊断状态颜色与 GitHub Release 更新入口。</li>
          </ul>
        </section>
        <section>
          <h4>0.9.0-preview.5</h4>
          <ul>
            <li>文件与文件夹右键删除，二次确认并保留备份。</li>
            <li>成功编译后以 PDF 首页生成项目封面。</li>
            <li>编辑器撤销与重做、可折叠的文档脉络、参考文献精确文本搜索。</li>
            <li>PDF 选中文字词数统计，统一工作区留白与文件图标间距。</li>
          </ul>
        </section>
        <section>
          <h4>0.9.0-preview.4</h4>
          <ul>
            <li>源码与 PDF 双向定位、项目备份与还原、按时间清理历史。</li>
            <li>限定项目搜索范围，可调整侧栏上下分区。</li>
          </ul>
        </section>
        <section>
          <h4>0.9.0-preview</h4>
          <ul>
            <li>WebDAV 同步、多项目选项卡，以及同步与存储设置。</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
