# 🗂️ DeepSeek Harness 工作区 Studio 插件（左中右三栏布局）

[English](README.en.md) | 中文

此 bundle 将 DeepSeek Harness Web 的根布局替换为**左中右三栏**：**左侧栏（Session / 工作区选择器 + 文件树视图切换）· 中部高亮文件预览与受控编辑器 · 右侧聊天**。文件预览栏默认在对话左侧，可在「工作区设置 → 内容浏览设置」中切到右侧；文件树不再独占一栏，而是融合进左侧栏，与「会话列表」通过顶部按钮互切。会话头部提供「导图」按钮，可随时进入**导图模式**：会话分支树在预览区作为标签页打开，右侧聊天保持可见、可继续对话。

插件保留现有侧栏、会话、详情与全局浮层的 Slot 合约，内置的新建会话、会话列表、设置、聊天、工具详情、审批等仍由原插件提供；工具详情以右侧抽屉覆盖在三栏布局上，不额外占用常驻栏位。

## 📸 界面预览

| ![三栏布局总览](image/image-1.png) | ![文件视图与编辑器](image/image-2.png) |
|---|---|

## ⭐ 四大核心能力

| # | 能力 | 一句话价值 |
|---|---|---|
| 1 | 🗂️ **工作区文件浏览与预览标签页** | 在对话旁边像 IDE 一样浏览工作区：文件树、按会话恢复的预览标签、14 种编码与 Markdown / HTML / 图片 / PDF / Office 文档渲染视图 |
| 2 | ✏️ **打开即改的内置编辑器** | CodeMirror 6 打开即可编辑，改动全程落在暂存盘草稿，保存时与磁盘三方合并，**永不静默覆盖** |
| 3 | 🧭 **会话分支导图** | 把一条对话线变成可自由分叉的导图：任意轮次 fork 新分支、分支会话集中管理、流式输出可视化 |
| 4 | 🎯 **编辑器上下文注入** | 打开的文件或选中的代码以 `<opened_file>` / `<selection>` 注入对话，模型看到的就是你选的那一段 |

### 1️⃣ 工作区文件浏览与预览标签页

- 文件树融合在**左侧栏**：顶部按钮在「会话列表 / 文件浏览」间互切；当前会话属于某 Workspace 时自动显示其文件树（会话 `cwd` 与 Workspace 路径一致时同样识别），目录优先、逐级展开、可手动刷新。展开状态与垂直滚动位置**按会话持久化**，刷新后自动恢复。
- **预览标签页按 Session 保存**：可关闭、拖拽重排、滚轮横向滚动、跨重载恢复；右键可**固定**（图钉图标、自动排前，「关闭其他标签页」只关未固定）或**在新窗口内打开**。存在未保存修改时，标签名与面板标题的文件名末尾显示 `·`。
- **查看方式菜单**（渲染器注册表驱动，与 Harness 右侧栏文档预览同源）：Markdown 在「源码编辑 / 渲染预览」间切换并**默认渲染预览**（GFM：表格、任务列表、删除线）；HTML 在「源码编辑 / 页面预览」间切换并**默认页面预览**，相对脚本与样式表经标准工作区文件接口打包进沙箱 iframe（编辑内容实时生效，打包防抖 400 ms）；图片（png / jpg / jpeg / gif / webp / bmp / ico / svg）直接预览；只读文本可分页浏览完整文件。查看方式按文件切换时重置为该文件的默认视图、不持久化。
- **PDF 与 Office 文档预览**（渲染器注册表新增 `pdf` / `office` 两类）：`.pdf` 经标准工作区文件接口取原始字节直接预览；`.doc / .docx / .ppt / .pptx / .xls / .xlsx` 交给 Harness Host 的 `officeToPdf` 服务在**本机用 LibreOffice 转成 PDF** 后预览（有界队列 + 按内容摘要缓存，重复打开不再重转）。两者都以 blob URL 交给**浏览器自带 PDF 阅读器**渲染，因此缩放、翻页、文字选择与打印都可用，且不向产物里塞 PDF 引擎；转换缺字体时在顶部横幅列出字体名。这类标签与图片一样**只读、无草稿、不进编辑器上下文**，磁盘变更时自动重新转换。Host 未挂载转换服务时给出「当前 dsh 未提供文档转换服务」提示而不是空白。
- **编码**：自动检测 14 种编码（UTF-8 / UTF-8 BOM / UTF-16 LE / BE / GBK / GB18030 / Big5 / Shift_JIS / EUC-JP / EUC-KR / ISO-8859-1 / Windows-1252 / Windows-1251 / ASCII）；右键预览头可「以编码打开…」重新解码或「另存为编码…」写回磁盘，面板头显示编码徽标；编码清单以 Host `/workspace-studio/api/encodings` 为准，请求失败回退内置清单，操作不会中断。
- **聊天里的文件直达预览**：聊天中打开工作区文件（`dsh-resource://file/...` 地址）不再落到 Harness 右侧栏，而是解析为当前会话工作区内的路径，直接在本插件的预览标签页中打开；文件不在工作区内或会话无工作区时给出明确提示，而不是静默失败。
- **计划直达预览**：计划审批条带的「查看全文」与回合末尾「计划」卡片的「打开」（`dsh-resource://plan/...` 与 `dsh-resource://plan-review/...` 地址）同样落在本插件的预览标签页里，以渲染后的 Markdown 显示完整计划；已记录的计划经 Harness 的 plan 资源读取会话历史，临时审阅文本只存在于本次页面（刷新后标签不再恢复）。计划标签是会话内的临时标签，不写入预览持久化。
- **变更审查直达预览**：回合末尾「变更文件」卡片（头部或任一文件行，`dsh-resource://changes-review/session/...` 地址）在本插件的预览标签页里打开该轮的**变更审查**：左侧列出该轮所有变更文件（含 +/− 行数，二进制与超大文件以标签标注），右侧按 Harness 的 `api/changes.summary` / `api/changes.diff` 路由渲染逐文件统一 diff（行号、`@@` 段头、新增 / 删除着色，超过 5000 行截断提示），头部可「在编辑器中打开」当前文件（工作区外走只读预览）。标签按索引定位到点击的那一行，同一轮重复点击只会跳转而不新开标签；审查标签是会话内的临时标签，不写入预览持久化。标签内左右两栏（文件列表 / 内容对比）之间可**拖拽调宽**（也支持键盘 ←/→ 步进），宽度是**页面内的临时状态**：切换预览标签、切换会话或工作区再切回都不变，刷新后回到默认（与审查标签本身一样不落盘）。
- 可将外部文件拖入预览面板以只读标签查看（会话内有效，不写入工作区）；仅文本类文件可预览，图片属聊天输入区，此为有意行为。

