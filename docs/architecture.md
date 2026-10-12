# Texite 0.2 架构

## 共享界面

Web 与 Electron 共用 `apps/web` 入口。`packages/workbench` 调度项目空间和当前工作区；`core` 定义文件、文件夹、磁盘位置和编译版本；`platform` 负责 IndexedDB、ZIP、浏览器文件夹句柄；`editor` 提供 CodeMirror 和源码偏移驱动的 Visual 编辑；`preview` 用 PDF.js 渲染真实 PDF。

项目空间与工作区是两个页面。视图切换只改变面板可见性，保留编辑器与 PDF 的实例状态。Visual 通过原始字符串偏移替换编辑块，不重建整篇文档。复杂语法保留可展开源码。CodeMirror 接收 Visual 的外部更新并记录撤销历史。

## 文件与持久化

Project 包含 files、folders、mainFile、engine、revision。文件是文本或 base64；文件夹显式保留空目录。统一校验相对路径、保留目录、文件 / 文件夹冲突、数量和大小。

恢复副本保存在 IndexedDB。桌面 `ProjectLibrary` 在 userData 保存持久目录注册表，将项目 ID 映射到用户选择的文件夹或应用管理的 UUID 目录。renderer 不能传入任意保存根路径。目录摘要基线持久化，写入前检测外部修改，避免重启后无条件覆盖。

桌面和浏览器都串行保存。桌面逐文件临时写入并 rename；浏览器通过持久化 File System Access 句柄读写，需要浏览器授权。ZIP 导入的 Web 项目仍在 IndexedDB；桌面 ZIP 项目通过 IPC 写入应用管理目录。项目切换先刷新保存队列，重新进入其他目录项目时从磁盘读取。

## 内置编译

构建脚本 `prepare-runtime.py` 下载固定版本的官方 Tectonic 二进制、TeX 资源包及 TeX Live 包索引，并验证 SHA-256。`runtime-profile.json` 声明常用包、依赖排除、宏包代码保留规则、必需文件和体积上限；`runtime_profile.py` 解析运行时文件及依赖闭包。构建脚本保留对应资源，将中文默认配置设为 Fandol，生成新的资源身份以隔离旧格式缓存，并输出逐文件清单及哈希。electron-builder 只把明确列出的编译资源放入应用资源目录，二进制不进入 asar。`verify-runtime.cjs` 在打包前验证哈希、策略、必需资源和体积上限，详见 [离线编译环境](offline-runtime.md)。

编译器读取快照 → 验证路径 → 建立临时项目 → 调用本地 Tectonic，显式传递本地资源 ZIP、only-cached、untrusted → 流式日志 → 返回 PDF 与快照 revision → 删除本次临时目录。格式缓存单独位于可写的用户数据目录，不修改程序资源。

编译任务互斥，支持取消进程树和超时。编译过程中可以编辑，结果仍关联原始 revision，变更后提示预览过期。错误保留旧 PDF。系统 TeX 是可选适配器，不是默认依赖。

## 安全边界与已知限制

Electron 开启 contextIsolation、renderer sandbox，关闭 Node integration，IPC 校验主 frame。生产静态资源限制在 dist；拒绝外部导航、新窗口与权限请求。路径验证和无 shell 的 spawn 不等同于操作系统沙箱。

保存没有多文件事务或文件监听器；复杂 TeX 语义解析、任意宏的视觉还原、SyncTeX、PDF 文本层及浏览器 WASM 编译仍未实现。

## 视觉系统

顶栏容纳编译与布局选择，移除标语区。项目空间使用可搜索的卡片网格；当前项目使用树形文件导航。浅色 / 深色主题独立于 PDF 暗色模式。轻量弹簧选中态、卡片悬浮和面板过渡均尊重减少动态效果，运行时不依赖远程字体或图片。

## 0.3 阅读与历史

PDF 页面各自保留尺寸占位，通过 IntersectionObserver 只绘制邻近画布，离开范围释放像素缓冲。页码按钮更改滚动位置；滚动监听根据阅读位置回写当前页。页码、缩放和主题不修改 PDF 文件。

Visual 使用平衡括号及环境边界保留源码偏移，渲染常见块与内联结构；编辑过程中锁定块边界，未闭合括号不会导致编辑范围漂移。input/include 只读取当前项目文件并限制嵌套深度；图片只使用项目内的栅格资源。KaTeX 禁用 trust 并限制展开，不执行任意 TeX 宏。

history.ts 对比行级快照，保留旧 / 新行号，对大段替换限制 LCS 工作量。useEditHistory 按项目隔离、合并连续输入、限制容量并将记录存入 IndexedDB settings/history:<id>。回看记录显示当时的只读差异，不把旧行号套在当前文稿上。历史不随 ZIP 导出，不记录外部磁盘改动。

外观、主题、对比度、编辑字体和侧栏宽度保存在 localStorage。matchMedia 监听系统深浅变化；主题颜色只改变强调色，基础表面保持黑白灰。编辑文字颜色和字体不影响 PDF 的实际排版。
