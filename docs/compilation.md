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

## 维护索引

运行 `python scripts/build-package-catalog.py` 从 SHA-256 固定的上游数据库生成 `apps/desktop/texlive-2025-catalog.json.gz`。此操作只生成索引，不下载整套宏包、不生成软件安装包。升级 TeX Live 时须同时升级内置环境、索引及下载地址，并重新验证。