### 2️⃣ 打开即改的内置编辑器

- **打开即编辑**：可编辑文件无需「编辑」按钮，打开即进入编辑状态；面板头提供「取消」「保存」「自动换行」与「从磁盘重新读取」（刷新）。只读文件（外部拖入、超大、截断、混合换行、符号链接或未启用编辑）显示只读原因横幅。
- **暂存盘（草稿文件）**：进入编辑时提取一次**快照**（源文件内容），之后所有临时修改防抖写入位于**工作区之外**的暂存盘文件（`~/.dsh-plugin/dsh-workspace-studio/drafts/<workspaceId>/`，长期留档），**源文件全程不被触碰**；刷新页面后草稿、快照与编码一并恢复。自动写盘不视为「保存」，`·` 保留到显式保存；localStorage 只记脏标记，不存内容。
- **保存即三方合并**：保存时重新读取源文件并与快照比较——源文件未被改动则**静默写回**并删除暂存盘文件；双方改动不在同一位置则**自动三方合并**、双方修改都保留；同一位置冲突则弹窗逐处展示（上方两栏为行内增删对比「我的修改 / 磁盘版本」，下方两栏为修改后的实际代码），可分别选择「保留我的版本 / 保留磁盘版本」，取消则放弃保存。**取消**会删除暂存盘并让编辑器回到源文件内容，源文件本身不改动。
- **外部变更自动同步**：默认开启，对每个打开的标签约每 2 秒检查一次磁盘变更。干净且激活的标签被其他工具改动时自动重载并保留滚动位置（可改为「仅提示，不自动刷新」）；**未保存的脏标签绝不覆盖**，只提示由你决定（保存时三方合并或逐处选择）；文件被删除时激活标签给出提示。
- **语法高亮与编辑体验**：20+ 语言高亮、行号、代码折叠槽与编辑器内搜索（`Ctrl/Cmd+F`、`F3`）；`Ctrl+K+J` 展开所有已折叠区域，`Ctrl+K+1..9` 按层级折叠（如 `Ctrl+K+2` 折叠所有第二层折叠区域），`Ctrl/Cmd+S` 在任意焦点状态可用（含聊天输入框）；每类文件类型组可在设置页选择 10+ 款高亮预设（默认、经典、暖色、冷色、单色、XML (VS Code) 等），按类型记忆。
- 拒绝二进制、非 UTF-8 与工作区外符号链接；截断的大文件、混合换行文件与经符号链接的路径只读。

