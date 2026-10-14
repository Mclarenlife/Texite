import { ArrowUpRight, Code2 } from 'lucide-react';
import packageInfo from '../../package.json';

export function AboutSettings() {
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
      <div className="about-changelog">
        <h3>更新日志</h3>
        <section>
          <h4>
            {packageInfo.version}
            <time>2026.10.14</time>
          </h4>
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
          <h4>0.9.0</h4>
          <ul>
            <li>WebDAV 同步、多项目选项卡，以及同步与存储设置。</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
