# Texite 0.1 架构

## 共享工作台与平台边界

`apps/web/main.tsx` 是 React 入口，浏览器和 Electron 共用这一构建。`packages/workbench` 管理项目状态、保存调度、编译结果和界面交互；`packages/core` 提供项目模型、路径校验、大纲与文献索引、诊断解析；`packages/editor` 封装 CodeMirror；`packages/preview` 封装 PDF.js；`packages/platform` 提供 IndexedDB 和 ZIP 适配；`packages/ui` 提供视觉系统和 Radix 弹窗。

桌面主进程位于 `apps/desktop`。preload 只暴露固定的项目与编译操作，开启 context isolation、renderer sandbox，关闭 Node integration，校验 IPC 来源，拒绝新窗口和外部导航。生产界面从 `texite://app` 自定义协议加载，静态资源只能落在 dist 目录内。

## 状态与编辑器

Project 是可序列化项目快照，文件内容使用文本或 base64。revision 代表源码或项目设置版本，activeFile 变化不增加 revision。切换工作模式保留同一个 EditorView；每个文件缓存 EditorState，以保留选区和撤销历史。应用快照同步与 CodeMirror 文档状态分离。

0.1 的索引使用同步、受限范围的简单解析；BibTeX 嵌套花括号、自定义宏和大型项目的语义分析尚不完整。后续抽离 Worker 索引服务。不能把当前正则解析器视作完整 TeX 解析器。

## 持久化

IndexedDB 提供恢复副本，编辑后短暂防抖，写入按队列顺序执行。项目切换先保存当前快照。文件夹保存是显式操作，与恢复副本状态区分。

目录打开记录文件内容摘要。写回前比较磁盘内容，拒绝外部冲突；单个文件通过同目录临时文件加 rename 替换。此机制不提供跨文件事务，也没有完整文件监视器。没有自动清理用户文件。

## 编译流程

界面捕获项目快照与 revision → 主进程验证数据 → 探测本机工具 → 创建独立临时工作目录 → 写入快照 → spawn latexmk（参数数组、无 shell）→ 流式日志 → 成功读取 PDF → 回传快照 revision → 清理临时目录。

同一时间只允许一个编译任务。编译时仍可编辑，但不能切换项目；结果显示其快照对应 PDF，并在当前 revision 不同的情况下标记旧预览。取消与超时终止进程树。失败不清空最近一次成功预览。

当前只返回 PDF 和日志，未保留 SyncTeX 数据；双向定位是下一阶段工作。浏览器适配只负责本地编辑与保存，WASM 引擎需另行实现，不能调用桌面 IPC。

## 视觉系统

浅色采用温暖灰底、纸面层级和绿色强调；深色使用对应的独立变量，PDF 页面保留原始纸张颜色。工作模式改变面板比例，不给源码文本做缩放转场。Motion 承担选中态、浮层、诊断面板的过渡；分栏使用 CSS Grid，拖动时关闭延迟动画。

键盘、焦点、对比度和减少动态效果与视觉设计同时维护。应用不依赖远程字体或图片。