### 3️⃣ 会话分支导图

- 会话头部「导图」按钮进入**导图模式**：导图作为**预览区标签页**打开（`dsh-ws-preview` 内，可与其他文件标签页自由切换），**右侧聊天保持可见可继续对话**；关闭 = 标签页 × 按钮。首次进入时，插件从会话的**完整事件日志反向解析全部轮次**，把整个会话切成一根提问卡片链，并持久化到 `~/.dsh-plugin/dsh-workspace-studio/mindmap/` —— 该持久化文档是导图的**唯一信息源**。
- 首次进入前会弹确认框：将普通会话**转换**为导图会话后，它从侧栏会话列表隐藏，改为**对应工作区分组下会话列表末尾**的一个自绘条目（点击条目打开会话并把导图打开为预览标签页）；凡由该导图派生出来的 fork 会话都会从列表隐藏，只在导图里管理。该条目支持**拖拽排序**（顺序按工作区分组持久化）、右键**重命名导图标题**（与根会话标题相互独立）或「在资源管理器中打开」；家族任一会话流式输出时条目图标持续旋转。
- 导图顶部是**虚拟根节点**：点击它新建一个**空白顶级会话**（无继承轮次，同工作区 cwd，自动打开可立即提问）；右键根节点可选择「新建会话归属工作区」或「归档整个导图」。工具栏可归档整个导图（连同全部分支会话，归档后标签页自动关闭）。
- 点击卡片 = **切换优先、新建兜底**：停在某卡片的分支（链尾卡片）点击即**切换到该分支**（右侧聊天跟随切换，导图内高亮跟随，可自由切换）；没有分支停靠的中间轮次卡片（如分支 6-7 里的 6）点击则**在该处 fork 新分支**并进入对话，新轮次与兄弟轮并列（6 → 8、9 与 7 并列）。所有 fork 都归**同一个主导图**，绝不新增导图；新分支会话也不出现在侧栏会话列表。分支的新轮次由 Host 在同步时从分支会话的完整日志折叠回文档。
- 右键分支可**重命名**；右键任意卡片（含根会话卡）可**删除卡片**（**真截断**）：从上一张卡 fork 出截断后的新会话并归档原会话——该卡片及其后的轮次、由此衍生的所有分支一并移除（原会话归档后当前无恢复入口），聊天与导图从此从截断点重新开始、编号一致。导图支持**抓手平移、滚轮缩放**与「还原视图」。
- **流式可视化**：分支正在**输出**时（输入问题、agent 生成中），导图会为家族中每个生成中的会话实时显示一张「**生成中…**」卡片（显示本轮问题文本）；每张流式卡与其**父卡片**带同色炫彩渐变流动光环，两者之间的连线显示同色流动虚线；输出完成后流式卡自动转为正常卡片，光环与流动边消失。**流式卡可点击 = 切换到正在生成的会话**（右侧聊天跟过去实时看输出、高亮跟随；未收尾轮没有 turn/end seq，不能作为分叉点，右键菜单也禁用）；生成中会话的最后一张已完成卡此时按**中间卡**处理，点击即在它处**分叉新分支**。
- **AI 卡片摘要**（可选，默认关闭）：在「工作区设置 → 导图浏览设置 → AI 卡片摘要」中启用后，导图会用所选模型自动总结每轮提问（每轮一次小调用，产生少量 token 消耗；摘要为建议性总结，完整原文可悬浮卡片查看）。卡片右键「重新生成摘要」、工具栏「重新生成全部摘要」可随时重算；工具栏「重新生成所有会话总结」只重算全部会话头卡片的总结（不重算已有卡片摘要，缺少卡片摘要的会话会先补齐缺失部分）；会话头右键「总结当前会话」为整个会话生成一段总结。摘要模型可选「跟随会话模型」或指定模型，摘要长度与会话总结长度可分别调整（20–200 字 / 20–500 字）。

### 4️⃣ 编辑器上下文注入

