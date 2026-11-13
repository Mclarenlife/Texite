# Texite 自动化测试

## 调研与选择

仓库已有三类可复用的检查。Node 测试验证编译与存储逻辑，Playwright 浏览器测试覆盖工作区操作，Electron 脚本通过桌面界面或 IPC 调用真正的文件系统和编译器。此前 Windows 安装包只自动运行编译机制检查，macOS 的其他检查分别写在工作流内。浏览器测试会复用 5173 端口已有服务，可能测到另一份工作区。

本套测试统一两端桌面场景，以独立端口启动当前源码的浏览器测试服务，并保留失败轨迹。测试选择遵循 [Playwright 的行为验证与隔离建议](https://playwright.dev/docs/best-practices)，桌面层使用 [Electron 官方列出的 Playwright 方式](https://www.electronjs.org/docs/latest/tutorial/automated-testing)，核心与集成层使用 [Node 内置测试运行器](https://nodejs.org/api/test.html)。

## 运行

使用 Node 24 和仓库指定的 pnpm 版本，在项目根目录运行 `pnpm install --frozen-lockfile`。浏览器测试首次需要 `pnpm exec playwright install chromium`，Linux CI 使用 `--with-deps chromium`。也可以将 `TEXITE_BROWSER_PATH` 指向本机兼容的 Chromium 或 Edge 可执行文件。

| 命令 | 验证内容 |
| --- | --- |
| `pnpm test:core` | 快速检查编辑、历史、AI 修改范围、PDF 文字与源码定位 |
| `pnpm test:integration` | 文件保存、WebDAV 冲突、更新校验、本地模拟 AI 服务，以及可用的真实编译环境 |
| `pnpm test:e2e` | Chromium 中的工作区、项目恢复、中文项目导入编辑与导出等用户流程 |
| `pnpm test:verify` | 核心与集成、类型检查、前端构建、完整浏览器回归 |
| `pnpm test:desktop` | 构建当前源码并启动 Electron，依次运行八组桌面回归 |
| `pnpm test:all` | 在当前桌面平台依次运行上述各层，生成测试报告 |

浏览器服务默认使用本机 5273 端口。若端口已用，设置 `TEXITE_E2E_PORT` 为另一个空闲端口。单独复现一个用例，例如 `pnpm exec playwright test tests/e2e/workbench.spec.ts -g 'ZIP import, edit'`。

桌面源码测试需要本机对应平台的内置编译资源和 Electron，首次执行 `pnpm runtime:prepare`、`pnpm exec install-electron`。运行 `pnpm test:all` 前还需要执行 `python scripts/prepare-runtime.py` 和 `python scripts/pack-tectonic.py`。集成层发现默认运行环境后，会实际安装并测试 XeLaTeX、LuaLaTeX 和 Tectonic 扩展，详见[离线资源说明](offline-runtime.md)。系统 latexmk 是独立的兼容测试，缺少该程序时 Node 会报告跳过。请查看结果中的 skipped 数量。

八组桌面回归分别验证离线编译与投稿导出、中文 PDF 双向定位与项目恢复、WebDAV、项目操作、清理、CLI Agent、AI 历史、API Agent。桌面脚本为每个场景建立独立的测试用户目录。AI 和 WebDAV 场景使用测试 CLI 或本机回环服务。

若要验证已有安装产物，将 `TEXITE_TEST_EXECUTABLE` 设为解包后的 `Texite.exe` 或 `Texite.app/Contents/MacOS/Texite` 的完整路径，然后运行 `node scripts/test-desktop.mjs`。源码模式请清除该变量。

## 结果与 CI

浏览器报告位于 `playwright-report/index.html`，可用 `pnpm exec playwright show-report` 查看，失败用例附截图与操作轨迹。桌面测试会打印本次报告目录 `.qa/desktop-reports/run-*/`，其中 `results.json` 记录各场景的结果和耗时，每个场景另有独立日志。任一场景失败都会使桌面测试命令以非零状态退出。

GitHub Actions 的 **Validate** 在推送和 PR 上验证网页与核心功能。手动运行 **Validate** 会同时在 Windows 和 macOS 从源码进行桌面测试。**Package desktop** 在安装包构建后对两个平台执行相同的桌面回归。报告在 Actions 中保留七天。

移动端另有平台专项入口。Android 使用 `playwright.android.config.ts` 验证移动网页与离线编译，iOS 工作流在 iPhone 和 iPad 模拟器上运行原生 UI 测试，详见 [Android](android.md) 和 [iOS](ios.md)。
