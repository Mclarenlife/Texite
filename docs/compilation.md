# 编译入口与按需补包

## 编译入口

点击“编译”优先使用编辑区打开的独立 TeX 文稿（含 `\documentclass`、`\documentstyle` 或 `\begin{document}`）。打开章节片段、图片、参考文献等资源时，使用上次成功编译的入口。当前文稿编译失败时也会尝试该备用入口一次，提示实际使用的文件；原始错误保留在完整日志中。第一次使用时沿用项目原本的主文件配置。停止编译不会触发备用入口。

当前项目的类文件、宏包、输入文稿和参考文献可放在不同子目录：桌面 TeX Live 引擎的 `TEXINPUTS`、`BIBINPUTS`、`BSTINPUTS` 优先查找入口目录，再递归查找项目根目录，最后使用已安装环境。不会跨项目搜索。同名文件应使用明确相对路径，避免模板版本歧义。Tectonic 兼容引擎仍保留原有的隔离策略。

## 桌面自动补包

在设置 → 编译设置 → 引擎与宏包中可关闭“自动补齐缺失宏包”。启用时，编译器报告缺少资源后，Texite 根据内置文件索引查找唯一所属宏包，先安装依赖，再重新编译。不会上传文稿，也不会切换编译引擎。下载记录显示在编译日志中。

下载源为 TeX Users Group 列出的历史镜像：

`https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final/`

使用固定版本是为了匹配内置 TeX Live 2025，不能直接混用滚动更新的 2026 宏包。每份下载核对固定数据库中的 SHA-512，并检查归档路径、文件类型和体积。使用 Windows/macOS 自带的 `tar`，不运行 TeX Live 安装脚本，也不启用 shell escape。

模块存放于应用用户数据的 `runtimes` 中；已校验的下载缓存位于 `package-downloads`。缓存也可用于卸载后的离线重装。宏包管理仍可查看、卸载这些模块。网络不通、校验失败或索引未收录时保留错误，不会把编译失败伪装成成功。

索引覆盖 4,256 个具有可移植运行资源的 TeX Live 2025 包，约 2.3 MB。它不包括外部可执行程序、引擎、商业字体或用户私有模板；首次使用未安装的宏包需要联网。不是所有 LaTeX 错误都能靠补包解决。自动修复最多进行八次，每次最多下载 250 MB / 100 个宏包。Android/iOS 的 WebAssembly 编译环境暂不接入这个桌面下载器。

例如 `cuted.sty` 与 `stfloats.sty` 都由 `sttools` 提供，缺任意一个时安装同一个资源包即可。已用官方 Elsevier CAS 模板验证：类文件和样式文件放在不同层级，自动下载 `sttools`、`moreverb` 后可生成 PDF。

## 桌面辅助编译机制（0.12.0-beta.3）

- **EPS 图片**：pdfLaTeX / LuaLaTeX 编译前，在临时项目副本内用随安装包提供的 Ghostscript 10.08.0 WASM 转换，生成 `图片名-eps-converted-to.pdf`，同时提供不覆盖用户 PDF 的同名 `.pdf` 供省略扩展名的引用使用。保留 EPS BoundingBox，不改变原项目文件；支持停止和单图超时。文件位于子目录、通过 `graphicspath` 引用均可使用。PDF 兼容级别为 1.4。
- **参考文献**：根据生成的 `.aux` 或 `.bcf` 自动选择 BibTeX / Biber，参考文献文件可在不同项目子目录。Biber 仅读取项目内数据，不自动访问远程文献库，也不执行用户的 Biber 配置。重名文献库需明确相对路径。
- **索引**：MakeIndex 自动处理 `.idx`，以及使用标准 MakeIndex 样式的 `.glo` / `.acn` 和 nomencl 的 `.nlo`。自定义 xindy、多个自定义索引样式等规则尚未自动实现。
- **多遍编译**：辅助文件内容变化时重新运行对应工具，再运行 LaTeX，最多六遍；达到上限仍不稳定会明确提示。Biber 的警告和错误进入诊断面板。
- **升级兼容**：首次升级补入 Biber / MakeIndex 辅助模块，不恢复用户已卸载的引擎和宏包。用户主动移除辅助模块后不自动重装，可通过“恢复默认环境”恢复。默认编译引擎仍只有真正的 pdfLaTeX。

这些机制不依赖 unrestricted shell escape。文稿中的任意 `write18` 命令和项目 `latexmkrc` 不执行；受支持的外部工具见下文。自定义 epstopdf 输出目录/后缀和 EPS 依赖外部文件的情况，需要提供预先转换的 PDF；没有嵌入的特殊字体仍可能发生替代。Android/iOS、Tectonic 的编译流程不在本次桌面机制更新范围内。