- 编辑器上下文经现有输入 dock 显示为输入框外的不可编辑前缀：启用发送时冻结上下文，文件模式渲染 `<opened_file>...</opened_file>`、选中文本模式渲染 `<selection>...</selection>`（无选区时不携带文件字节），灰色发送不附加上下文。
- Host 校验并把它拼接到直接用户提示前；对话页把该封套折叠成气泡上方显示文件名与行列范围的一行摘要（悬浮可看完整注入 XML），历史只渲染已记录的用户消息。
- **以命令开头的提示同样携带上下文**：`/plan <消息>` 这类「参数就是提示文本」的斜杠命令走的是 harness 的命令提交事务（`claim.submit` → `commands.execute`，不经过 `sendSession`），插件在该事务上把封套拼到命令参数前；**手输整行回车、或从 `/` 菜单选中命令后再输入参数，两条路径都会注入**（后者由 harness 在选命令时就把 token 写进草稿、回车时不再裁决，所以插件在 claim 生成处就完成包装）。因此模型看到的仍是「文件/选区 + 你写的消息」，气泡折叠与标题守卫同样生效；`/plan off` 这类控制词与裸命令不注入。`/goal` 目前不在注入清单内（其参数会持久化为目标文本，不适合塞 XML）。
- **标题守卫**在客户端自动净化泄漏进会话标题的封套前缀。
- Token 与 KV 缓存影响见下文「模型体验」。

## ➕ 其余能力

| 能力 | 说明 |
|---|---|
| 🧹 **文件操作** | 右键新建 / 重命名 / 复制 / 剪切 / 粘贴 / 删除 / 复制名称与路径 / 「在资源管理器中打开」，支持 `F2`、`Ctrl/Cmd+C/X/V`、`Del`；剪切 + 粘贴 = 移动，同名目标自动去重（`a.txt → a-1.txt`）；剪贴板为内存态、按工作区隔离，刷新即失效 |
| 🔎 **搜索** | 结果按文件分组，点击文件头折叠 / 展开该文件的匹配条目，点击条目打开文件并跳到对应行；支持区分大小写；大文件仅搜索开头部分时标注「部分」 |
| 💬 **聊天增强** | Think 条与编辑 / 写入 diff 以**常驻卡片**显示，正文视口行数可调（5–30，默认 10）、可滚动回看、可点击标题收起 |
| 🪟 **新窗口预览** | 右键标签「在新窗口内打开」：Markdown 渲染为文档（GFM，页面无脚本），HTML 原样运行页面脚本，其余文件显示原始文本；链接与图片仅放行 http / https / mailto（图片 / PDF / Office 标签不提供此项） |
| 📄 **文档预览** | PDF 直接预览；Word / PowerPoint / Excel（.doc/.docx/.ppt/.pptx/.xls/.xlsx）由 Harness Host 在本机转 PDF 后预览，缺字体时给出横幅提示 |
| 📊 **Token 统计** | 设置页按标准周 / 自然月（本周、上周、本月、上月、全部）或自定义起止日期统计所有会话日志的 token 用量，可查看总计或按模型明细（输入、缓存读取、缓存写入、输出），默认包含已归档会话 |
| 🔄 **插件更新** | 设置页从 GitHub（yishengjun8/dsh-workspace-studio）main 分支检查新版本，一键下载并替换安装文件，完成后提示重启 dsh 并刷新页面生效（本地 `file:` 安装只替换 profile 副本） |
| ⚡ **`/init` 命令** | 在当前会话所属工作区的根目录生成或更新 `AGENTS.md`，已有文件时弹层选择「更新」或「取消」，由当前 Agent 分析工作区后生成 |
| 📱 **手机模式** | 侧栏底部开关切换为居中的手机竖屏列：侧栏变为左上角鲸鱼开合的悬浮抽屉，会话头部出现「文件内容浏览」按钮可铺满手机列；瞬态状态，刷新后回到桌面布局 |
| 🌐 **中英双语** | 界面语言跟随 Harness「设置 → 通用设置 → 语言」（中文 / English）即时切换，无需重启或刷新 |
| 🔒 **安全边界** | 工作区受限读写、路径包含校验、修订版本冲突保护、拒绝符号链接与 Windows 保留名称，详见下文「安全边界」 |

## 🛠️ 工作区设置

