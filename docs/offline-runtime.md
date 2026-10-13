# 离线引擎与宏包

Texite 0.5.0 默认只搭载真正的 pdfLaTeX（pdfTeX 1.40.28 / TeX Live 2025 final）。首次启动在应用数据目录展开宏包，首次编译在本地生成格式文件；不需要额外安装 TeX、Perl 或下载资源。安装包内不含 XeTeX、LuaTeX 或 Tectonic 可执行文件。

## 使用方式

设置 → 编译设置 → 引擎与宏包：

- 查看引擎名称、版本、模块展开后的大小，搜索宏包与字体。
- 从 GitHub Release 下载本机平台的 `.texite-runtime.zip`，点击“导入离线扩展包”，预览并选择模块后安装。所需依赖会一并安装；缺失依赖时不修改现有环境。
- 点击卸载后先确认。仍被其他模块依赖的包不能直接卸载；先移除使用它的模块。卸载不修改文稿，也不会切换项目选择的引擎。
- 删除默认模块后，可用“恢复默认环境”离线恢复。软件安装目录保留的默认压缩包是恢复来源；卸载释放的是应用数据目录中的展开文件与编译缓存，不会修改程序安装文件。
- 用户卸载的模块在重启后保持卸载状态，不会自动装回。旧项目的引擎设置保持不变，缺少该引擎时提示导入。

下载文件中的平台：`win32-x64` 为 Windows x64；`darwin-arm64` 为 Apple Silicon macOS。不可跨平台导入二进制包。扩展包含可执行文件，请使用可信来源。

## 编译器与字体

| 引擎 | 提供方式 | 资源与中文字体 |
| --- | --- | --- |
| pdfLaTeX | 默认内置，也提供完整恢复包 | TeX Live 2025；CJK、CTeX、Arphic 宋体与楷体、Type 1 西文和数学字体 |
| XeLaTeX | 独立扩展 | TeX Live 2025；XeTeX、xdvipdfmx、Fandol 与 OpenType 字体 |
| LuaLaTeX | 独立扩展 | TeX Live 2025；LuaHBTeX、luaotfload、LuaTeX-ja、中文 JFM、Fandol 与 OpenType 字体 |
| Tectonic | 独立兼容扩展 | Tectonic 0.17.0 与旧版 TeX 2022 资源，用于继续编译旧项目 |

选择的编译器就是实际调用的编译器。缺失、编译失败或文稿要求另一引擎时均不会自动替换。PDF 标签显示产出该 PDF 的引擎版本；底部状态栏显示当前项目选择的引擎及安装状态；日志记录实际引擎和原生版本输出。

pdfLaTeX 的默认中文配置提供 `\songti`、`\kaishu`。黑体、仿宋、`fontspec` 与 OpenType 字体需相应字体与支持它的引擎。文稿显式指定的 `fontset` 优先。不能把不兼容的 Fandol OpenType 字体直接交给 pdfTeX，也不会暗中改用 XeTeX。

与 Overleaf 对照时请同时检查 TeX Live、宏包、模板、字体、主文件与编译选项。相同引擎名称不保证不同版本环境的排版完全相同。

## 常用宏包

默认提供 amsmath、amssymb、mathtools、geometry、graphicx（PNG/JPEG/PDF）、hyperref、booktabs、longtable、tabularx、multirow、caption、subcaption、enumitem、siunitx、cleveref、TikZ、PGFPlots、circuitikz、Beamer、listings、algorithm2e、tcolorbox、natbib、gbt7714、BibTeX，以及 biblatex 的 BibTeX 后端。

不包含完整 TeX Live。Biber、MakeIndex、外部 shell 命令、EPS 自动转换、额外商业字体及所有语言断字模式不在当前打包范围。缺包时会报错，不会联网安装。引擎禁止 shell escape；LuaLaTeX 额外禁用 socket 库，但这些原生引擎不是操作系统级沙箱。

## 模块与存储

`userData/runtimes/modules/<id>` 保存展开模块；`state.json` 是已安装模块清单。格式与字体缓存置于 `runtimes/cache/<资源标识>/<引擎>`，资源变化后使用新标识。模块导入先写暂存目录并逐文件校验 SHA-256，再提交清单；失败回滚新增文件。卸载前检查反向依赖，并保留可回滚的目录直到清单提交完成。

离线包根目录为 `pack.json`，资源放在 `<module-id>/<relative-path>`：

- `schema: 1`、`platform`、`texLive`、`label`、`modules`。
- 模块包含 `id`、`kind`（engine/package）、`label`、`version`、`dependencies`、`files`、`bytes`；引擎额外指定受支持的 `engine` 标识。
- `files` 每项记录解压大小与 SHA-256；拒绝路径穿越、错误平台、缺依赖、不完整或损坏文件。
- 同一模块不重复安装；卸载后可从原包导入。核心配置与共享依赖也纳入依赖检查。
- 仅支持此格式的 Texite 包，不把任意 TeX Live 安装 ZIP 当作扩展。用户自己的 `.sty` / `.cls` 可以像以前一样放在项目中。

## 可复现构建与体积

`build-modular-runtime.py` 使用 TeX Live 2025 冻结仓库。索引固定 SHA-256，每个上游归档按索引中的 SHA-512 校验。只取运行文件，跳过文档和源码；OpenType 字体独立放入可选模块，默认保留 pdfTeX 所需的 Type 1 与中文 CJK 字体。每个引擎的二进制与依赖分别打包。

默认资源 ZIP 约 174 MB，上限 200 MB；XeLaTeX 扩展约 54 MB、LuaLaTeX 约 46 MB，Windows Tectonic 兼容扩展约 245 MB。安装包还含 Electron、编辑器和 PDF 查看器；最终大小以 Release 为准。共享模块只安装一次，可选包不进入默认安装包。

`runtime:verify` 校验默认 ZIP 摘要、大小、必需模块、完整依赖以及只包含 pdfLaTeX 引擎。CI 在 Windows/macOS 上实际运行默认和可选引擎测试，再构建安装包。测试覆盖 PDF 文字/页数/Producer、中文、数学、图表、文献、错误、取消、导入、依赖保护、卸载与重新导入。
