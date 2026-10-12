# Texite

**给想法，留一点空间。**

本地优先的 LaTeX 写作工作室，使用 React + TypeScript + CodeMirror 6 + Motion + PDF.js，支持网页版以及 Electron 桌面版（Windows / macOS）。

当前版本：**0.1.0 开发预览**。不包含账号、云同步、遥测或云端编译。

## 开始使用

需要 Node.js 24+ 和 pnpm 11。

```sh
pnpm install
pnpm dev
```

浏览器打开 `http://127.0.0.1:5173`。

桌面开发：

```sh
pnpm exec install-electron
pnpm dev:desktop
```

桌面运行生产构建：

```sh
pnpm build
pnpm start
```

## 这版能做什么

- 真实 CodeMirror 编辑：LaTeX 高亮、基础命令与环境片段、引用补全、查找替换、文件间独立撤销历史。
- 项目管理：新建和切换项目、新建源码文件、资源导入、ZIP 导入导出、主文件与编译引擎选择。
- 本地索引：章节大纲、跨文件文本搜索、BibTeX 文献列表与光标附近的引用详情。
- 工作台：写作 / 校对 / 专注模式、可调整分栏、浅色 / 深色主题、字号设置、减少动态效果、命令面板。
- 恢复副本：IndexedDB 自动保存，在同一浏览器配置或桌面配置中重新打开恢复。
- 桌面文件：打开本地项目文件夹、显式保存文件、逐文件原子替换、外部修改冲突检测。
- 桌面编译：本机 `latexmk` + pdfLaTeX / XeLaTeX / LuaLaTeX，日志、诊断跳转、取消和超时处理。
- PDF.js 预览：读取真实 PDF、分页、缩放、适合宽度、导入 / 导出；编译失败保留上次结果。

**网页版不包含 WASM LaTeX 编译。** 点击编译会显示能力说明，不会上传文档或伪造编译结果。初始示例 PDF 为仓库自带的预编译示例，修改源码后会明确标记预览待更新。PDF 阅读目前是单页 canvas；文本选择、PDF 全文搜索和 SyncTeX 双向定位尚未实现。

## 本地编译环境

安装 TeX Live（Windows）或 MacTeX（macOS），确保 `latexmk` 和所选引擎能从 PATH 找到。macOS 会额外检查 `/Library/TeX/texbin`。MiKTeX 用户通常还需要 Perl 才能运行 latexmk。安装后重启 Texite，在设置中点击“检测编译环境”。

内置示例使用英文与 pdfLaTeX，降低首次运行对中文字体的依赖。中文文稿建议选择 XeLaTeX 并使用 `ctex`。

编译在独立临时项目副本中执行，禁用 latexmk 配置读取和 shell escape，限制 TeX 文件访问模式，最长 120 秒。它不是完整的操作系统沙箱；只编译你信任的项目。依赖外部程序的 minted / gnuplot 等流程不在本版支持范围内。某些发行版会自行下载缺失宏包；完全离线编译需要先安装好所有依赖。

## 保存语义

- 状态栏“本地恢复副本已保存”表示保存到应用本地数据库，**不代表已经写回项目文件夹**。
- 桌面按 `Ctrl/Cmd+S` 保存到目录；首次保存会要求选择文件夹。
- Web 按保存快捷键会立即刷新本地副本。通过“导出项目”生成可迁移的 ZIP。
- 原项目文件被外部修改时，写回会拒绝覆盖。重新打开外部版本或另存到空目录处理冲突。
- 本版不删除目标目录中的文件，也不提供目录级事务；多文件写入异常时可能只写入一部分。
- 清理浏览器站点数据会删除恢复副本，请定期导出 ZIP。退出前等待保存完成。
- 初版限制 500 个文件、约 50 MB 项目；不跟随符号链接。

## 构建与验证

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

如使用系统浏览器，可将 `TEXITE_BROWSER_PATH` 设为 Chromium / Edge 的可执行文件绝对路径。原生编译集成测试仅在本机有 latexmk + pdfLaTeX 时运行；缺少环境会明确跳过。

```sh
pnpm package    # 当前操作系统的未安装应用目录
pnpm dist:win   # Windows 上构建 NSIS 安装程序
pnpm dist:mac   # macOS 上构建 DMG
```

产物在 `release/`。默认未配置代码签名与 macOS 公证；正式发布需由仓库所有者配置签名凭据。仓库包含基础 CI，以及手动触发的 Windows/macOS 打包工作流。

## 结构与后续工作

架构说明见 [docs/architecture.md](docs/architecture.md)，版本范围与后续任务见 [docs/roadmap.md](docs/roadmap.md)。

源码中的依赖由锁文件固定。临时工具、编译缓存、本地测试数据、node_modules 和安装产物均不进入 Git。

当前仓库未选择项目开源许可证；第三方依赖仍遵循其各自许可证。