- **插件更新**（设置页顶部）与 **Token 统计**：见「其余能力」；Token 统计的索引缓存在 Host 侧持久化，并在每次 dsh 启动后**后台预热**，首次打开面板即可秒出；后台扫描未完成时先显示**部分结果**并每 1.5 秒自动刷新（页脚显示「已完成 N / M 个会话」）。
- **会话浏览设置**：侧栏导图条目在家族流式输出时的旋转图标速度（倍速 0–3×，默认 1.2×，0 为不旋转）。
- **导图浏览设置**：悬浮高亮与选中高亮颜色、会话头卡片与末端卡片提示色、导图挂载连线弯曲幅度（0–6×，默认 5×，0 为直线），以及 **AI 卡片摘要**（启用开关、摘要模型、摘要长度 20–200 字默认 48、会话总结长度 20–500 字默认 64）。
- **文件浏览设置**：文件树行高、搜索结果显示方式（默认展开 / 折叠）、文件图标徽标配色。
- **内容浏览设置**：每类文件的高亮预设、保存冲突弹窗对比字号、文件浏览页面显示在对话左侧或右侧（默认左侧）、监听文件更改并自动同步（默认开启，可改为「仅提示，不自动刷新」）。
- **对话页面设置**：思考显示行数与编辑显示行数（各 5–30 行，默认 10）。

## 🎨 语法高亮

内置 **20+ 语言**：JavaScript/JSX、TypeScript/TSX、JSON、HTML、CSS/SCSS/Less、Markdown/MDX、Python、SQL、XML/SVG、YAML、C/C++、C#、Java、Rust、PHP、Go、Shell、PowerShell、Ruby、TOML、INI 与 Dockerfile。

`Makefile`、`.gitignore`、`LICENSE` 与未知扩展名以纯文本显示，仍可浏览与编辑。

## 📦 安装

在 Git Bash、Linux 或 WSL 中执行。先进入本插件所在目录（用你自己的路径替换）：

```sh
cd <插件目录>
bash ./install.sh          # 默认安装到 web profile
bash ./install.sh web      # 也可显式指定 profile
```

> 示例路径 `C:/GreenSoftware/deepseek-harness/deepseek-harness-plugin/dsh-workspace-studio`
> 中的 `deepseek-harness-plugin` 是作者自定义的插件目录名，不是固定要求。`install.sh` 以插件
> 目录为基准向上两级解析 Harness 根目录（供 PATH 无 `dsh` 时的 `pnpm --dir` 回退使用），因此
> **推荐把插件放在 Harness 根目录下两层的插件目录中**（与示例一致）；若 PATH 中已有 `dsh`，
> 插件放在任何位置都可安装。

脚本优先使用 PATH 中的 `dsh`；当前目录属于 Harness checkout 且 PATH 无 `dsh` 时自动使用 `pnpm --dir <harness-root> dsh`，也可用 `DSH_BIN` 指定可执行文件。安装完成后**停止并重启原有 Web 进程**（先停止再启动，让插件随 Web 进程重新加载生效），然后刷新 `http://127.0.0.1:3080`；脚本不会启动第二个服务器。

### 从 Git 直接安装

不依赖本地副本，直接从插件仓库安装（首次安装会用 tsdown 把 `src/client/` 与 `src/host/` 现场构建出 `lib/client.js` 与 `lib/index.js`）：

```sh
bash ./install.sh --git          # 默认安装到 web profile
bash ./install.sh --git web      # 也可显式指定 profile
```

脚本把 git 依赖 spec 解析为当前插件的 GitHub 仓库（可用 `GIT_SPEC` 环境变量覆盖），并锁定到当前 HEAD 提交（`github:<owner>/<repo>#<commit>`），因此后续推送不会悄悄改变已安装的代码。pnpm ≥ 10 默认拒绝执行 git 依赖的 `prepare` 构建脚本，首次 `add` 会失败；脚本会解析 pnpm 打印的 allowBuilds 键、写入该 profile 的 `pnpm-workspace.yaml`，然后重试，无需手动干预。

> ⚠️ 允许构建意味着允许该包的 `prepare` 脚本在安装时于你的机器上执行（不在 agent 沙箱内）。从本插件的官方仓库安装时这是预期行为。手动安装的等价命令是 `dsh plugin --profile web add github:yishengjun8/dsh-workspace-studio`：失败后按 pnpm 提示把 allowBuilds 键复制进该 profile 的 `pnpm-workspace.yaml`，再重跑 `add`。

## 🗑️ 卸载

```sh
bash ./uninstall.sh
```

卸载后同样需要重启 Web 进程；移除 bundle layer 后内置 `ui-layout` 自动恢复。

## ⚙️ 配置