核对依据：Overleaf [EPS 自动转换说明](https://docs.overleaf.com/troubleshooting-and-support/checklist-for-arxiv-submissions)、[latexmkrc 机制](https://docs.overleaf.com/managing-projects-and-files/the-latexmkrc-file)、[epstopdf](https://tug.org/epstopdf/)、[Biber](https://ctan.org/pkg/biber)。这并不保证不同 TeX Live、字体或宏包版本的排版逐字一致。

## 跨文档引用、缓存和投稿导出

桌面 TeX Live 引擎会扫描入口及其 `\input` / `\include` 中的 `\externaldocument`，按依赖顺序编译项目内其他独立文稿，再将 `.aux` 放入编译副本的相应位置。支持引用前缀、子目录及循环引用；循环最多迭代六轮，未稳定时保留警告。独立文稿的文件名不可重名，依赖上限为 30 份，动态宏生成的外部文档路径需改为明确路径。导入时保留 `.aux`；用户提供的 `.aux` 优先使用，不自动改写，需更新时删除该导入文件，让对应 `.tex` 重新生成。

缓存按项目、入口、引擎隔离，位于应用缓存目录 `projects/<缓存标识>/work`。源文件只在内容变化时写入；BibTeX、Biber、索引及转换图片复用对应结果。删除源文件、改变环境、上次失败或手动清理时重建。保留最近八份缓存，超出约 1 GiB 时清理旧项；当前活动项目不因这一限额被删除。缓存可重建，不是项目备份。

PDF 区域的“编译诊断”中提供“清理并重新编译”“导出投稿包”和可展开的“生成文件”。投稿 ZIP 包含该次成功编译的原始源码、图片、`.bbl`、外部引用 `.aux`、转换图形及 PDF，不含 Texite 私有配置、日志和普通缓存。也可单独导出 `.bbl`、日志、SyncTeX 等生成文件。重新编译后旧导出凭证失效；未编译的编辑不会混入旧投稿包。导出不自动改写期刊模板或保证符合所有投稿平台规则。

同一文稿重新编译后保留 PDF 的页内阅读位置与缩放；新 PDF 页数减少时定位到仍存在的页面，切换项目或编译入口则从第一页开始。

## 常用外部工具

设置 → 编译设置 → 外部工具中可选择本机程序，路径仅保存在当前设备。程序与所需宏包准备好后可离线编译。Inkscape 与 Python 工具不塞入默认安装包。

- **TikZ 标准外部化**：使用项目选定的 TeX Live 引擎生成图形，支持标准 `prefix`。自定义 `system call`、切换为另一引擎的外部命令不执行。只生成项目编译副本中的图形。
- **minted 3**：配置 `latexminted` 可执行程序。Texite 收集标准请求并执行配置、样式和高亮工具，再重跑 TeX；保留高亮缓存。TeX Live 2025 冻结库中的 minted 3.7.0 已用 latexminted 0.6.0 / Pygments 2.21.0 验证。不要直接混用要求 minted 3.8+ 的新工具；宏包与工具版本需要匹配。minted 2、任意 Python 命令和自定义外部命令不在支持范围内。
- **SVG**：配置 Inkscape 1.x，支持 `\includesvg` 的标准 `svg-inkscape` 输出目录，生成 PDF 1.4 与 LaTeX 文字叠加文件，也生成不分离文字的 PDF。按源内容、依赖和工具变化失效缓存；转换结果损坏或缺失会重建。不同目录的 SVG 需使用不同文件名；已有项目转换结果不被覆盖。暂使用默认 drawing 区域，不支持自定义导出目录、区域、滤镜参数和带远程资源或脚本的 SVG。

引擎仍使用 `-no-shell-escape`，工具通过固定程序和参数直接调用，不借助命令解释器。这是有限功能适配，不是任意 shell-escape 的替代，也不是对不可信 TeX 的完整系统沙箱。每份文稿维持 180 秒超时，可停止正在运行的工具；一次最多 100 条外部工具请求、12 轮资源重试。

辅助模块新增 Kpathsea 查询程序供 latexminted 使用。Windows 附带仅用于发现查询程序位置的 `tlmgr.bat` 标识，不提供系统 TeX Live 包管理功能。打包前需重新生成辅助资源并通过 `runtime:verify`，旧安装包不包含本轮机制。

工具接口依据：[TikZ 外部化](https://tikz.dev/library-external)、[minted](https://github.com/gpoore/minted)、[svg 宏包](https://github.com/mrpiggi/svg)。

## 维护索引

运行 `python scripts/build-package-catalog.py` 从 SHA-256 固定的上游数据库生成 `apps/desktop/texlive-2025-catalog.json.gz`。此操作只生成索引，不下载整套宏包、不生成软件安装包。升级 TeX Live 时须同时升级内置环境、索引及下载地址，并重新验证。
