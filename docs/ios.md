# Texite iOS 0.1.0 alpha

## 实现范围

iPhone 与 iPad 共用移动端 React 编辑器，使用 Capacitor 8 / WKWebView。
支持项目新建、ZIP 导入导出、文件/文件夹、源码编辑、搜索与撤销、图片和
连续 PDF 预览、编译诊断、浅色/深色/系统外观。手机切换编辑与预览，宽屏
iPad 并排显示。键盘出现时按 visualViewport 调整工作区，适配安全区域。

pdfLaTeX、BibTeX、常用宏包及 CJK/Arphic 中文字体随包内置，编译全部在
Web Worker 中执行，无下载宏包服务，无 shell escape，不自动切换引擎。
引擎和宏包基于 TeX Live 2023；中文模板使用 CJKutf8。暂不支持 fontspec、
XeLaTeX、Biber 或要求更新宏包的文档。许可证见 `android-runtime-notices.md`。

AI、WebDAV、桌面备份历史和 Visual 编辑尚未移植到移动首版。

## 数据

`TexiteFilesPlugin.swift` 将项目原子写入 Application Support/TexiteProjects。
网页层串行保存，避免较早的异步保存覆盖新内容。项目不会自动上传 iCloud，
正常覆盖更新保留数据，但卸载 App 会删除数据，请先导出 ZIP 备份。
ZIP 导入与 ZIP/PDF 导出使用系统 UIDocumentPicker，不需要全盘权限。
输入 ZIP 上限 250 MiB，持久化项目 JSON 上限 384 MiB；共享项目模型最多 5,000 个文件、250 MiB 原始文件总量、128 MiB 单文件。这些是保护性上限，本轮没有验证 iOS 真机的极限内存表现。详见 [大项目导入与存储](large-projects.md)。

## 构建与模拟器测试

最低 iOS 17.4。原生构建需要 macOS、Xcode 26、Node 22+、pnpm 和 Python。
无需 Apple 开发者账号即可生成和运行模拟器 App：

```sh
pnpm install --frozen-lockfile
pnpm runtime:prepare
pnpm android:runtime # iOS/Android 共用离线编译资源
pnpm dist:ios
```

Windows 可运行 `pnpm build:ios` 生成网页与同步 Xcode 工程，不能生成原生 App。
`pnpm exec playwright test -c playwright.ios.config.ts` 使用 WebKit 验证共用界面。

模拟器输出为 `release/ios/Texite-0.1.0-alpha.1-ios-simulator.zip`，包含 App.app。
在 Mac 上解压，打开 Xcode 的 Simulator 并选择已安装的 iOS 设备，然后：

```sh
xcrun simctl install booted /absolute/path/App.app
xcrun simctl launch booted com.texite.ios
```

这是模拟器构建，不能安装到真实 iPhone/iPad，也不是 IPA 或 TestFlight 版本。
真机包需要另行配置 Apple 签名；当前未配置任何账号、证书或发布凭据。

GitHub Actions 的 `Package and test iOS simulator` 工作流生成模拟器包并运行
XCUITest，包括中文编译、PDF 展示、重新启动后的项目恢复与系统导出入口。
测试和构建日志一同保存在 Actions artifact 中，不发布 GitHub Release。

真机键盘行为、较大项目的峰值内存和文件提供商兼容性仍需在签名后实机验收。