`cordis.patch.yml` 中插件 row 接受：

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `enableEditing` | `false` | 是否启用 Host 写入接口；本 bundle 显式设为 `true`。 |
| `maxPreviewBytes` | `1048576` | 单文件读取并返回的最大字节（1024–10485760）。 |
| `maxEditableBytes` | `1048576` | 单文件可保存的最大 UTF-8 字节（1024–10485760）。 |
| `maxExternalUploadBytes` | `8388608` | 拖入的非工作区文件上传上限；预览仍按 `maxPreviewBytes` 截断（1024–268435456）。 |
| `maxEntryNameBytes` | `255` | 新建 / 重命名条目名称最大 UTF-8 字节（1–1024）。 |
| `maxMutationBodyBytes` | `4096` | create / rename 请求最大 JSON 字节（128–65536）。 |
| `maxContextBytes` | `65536` | 选中文本 UTF-8 预检上限（1024–1048576）；仅路径上下文不提交文件字节。 |
| `maxPromptContextBytes` | `69632` | Host 对完整渲染上下文（含封套与选中文本）的上限（4096–2097152）。 |
| `maxContextSourceBytes` | `10485760` | clean 修订校验最多读取的原始文件字节（1024–104857600）。 |
| `maxSearchQueryLength` | `1024` | 搜索内容最大字符数（1–4096）；含换行或控制字符的查询一律拒绝。 |
| `enableUpdateCheck` | `true` | 是否启用「插件更新」的检查与下载（设为 `false` 时检查返回禁用态、下载接口拒绝，设置页该组在首次检查后隐藏）。 |

搜索相关上限另有一组可调项：`searchExcludeDirs`（默认 `['.git', 'node_modules']`）、`maxSearchFileBytes`（1 MiB）、`maxSearchFiles`（10000）、`maxSearchMatches`（2000）、`maxMatchesPerFile`（100）、`searchConcurrency`（16）。

> 💡 改配置直接编辑 bundle 的 `cordis.patch.yml`；为避免 pnpm 复用已安装的本地 `file:` 副本，先运行 `uninstall.sh`，再运行 `install.sh`，最后重启 Web 进程。

## 🔒 安全边界

**路径包含校验**：Host 接口只接受已登记的 Workspace ID 与相对路径，每次读写都解析真实路径并确认目标仍位于 Workspace 规范根目录内，`..`、绝对路径与跳出 Workspace 的符号链接均不可访问；路径与文件名的每一段都套用 Windows 名称规则（不以点或空格结尾、非 `CON`/`PRN`/`AUX`/`NUL`/`CONIN$`/`CONOUT$`/`COM1-9`/`LPT1-9`）。Windows 上还拒绝含 `:` 的路径（驱动器相对形式 `C:`/`a:b` 的解析语义意外，且冒号在 Windows 文件名中非法）。接口同时执行与内置 `/api` 同目的的 Host、Origin 与 Fetch-Metadata 来源检查。

**写入保护**：写入接口仅在 `enableEditing` 开启时接受 `PUT`，正文必须是有上限的 UTF-8 文本，且必须携带读取时的 `If-Match` 修订版本，版本不一致返回冲突而不覆盖；写入目标必须是已存在且不经过任何符号链接的普通文件。create / rename 沿用相同的路径包含校验，要求单段名称、拒绝已存在目标，并拒绝 Windows 保留设备名与以点或空格结尾的名称。Host 通过同目录临时文件、文件同步与原子重命名提交，并尽量保留原权限模式。

**上下文安全**：编辑器上下文只接受拥有当前 Session 的 Workspace 内相对路径（拥有关系来自 membership projection 或会话规范化 cwd）；仅路径上下文不携带文件字节。Host 拒绝符号链接，按磁盘修订校验 clean 选区，`maxPreviewBytes` 截断预览时以浏览器提交文本为权威，并把渲染文本拼接在直接提示前，因此普通 Session 日志记录实际模型可见上下文；对话页把它折叠成气泡上方显示文件名与行列范围的一行摘要，历史只渲染已记录的用户消息，不重新读取当前编辑器或磁盘。

**自更新保护**：`/update/check` 与 `/update/download` 仅向受信任来源开放（与其余接口相同的 Host / Origin / Fetch-Metadata 门禁）；检查下载 main 分支源码包并缓存，安装的正是检查阶段缓存的那份（再次校验包名、版本与 `lib/`、`cordis.patch.yml` 等关键文件后提交），经同目录暂存、备份与原子改名完成，失败自动回滚；替换的是插件自身的安装目录（本地 `file:` 安装只影响 profile 副本）。检查与安装全程只走 `codeload.github.com`——`github.com` / `api.github.com` / `raw.githubusercontent.com` 常被 hosts 级 GitHub 加速代理指向本地并签发自签证书，Node 的 CA 库会拒绝，而 codeload 不受影响。更新只在用户在设置页明确点击后触发，不自动检查、不自动重启。

