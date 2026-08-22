# @deepseek-ai/dsh-client-ui-workspace-explorer-layout

[English](README.en.md) | 中文

`@deepseek-ai/dsh-workspace-explorer-layout` bundle 的双面实现包：Host 端提供工作区受限的文件访问，Browser 端渲染四栏资源管理器 Web 布局。

## 概述

两个端面封装在同一个 bundle 里，让外层包既能守护文件访问、又能绘制界面。

- **Host 端**（`lib/index.js`）注册 `/workspace-explorer-layout/api`，按 Workspace ID 列目录、读取有上限的 UTF-8 文件，按 membership 或规范化 cwd 授权当前 Session，并在显式启用编辑时，通过修订版本校验、单段名称校验和原子替换保存已有普通文件、新建文件与文件夹、重命名已有条目。
- **Browser 端**（`lib/client.js`）提供兼容的 `ctx.layout` 服务，占用根 Slot，继续声明 `sidebar`、`conversation`、`details` 与 `shell.overlay`，并加入文件树、CodeMirror 6 浏览器/编辑器、编辑器上下文行、资源管理器设置页与 `/init` 命令。
- **共享不变量**（`lib/invariant.js`）为每次 Host 请求提供路径包含与写入资格校验。

## Host 端：lib/index.js

- 注册 `/workspace-explorer-layout/api`，按 Workspace membership 或规范化 cwd 授权当前 Session。
- 按 Workspace ID 列目录、读取有上限的 UTF-8 文件；每次请求都通过 `lib/invariant.js` 强制执行路径包含与写入资格校验。
- 显式启用编辑时，通过修订版本校验、单段名称校验和原子替换保存已有普通文件、新建文件与文件夹、重命名已有条目。
- 拒绝过期修订版本，而不是静默覆盖。

## Browser 端：lib/client.js

### 布局与文件树

- 提供兼容的 `ctx.layout` 服务，占用根 Slot，并继续声明 `sidebar`、`conversation`、`details` 与 `shell.overlay`。
- 在根布局中加入文件树与 CodeMirror 6 浏览器/编辑器；打开后的资源管理器最多扩展到可见布局的 80%，右侧对话栏继续收缩。
- 文件以按会话保存的预览标签页打开，支持拖拽重排、`X` 关闭、树中定位与按标签恢复滚动位置。
- 在树中提供新建文件/文件夹与 `F2` 重命名，并在 `sidebar.footer.action` 中、设置入口正上方注册资源管理器开关。
- 按文件类型颜色分组为每行前置类型徽标着色（目录、TypeScript、JavaScript、JSON、标记、样式、Markdown、日志、Python、C#、Shell、配置、C 系、其他、受阻）。

### 编辑器上下文行

- 通过现有 `conversation.input.dock` Slot 注册不可编辑的编辑器上下文行；前缀显示打开的文件路径与 CodeMirror 主选区。
- 位于草稿之外，列变窄时跟随聊天框宽度收缩，行本身略微加高，图标与文字稍微右移。
- 可按会话在「启用」与「持续灰色」之间切换；草稿为空时还提供「仅发送上下文」操作。

### 资源管理器设置

- 在浏览器设置页把资源管理器的全部偏好集中到一处，并按三大类分组。
- **文件浏览**——文件树行高、搜索结果默认展开/折叠、按分组自定义的图标颜色方案（即时预览）。
- **内容浏览**——按文件类型选择的代码高亮预设（默认、经典、暖色、冷色、单色），外加每种代码语言对应的 VS Code 配色与 Visual Studio 2022 配色。
- **对话框**——对话文字大小，以及流式思考内容自动展开开关（默认开启：聊天框在流式输出时展开推理块，结束后按可配置延迟再次收起，0–10 秒、分度 0.1 秒、默认 3 秒；窗口期内用户手动操作可取消，以手动操作为准），外加收起延迟滑块。
- 每个语言分组默认采用各自的 VS Code 预设（XML、Python、JSON、TypeScript、JavaScript、CSS、Markdown、Shell、配置与 C/C++），而 C# 默认采用 Visual Studio 2022 预设；并支持单独恢复行高或字号、一键恢复全部颜色或全部预设。

### /init 命令

- 在 `ui-commands` 提供的 `/` 斜杠菜单中注册 `init` 命令（类似 Claude Code 的 `/init`）：解析当前会话所属工作区，弹出确认项并显示目标根目录，向当前 Agent 发送「分析工作区并生成/更新根目录 `AGENTS.md`」的指令（已有文件时保留有价值内容合并更新，不盲目覆盖）。
- 仅直接会话可用；无 `commandUi` 服务时自动不注册。

## 激活模型

layout 提供方有意不硬注入 `conversation`：conversation 插件本身消费 `layout`。因此 bundle 在激活后通过子注入 patch 现有 `sendSession` seam，并向 `conversation.input.dock` 注册编辑器上下文行，避免形成激活依赖环。

## 安装

该包由外层 bundle 安装，不建议单独加入 profile。预构建 Client bundle 中第三方代码的许可证见 `THIRD_PARTY_NOTICES.md`。

## 已知限制与待办

编辑器上下文发送桥适配 Harness 0.1.x 具体的 `sendSession`、输入提交与队列 steer 实现，因为跨包公开 face 不承载任意 Composer 上下文。这些 seam 都封装在本包内并在卸载时恢复，未来 Harness 版本可能只需更新本 bundle。

布局状态、展开目录、编辑器选区与 Workspace 草稿缓存均属页面内存状态；预览标签页及其各自的垂直滚动位置在重载后、以及返回原 Session 或 Workspace 时恢复。

## 模型体验

当前缀启用且 CodeMirror 主选区非空时，每次发送都会捕获该选区的精确文本、规范化工作区路径与范围，并渲染为 `<selection>...</selection>` 封装。选区为空时，每次发送只捕获打开的文件路径，并渲染固定的 `<opened_file>...</opened_file>` 封装；绝不提交完整文件。

Browser 发送桥把渲染后的文本拼接到直接用户提示前，因此普通 `user/message` 记录包含实际模型可见的上下文。对话页会把该封装折叠成气泡上方的一行摘要，只显示文件名与行列范围；鼠标悬浮该行会显示完整的注入 XML。灰色前缀不贡献上下文；后续每个启用回合都会再次记录相同上下文。

### Token 与 KV 缓存影响

选区上下文会增加 `<selection>...</selection>` 封装以及选中文本的输入 Token。资源管理器先按默认 65,536 UTF-8 字节限制预检选中文本；Host 独立将完整渲染默认限制为 69,632 字节，并最多读取 10 MiB 用于 clean 修订版本校验。截断预览以浏览器权威的选区文本为准。仅路径上下文只增加 `<opened_file>...</opened_file>` 封装、不携带文件正文。每个启用回合都有自己的日志提示文本，因此 compaction 前重复选区可能增加提示 Token。
