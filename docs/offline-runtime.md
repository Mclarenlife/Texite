# 离线编译环境

Texite 0.2.1 的桌面安装包直接携带 Tectonic、TeX 资源、中文字体与 PDF 中文字符映射资源。用户第一次打开软件时无需联网、安装 TeX Live、MiKTeX 或 Perl。格式缓存由本地资源生成，不依赖以前的安装或下载缓存。

Windows x64 实测：资源 ZIP 从 1,481,187,938 字节降至 228,289,942 字节；0.2.1 安装包约 351 MB（335 MiB），对比 0.2.0 的 1,497 MB 减少约 76.5%。不同平台、签名和后续构建的安装包体积可能略有差异。

## 默认支持范围

| 类型           | 内置内容示例                                                                                |
| -------------- | ------------------------------------------------------------------------------------------- |
| 中文           | ctex、xeCJK、Fandol 宋体 / 黑体 / 楷体 / 仿宋；ctexart、ctexbook、ctexrep                   |
| 西文与数学字体 | Computer Modern / CM-Super、Latin Modern、TeX Gyre、AMS、newtx、newpx                       |
| 数学           | amsmath、amssymb、mathtools、unicode-math、physics、siunitx                                 |
| 表格与页面     | booktabs、longtable、tabularx、multirow、caption / subcaption、geometry、fancyhdr、enumitem |
| 插图与绘图     | graphicx（PNG / JPEG / PDF）、TikZ、PGFPlots、circuitikz                                    |
| 论文与演示     | article / report / book、Beamer、hyperref、cleveref、listings、algorithm2e、tcolorbox       |
| 参考文献       | 内置 BibTeX、natbib、gbt7714；biblatex 使用 `backend=bibtex`                                |

默认中文字体配置是软件提供的 `ctexopts.cfg`，文稿自己的 `fontset` 选项可以覆盖。使用指定商业字体或未内置字体的模板，需要在项目中提供有权使用的字体文件，或使用对应系统字体。

内置引擎基于 XeTeX。LuaLaTeX、biber、minted 所需的外部程序、shell escape，以及依赖已移除字体的特殊模板不在默认保证范围内。程序不会遇到缺包就联网下载。项目仍可携带自己的 `.sty`、`.cls`、字体和其他资源。

## 如何裁剪

构建阶段从固定且校验过哈希的官方资源包读取文件，使用固定 TeX Live 2022 包索引解析常用包的运行时依赖。策略见 `scripts/runtime-profile.json`：

- 保留常用包及依赖、西文与数学字体、Fandol 中文字体。
- 额外保留宏包源码、文档类、字体定义、参考文献样式、映射与断词资源。这些文件体积较小，也能弥补历史包索引与资源快照之间的文件名差异。
- 移除未选中的大量装饰字体、其他语言字体、旧式 CJK 字体度量资源等。某宏包代码存在不代表其外部工具或额外字体也存在。
- 保留原文件内的版权信息；只修改中文默认配置与资源身份文件，修改说明随安装包附带。

`runtime/manifest.json` 记录版本、来源、依赖闭包、策略与资源哈希；`runtime/inventory.json` 记录每个实际文件的长度与哈希。精简资源获得独立的 `SHA256SUM`，防止复用完整资源包产生的格式缓存而掩盖缺依赖。

资源 ZIP 上限为 230,000,000 字节。打包前检查策略及资源哈希、必需文件和体积；旧配置、缺文件或超出预算都会失败。最终安装包另含应用、Electron 和编译器，因此大于资源 ZIP。

## 离线验证

`tests/offline-compatibility.test.mjs` 对十类文稿各建独立缓存，用真实内置引擎与本地 ZIP 编译，检查首次格式生成、无资源下载、PDF 页数与文本。中文测试不显式指定 fontset，覆盖默认宋体、粗体、黑体、楷体和仿宋。文献测试检查 BibTeX 实际执行及条目文字，图片测试包含真实 PNG。

编译命令固定使用本地 `file:` 资源路径及 `--only-cached --untrusted`，不提供网络资源地址。PDF.js 的 CMaps 和标准字体也打包在应用中，不从 CDN 请求。另有编译错误、取消和 Electron 端到端回归。

测试默认检查仓库的 `runtime/`；设置 `TEXITE_TEST_RUNTIME` 后可检查打包产物内的资源。Windows 与 macOS 需分别构建与执行测试；单个平台通过不能代表另一平台已经验证。

`scripts/desktop-smoke.cjs` 可通过 `TEXITE_TEST_EXECUTABLE` 启动打包后的应用，使用独立的 `TEXITE_TEST_USER_DATA` 目录检查真实 IPC、首次中文编译和 PDF 显示。不要将测试数据目录设为自己的日常项目目录。