> ⚠️ 这些限制只约束资源管理器自己的文件接口与 Composer 上下文，不改变 agent 的权限策略、沙箱或工具能力；接口为受信任本地 UI 操作提供应用级路径包含校验，不替代 Harness 的内核级沙箱。

## 🧩 双面实现

一个包内封装三个端面：

- **Host 端**（`lib/index.js`）注册 `/workspace-studio/api`，按 Workspace ID 授权当前 Session（membership projection 或规范化 cwd），并分为五组接口：**读**（`/tree`、`/search`、`/file` GET/HEAD、`/raw`、`/external-file`、`/encodings`、`/reveal`）；**写**（仅在显式启用编辑时接受：`/file` PUT 保存、`/entry` 新建与重命名、`/fs` 复制 / 移动 / 删除，全部经修订版本校验、单段名称校验与原子替换，过期修订返回冲突而不静默覆盖）；**草稿**（`/draft`、`/draft-tree`，持久化到工作区之外的暂存盘，带 owner 校验、generation fence 与 tombstone）；**导图**（`/mindmap-doc` 读 / 写 / 删与 `/mindmap-doc/sync`、`/index`、`/rename`、`/models`、`/fork-cleanup`、`/regenerate-summary`、`/regenerate-all`、`/regenerate-session-summaries`、`/summarize-session`，按会话持久化导图文档、反向解析完整事件日志折叠所有会话的轮次，重命名只更新导图标题而不整份往返，AI 摘要的生成 / 重算 / 会话总结由 Host 串行调度）；**插件级**（`/update/check` 与 `/update/download` 支撑「插件更新」组，替换后需重启 dsh 生效；`/token-stats` 按客户端给定的 `[from, to)` 毫秒窗口汇总所有会话日志的 `assistant/message` usage 记录，`archived=0` 排除已归档会话，Host 以 `~/.dsh-plugin/dsh-workspace-studio/token-stats/usage-index.json` 增量缓存按日按模型的汇总结果并以持久化索引的 stat 修订号为变更信号）。
- **Browser 端**（`lib/client.js`）提供兼容的 `ctx.layout` 服务与 `usePanelInfo` 标准 Hook（`panelInfo` 根贡献），占用根 Slot，声明 `sidebar`、`main`（keyed，承载新版 Harness 的会话面板）、`details` 与 `shell.overlay`，并加入文件树、CodeMirror 6 浏览器 / 编辑器、编辑器上下文行、工作区设置页、`/init` 命令、渲染视图与会话分支导图（预览标签页）。
- **共享不变量**（`lib/invariant.js`）为每次 Host 请求提供路径包含与写入资格校验。

### 激活模型

layout 提供方有意不硬注入 `conversation`：conversation 插件本身消费 `layout`。因此 bundle 在激活后通过子注入包裹若干个具体 seam，避免形成激活依赖环：

- `sendSession` 与 `conversation.input.dock`：注册编辑器上下文行并把渲染后的上下文拼到直接提示前；提示型斜杠命令（`/plan <消息>`）另包会话的斜杠裁决器（`inputTriggers` 常驻 controller 的 `adjudicate`，覆盖「手输整行回车」）与 composer shell 的 `beginCommand`（覆盖「菜单选命令 / 空格成 claim 后再回车」），两条 claim 入口都接进上下文注入。
- `ctx.sidebarRight.openResource`：把聊天打开资源的路径接管到本插件的预览标签页（文件 / 计划 / 变更审查三类地址）；其余地址交还 harness，其「无右栏座位」的失败转成一条提示而不是未捕获异常。
- `ctx.sessions.fork`：监听 harness 自带的 fork 入口，做收件箱清理与导图家族同步。

这些包裹都遵循「标记 + 记录原实现」的约定，重复安装会先解开旧包裹而不是递归，卸载时按原样恢复。

### 已知限制与待办

上文这些 seam 适配的是 Harness 0.1.x 的具体 `sendSession`、输入提交、队列 steer、`ctx.sidebarRight.openResource` 与 `ctx.sessions.fork` 实现，因为跨包公开 face 不承载任意 Composer 上下文。它们都封装在本包内并在卸载时恢复，未来 Harness 版本可能只需更新本 bundle。

预览覆盖 Markdown、HTML、图片、只读文本分页、代码高亮，以及 PDF 与 Office 文档（Word / PowerPoint / Excel 经 Host 转 PDF）。Office 预览**依赖 Harness 的 `officeToPdf` 服务与本地 LibreOffice kit**：服务缺失时该标签给出配置提示；转换受 Host 的输入 / 输出体积、并发与超时限制约束，超出时报错可重试。表格预览是转换后的静态 PDF，不做浏览器内可编辑表格；`.csv / .tsv` 仍按文本打开。

