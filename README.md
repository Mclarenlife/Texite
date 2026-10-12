# Texite

本地 LaTeX 编辑器，使用 React、TypeScript、CodeMirror 6、Motion、KaTeX、PDF.js 与 Electron，提供网页版和 Windows / macOS 桌面版。

当前版本：**0.2.0 开发预览**。不包含账号、云同步或云端编译。

## 使用与开发

需要 Node.js 24+、pnpm 11。构建桌面编译环境另需 Python 3.11+ 和 curl。

```sh
pnpm install
pnpm dev                 # 浏览器 http://127.0.0.1:5173
pnpm runtime:prepare     # 构建时下载、校验并组装离线编译资源
pnpm exec install-electron
pnpm dev:desktop
```

`runtime:prepare` 首次需要下载约 2.9 GB 官方 TeX 资源及编译器，结果缓存到 `.tools/`，约 1.5 GB 压缩资源放在 `runtime/`。这些文件不会提交进 Git。**打包后的桌面应用已经包含这些资源，用户无需安装 TeX、Perl 或首次联网下载宏包。**

## 本版功能

- 项目空间：点击左上角 LOGO，查看所有项目、搜索、新建、打开文件夹或导入 ZIP。
- 文件夹项目：直接关联用户选择的系统目录，自动保存到原处；关联跨项目切换和重启保留。
- ZIP 项目：解压至应用管理的项目目录，支持资源文件、空文件夹和单层压缩包外包装目录。
- 项目文件：层级文件树，创建文件夹、子文件夹和文件，导入图片等资源。
- Code / Visual：共享同一份源码；Code 提供高亮、补全、查找替换和独立撤销历史；Visual 展示并编辑标题、段落、行内样式与公式，提供格式工具。导言区和复杂命令保留源码块，不做有损 HTML 转换。
- 顶栏：编译 / 取消编译，选择仅编辑器、仅 PDF 或拆分视图。
- PDF：页码输入、前后翻页、总页数、缩放、适合宽度、独立暗色模式、导出 PDF。暗色只影响显示，导出的 PDF 不变。
- 编译：内置 Tectonic 与完整官方 TeX 资源包；支持中文、数学、TikZ、BibTeX。保留系统 XeLaTeX / pdfLaTeX / LuaLaTeX 选项。
- 大纲、项目搜索、引用补全、命令面板、浅色 / 深色主题、减少动态效果。

Visual 是源码驱动的可视化编辑，复杂宏、表格和自定义环境仍通过源码块编辑；它不是任意 LaTeX 的完整 WYSIWYG 排版器。最终版式以编译 PDF 为准。

## 保存位置

桌面应用管理目录为 Electron 的 `userData/projects/<uuid>`，通常为 Windows `%APPDATA%/texite/projects` 或 macOS `~/Library/Application Support/texite/projects`。具体位置显示在导入项目卡片中。这样更新、重装程序不会把项目放进只读安装目录。打开文件夹时始终写回所选原目录。

浏览器项目保存在 IndexedDB；Chrome / Edge 支持通过 File System Access API 关联本地文件夹。其他浏览器可使用 ZIP。浏览器安全限制不允许网页写入桌面软件的数据目录，因此 Web ZIP 项目保存在浏览器本地存储。

源码修改会防抖保存恢复副本；桌面版和已关联文件夹的网页版还会写回磁盘。`Ctrl/Cmd+S` 立即保存。检测到外部改动会拒绝覆盖，当前恢复副本保留在本地，可先导出 ZIP，再重新打开磁盘版本。文件写入按队列执行，桌面端逐文件原子替换；不提供目录级事务，不自动删除用户文件。

限制：500 个文件、500 个文件夹、约 50 MB 项目；不跟随桌面文件系统符号链接。清理浏览器站点数据会删除浏览器项目。

## 编译范围

桌面默认使用 **内置 Tectonic 0.17.0**，以本地 ZIP 资源包和 `--only-cached --untrusted` 编译，不访问云端或下载资源。中文建议 `\documentclass[fontset=fandol]{ctexart}`，使用内置 Fandol 字体。编译使用独立临时目录，支持日志、取消、120 秒超时和失败后保留 PDF。

Tectonic 基于 XeTeX，不能替代 LuaTeX、biber 或需要 shell escape 的外部程序。需要这些能力的项目可自行配置系统发行版；应用不启用 shell escape。旧项目选择 pdfLaTeX / XeLaTeX、系统不可用时会使用内置引擎，并在日志中明确标明。

**网页版目前不含 WASM 编译器。** 编译按钮会说明需要桌面版，不会上传文档或生成假结果。初始 PDF 是随仓库提供的预编译示例。PDF 文本搜索、选择和 SyncTeX 尚未实现。

## 验证和打包

```sh
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
node scripts/desktop-smoke.cjs
pnpm package
pnpm dist:win
pnpm dist:mac
```

打包命令会校验内置资源 SHA-256；缺少资源会失败，防止生成不能离线编译的安装包。Windows/macOS 应分别在对应平台构建，输出位于 `release/`。系统 Edge 可通过 `TEXITE_BROWSER_PATH` 指定，用于浏览器测试。

内置编译集成测试会从空缓存编译中文、公式、TikZ、参考文献，并验证错误和取消；本机没有准备 runtime 时明确跳过，桌面打包 CI 则先准备 runtime 再测试。基础 CI 另测系统 latexmk。桌面回归测试涵盖实际 IPC、磁盘保存、ZIP 目录、PDF 翻页、外部冲突和重启关联。

默认不包含代码签名或 macOS 公证。Windows/macOS 打包工作流可在 GitHub Actions 手动触发。

架构见 [docs/architecture.md](docs/architecture.md)，后续范围见 [docs/roadmap.md](docs/roadmap.md)，编译资源来源与许可见 [docs/runtime-notices.txt](docs/runtime-notices.txt)。应用源码尚未选择开源许可证；第三方组件仍遵循其各自许可证。