布局状态、展开目录、编辑器选区与工作区暂存盘草稿状态均属页面内存状态；预览标签页及其各自的垂直滚动位置在重载后、以及返回原 Session 或 Workspace 时恢复（未保存内容本身存于暂存盘文件，见上文的暂存盘说明）。

### 模型体验

当前缀启用且 CodeMirror 主选区非空时，每次发送都会捕获该选区的精确文本、规范化工作区路径与范围，并渲染为 `<selection>...</selection>` 封套。选区为空时，每次发送只捕获打开的文件路径，并渲染固定的 `<opened_file>...</opened_file>` 封套；绝不提交完整文件。

Browser 发送桥把渲染后的文本拼接到直接用户提示前，因此普通 `user/message` 记录包含实际模型可见的上下文。对话页会把该封套折叠成气泡上方的一行摘要，只显示文件名与行列范围；鼠标悬浮该行会显示完整的注入 XML。灰色前缀不贡献上下文；后续每个启用回合都会再次记录相同上下文。

#### Token 与 KV 缓存影响

选区上下文会增加 `<selection>...</selection>` 封套以及选中文本的输入 Token。资源管理器先按默认 65,536 UTF-8 字节限制预检选中文本；Host 独立将完整渲染默认限制为 69,632 字节，并最多读取 10 MiB 用于 clean 修订版本校验。截断预览以浏览器权威的选区文本为准。仅路径上下文只增加 `<opened_file>...</opened_file>` 封套、不携带文件正文。每个启用回合都有自己的日志提示文本，因此 compaction 前重复选区可能增加提示 Token。

## 📁 项目结构

```text
.
├── package.json                         # 单包 manifest：bundle patch + client inject + exports
├── cordis.patch.yml                     # 禁用内置根布局并挂载本插件（自引用单包名）
├── install.sh / uninstall.sh
├── src/client/                           # 浏览器源码（多模块：入口壳 + 25 个顶层模块 + 5 个子目录）
│   ├── index.js / app.js                 # 纯入口 + AppFrame 组装与 mountStudio
│   ├── components/explorer/              # 文件树 / 预览 / 标签页 / 搜索 / 编辑器会话
│   ├── components/                       # 编辑器、设置页、菜单、对话框、手机模式
│   ├── mindmap/                          # 导图视图、卡片、注册表、全局宿主、fork 监听
│   ├── renderers/                        # 渲染器注册表与 Markdown / HTML / 图片 / PDF / Office / 分页视图
│   ├── hooks/  locale/                   # 布局域 Hook 与 zh / en 字典
│   └── constants.js / styles.js / api.js / drafts.js / merge.js / preview-tabs.js / …
├── src/host/                             # Host 源码（多模块，构建为 lib/index.js）
│   ├── index.js                          # Config schema + 路由分发
│   ├── http.js / paths.js / workspace.js # 信任围栏、路径校验、归属查询
│   ├── fs.js / write.js / encodings.js   # 读侧、写侧与编解码
│   └── drafts.js / prompt-context.js / markdown.js / mindmap.js / token-stats.js / update.js
├── lib/index.js                         # Host：有界的 Workspace 读、保存、新建、重命名、草稿、导图、统计与自更新 API
├── lib/invariant.js                     # Host 共用不变量断言
└── lib/client.js                        # 预构建三栏布局、文件树、编辑器、渲染视图与导图
```

CodeMirror 与语言模块已内联到预构建的普通 JavaScript Client bundle；本地 `file:` 安装无需构建，从 git 安装时 `prepare` 会用 tsdown 现场重新构建。维护源码时，在仓库根目录执行 `pnpm install --config.auto-install-peers=false`，再运行 `npm run bundle` 重新生成 `lib/client.js` 与 `lib/index.js`。

## 🔄 兼容性说明

本版本针对提供 `conversation.input.dock` Slot、Session 输入 resolver、会话发送服务、`ctx.sidebarRight.openResource` 与 `ctx.sessions.fork` 的 Harness `0.1.x` checkout 编写。编辑器上下文、聊天文件接管与导图均完全由本 bundle 实现，不要求修改 Harness 源码；上述 seam 都封装在 bundle 内的桥接代码里，未来版本可能只需更新这部分。其他高优先级 profile / home patch 若重新启用 `ui-layout`，会与本插件同时占用根 Slot；请保留本 bundle 对 `ui-layout` 的禁用设置。
