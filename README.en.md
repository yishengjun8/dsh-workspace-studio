# 🗂️ DeepSeek Harness Workspace Studio Plugin (Left–Center–Right Three-Pane Layout)

English | [中文](README.md)

This bundle replaces the DeepSeek Harness Web root layout with **three panes from left to right: a left sidebar (session/workspace selector + file-tree view switch) · a highlighted file view and guarded editor · chat**. The file browser pane sits left of the chat by default and can be moved to its right in Workspace Settings → Content Browsing; the file tree no longer owns a pane: it is fused into the left sidebar and toggled against the session list via the buttons at the top. The session header's **Mind map** button enters **mind-map mode** anytime: the conversation branch tree opens as a tab in the preview area while the chat stays visible and usable on the right.

It preserves the existing sidebar, conversation, details, and global-overlay Slot contracts, so the built-in plugins keep owning new-session creation, session lists, settings, chat, tool details, and approvals. Tool details open as a right-side drawer over the three-pane layout instead of consuming a permanent pane.

## 📸 Screenshots

| ![Three-pane layout overview](image/image-1.png) | ![Mobile-mode conversation column](image/image-2.png) |
|---|---|

## ⭐ Four Core Capabilities

| # | Capability | What it buys you |
|---|---|---|
| 1 | 🗂️ **Workspace browsing and preview tabs** | Browse the workspace like an IDE next to the chat: file tree, per-session preview tabs, 14 encodings, and rendered Markdown / HTML / image / PDF / Office document views |
| 2 | ✏️ **Open-and-edit built-in editor** | CodeMirror 6 edits on open, every keystroke lands in a staging draft, and saving three-way merges against the disk — it **never silently overwrites** |
| 3 | 🧭 **Conversation branch mind map** | Turn one conversation line into a freely branching map: fork a new branch at any turn, manage branch sessions in one place, watch streaming output live |
| 4 | 🎯 **Editor context injection** | The open file or the selected code enters the conversation as `<opened_file>` / `<selection>`, so the model sees exactly what you picked |

### 1️⃣ Workspace Browsing and Preview Tabs

- The file tree is fused into the **left sidebar**, whose top row switches between **Sessions / File Explorer** views. The Workspace file tree appears automatically when the current Session belongs to a Workspace (also recognized when the Session `cwd` equals its path), sorting directories before files, expanding incrementally, and refreshing on demand. Expanded state **persists per session** and comes back after a reload; the tree's scroll position is also restored after a refresh re-lists the directories (preview-tab scroll positions ride the same per-session snapshot).
- **Preview tabs are saved per Session**: close them, drag to reorder, scroll the tab strip with the wheel, and they survive reloads. Right-click a tab to **pin** it (pin icon, sorts first, and **Close Other Tabs** only closes unpinned ones) or to **open it in a new window**. Unsaved edits show a `·` after the tab label and after the filename in the preview panel title.
- **A single file-tree click opens a temporary tab (italic); a double-click keeps it**: a single click is only a preview — clicking another file adds no tab, it swaps that italic tab for the new file in place; a **double-click** (or double-clicking the italic tab in the strip, pinning it, or starting to edit it) turns it into a real tab. There is at most one temporary tab at a time, a displacement never swallows unsaved work (a tab with edits is promoted first), and tabs restored after a reload are always permanent. Search results and chat file-opens keep opening permanent tabs.
- **View-as menu** (driven by a renderer registry, the same lineage as the Harness right-Sidebar document preview): Markdown switches between **source editing / rendered preview** and **opens in the rendered preview by default** (GFM: tables, task lists, strikethrough); HTML switches between **source editing / page preview** and **opens in the page preview by default**, with relative scripts and stylesheets read through the standard workspace-files API and packed into a sandboxed iframe (edits apply live, packing debounced by 400 ms); images (png / jpg / jpeg / gif / webp / bmp / ico / svg) preview directly; read-only text files can page through the full content. The view mode resets to that file's default on a file switch and is not persisted.
- **PDF and Office document previews** (two new renderer-registry kinds, `pdf` and `office`): a `.pdf` is read as its own bytes through the standard workspace-files API; a `.doc / .docx / .ppt / .pptx / .xls / .xlsx` is handed to the Harness Host's `officeToPdf` service, which **converts it to PDF locally with LibreOffice** (bounded queue, content-addressed cache, so reopening does not convert again). Both end as a blob URL given to the **browser's own PDF viewer**, so zoom, paging, text selection and printing all work without shipping a PDF engine in this bundle; missing fonts are listed in a banner. Such a tab is read-only like an image tab — no draft, no editor context — and a disk change re-converts it. When the Host does not mount the conversion service the tab says so instead of rendering nothing.
- **Encodings**: 14 encodings are auto-detected (UTF-8 / UTF-8 BOM / UTF-16 LE / BE / GBK / GB18030 / Big5 / Shift_JIS / EUC-JP / EUC-KR / ISO-8859-1 / Windows-1252 / Windows-1251 / ASCII); right-click the preview header to **Open With Encoding…** (re-decode) or **Save As Encoding…** (write back), with the current encoding shown as a badge. The encoding list is authoritative from the Host `/workspace-studio/api/encodings`, and a failed request falls back to the built-in list, so the actions never dead-end.
- **Chat file-opens land in the preview tabs**: opening a workspace file from the chat (a `dsh-resource://file/...` address) no longer goes to the Harness right Sidebar — it is resolved against the current session's workspace and opened directly as a preview tab here. A file **outside the workspace** becomes a session-only read-only preview tab (labelled "outside-workspace file"; nothing is written to the workspace and the tab is never persisted); only a session with no workspace reports an explicit notice.
- **Plan-opens land in the preview tabs too**: the review strip's "View full plan" link and the turn's plan card "Open" action (the `dsh-resource://plan/...` and `dsh-resource://plan-review/...` addresses) open the complete plan as rendered Markdown in a preview tab here. A logged plan is read from session history through the Harness plan resource; a temporary review document exists only in this page (its tab is not restored after a reload). Plan tabs are session-only and never enter the persisted preview snapshot.
- **Change reviews land in the preview tabs as well**: the closing turn's "changed files" card (its header or any file row; a `dsh-resource://changes-review/session/...` address) opens that turn's **change review** in a preview tab here — the turn's changed files on the left (with their +/− counts, and a label for binary or oversized ones) and the selected file's unified diff on the right, read through the Harness `api/changes.summary` / `api/changes.diff` routes (line numbers, `@@` hunk headers, added/deleted coloring, a truncation note past 5000 lines). The header offers "Open in editor" for the selected file (a file outside the workspace opens as the read-only preview). The tab selects the row that was clicked, and clicking another row of the same turn moves that tab instead of opening a second one; review tabs are session-only and never enter the persisted preview snapshot. The split between the file list and the comparison is **draggable** (arrow keys also step it), and its width is **page-local state**: it survives switching preview tabs, sessions, and workspaces, and returns to its default after a reload (like the review tab itself, it is never persisted).
- Drop external files into the preview pane to view them as read-only tabs (session-only; nothing is written to the workspace). Only text files are accepted; images belong to the chat composer, which is intentional.

### 2️⃣ Open-and-Edit Built-in Editor

- **Open directly in edit mode**: editable files need no **Edit** button; the panel header offers **Cancel**, **Save**, **Word wrap**, and **Reload from disk** (refresh). Read-only files (dropped external files, oversized, truncated, mixed line endings, symlink paths, or editing disabled) show a read-only reason banner.
- **Staging draft file**: entering edit mode takes one **snapshot** (the source content); all later temporary edits are debounce-written to a draft file **outside the workspace** (`~/.dsh-plugin/dsh-workspace-studio/drafts/<workspaceId>/`, long-lived), and the **source file is never touched**. A page refresh restores the draft, the snapshot, and the encoding together. Writing the draft is not a "save", so the `·` stays until an explicit save; localStorage only keeps the dirty marker, never content.
- **Saving three-way merges**: saving re-reads the source and compares it with the snapshot — an unchanged source is **silently written back** and its draft file deleted; changes in different places **merge automatically**, keeping both sides; a same-place conflict opens a dialog per region (the top two columns show the inline add/delete diff of *My changes* / *Disk version*, the bottom two the resulting code) where you pick **Keep my version / Keep disk version**, or cancel the save. **Cancel** deletes the draft and restores the editor to the source content without changing the source file.
- **External-change auto-sync**: on by default, checking each open tab against the disk roughly every 2 seconds. A clean, active tab changed by another tool reloads automatically (the tab flashes to show the content was swapped) and keeps its scroll position (switchable to notify-only without auto-reload); **every tab carries its own disk-state marker** — a blue ring = changed on disk (turns into ↻ on hover, click to reload in place, and background tabs are marked too), an amber dot = unsaved edits, an amber core with a blue ring = changed on disk while you have unsaved edits, and a red slashed ring with a struck-through name = the file was deleted; the tab context menu also offers Reload. **Dirty tabs are never overwritten** — only a notice is shown and you decide (saving merges or asks per region); a background tab is only marked, never reloaded automatically.
- **Highlighting and editing experience**: 20+ language highlighting, line numbers, **change marks** and **fold arrows**, and in-editor search (`Ctrl/Cmd+F`, `F3`); `Ctrl+K+J` unfolds every collapsed region, `Ctrl+K+1..9` folds by nesting level (e.g. `Ctrl+K+2` folds every second-level region), and `Ctrl/Cmd+S` works from any focus state (including the chat input). Each file-type group picks one of 10+ highlight presets (Default, Classic, Warm, Cool, Monochrome, XML (VS Code), …) from the settings page, remembered per type.
  - **Change marks** (against the repository base): the gutter order is `line numbers → add/modify/delete bars → fold arrows`; a green bar means added, a **blue bar means modified**, and a red triangle means lines were deleted here (a pure deletion puts the triangle at the top edge of the following line, or at the bottom edge of the last line when the deletion was at end of file). The line background is on by default (green wash for added, blue for modified, a thin red rule at the top of a deletion point) and can be turned off or recoloured in settings. Marks compare against the editor's **live content**, unsaved edits included, so they never jump when a save lands; when the base (Git `HEAD` / SVN `BASE`) cannot be read, the file is too large (over 20,000 lines or 2 MB), it is binary, or the diff exceeds the compute budget, nothing is painted and a grey **Changes not computed** item in the bottom status bar explains why.
  - **Fold arrows**: a vector chevron replaces the old `⌄` / `›` text glyphs — pointing down when expanded and rotating to point right when folded; half-transparent at rest and fully visible on row hover (or whenever the row is folded), with a full row-height hit area.
- Rejects binary, non-UTF-8, and out-of-Workspace symlink files; truncated large files, mixed-line-ending files, and symlink-traversing paths are read-only.

### 3️⃣ Conversation Branch Mind Map

- The session header's **Mind map** button enters **mind-map mode**: the map opens as a **preview tab** (inside `dsh-ws-preview`, switchable against file tabs) while the **chat stays visible and usable on the right**; closing is the tab's × button. On first entry the plugin reverse-parses the session's **full event log into all its turns**, renders the whole session as one chain of question cards, and persists them to `~/.dsh-plugin/dsh-workspace-studio/mindmap/` — that persisted document is the mind map's **single source of truth**.
- Entry asks for confirmation first: once the ordinary session is **converted** into a mind-map session, it is hidden from the sidebar session list and replaced by a self-drawn entry at the **end of the session list under its workspace group** (clicking it opens the session and docks the map as a preview tab); every fork session derived from the map is hidden from the list too and managed from the map only. The entry supports **drag-reordering** (order persisted per workspace group), right-click to **rename the map's own title** (independent of the root session title) or **Reveal in Explorer**; its icon spins while any session in the family is streaming.
- A **virtual root node** sits at the top of the map: clicking it creates a blank **top-level session** (no inherited turns, same workspace cwd, opened immediately so you can ask right away); right-clicking the root lets you choose the workspace new sessions belong to or archive the entire map. The toolbar can archive the whole map (with every branch session; the tab closes after archiving).
- Clicking a card is **switch-first, fork-as-fallback**: a card where a branch is parked (a chain-tail card) **switches to that branch** (the right-side chat follows, the highlight moves — free branch switching); a middle card with no parked branch (e.g. card 6 inside branch 6-7) **forks a new branch there** and enters chat, its new turns sitting beside its sibling (6 → 8, 9 beside 7). Every fork belongs to the **same main mind map** — a fork never creates a new map — and the new branch session stays hidden from the sidebar session list. The branch's new turns are folded back into the document by the Host sync from the branch session's full log.
- Right-click a branch to **rename** it; right-click any card (root-session cards included) to **delete the card** (a true truncation): a new session is forked from the previous card and replaces the original — this card, the turns after it, and every branch derived from them are removed, and the original session is archived (currently no restore path), so the chat and the map both continue from the truncation point with matching numbering. The map supports **grab-pan, wheel zoom**, and **Restore view**.
- **Streaming visualization**: while a branch is **generating** (a question was submitted and the agent is streaming), the map shows one live "**Generating…**" card for every generating session in the family, each carrying the in-flight question. Each streaming card and its **parent card** receive a matching colorful flowing gradient ring, and the connecting edge uses matching flowing dashes; when the turn completes the card converts into a normal card and the ring and flowing edge disappear. The streaming card is **clickable: it switches to the generating session** so the right-side chat follows it and you can watch the output live (the highlight moves along; an unfinished turn has no turn/end sequence, so it can never be a fork point, and its context menu stays disabled). The last completed card of a currently generating session is then treated as a **middle card** — clicking it **forks a new branch** there.
- **AI card summaries** (optional, off by default): once enabled under Workspace settings → Mind Map Browsing → AI card summary, the map summarizes each question with the chosen model (one small call per turn, minor token cost; the summary is a suggestion — hover a card to see the full text). Right-click a card to **regenerate its summary**, the toolbar can **regenerate all summaries**, the toolbar can also **regenerate all session summaries** (session head cards only — existing card summaries are never recalculated, and sessions missing card summaries have the missing ones generated first), and right-clicking a session head offers **summarize this session**. The summary model can follow the session model or be picked explicitly; the summary length and the session-summary length are adjustable separately (20–200 / 20–500 characters).
- **Hover actions on cards**: hovering a question card reveals a **Fold** text pill at its bottom-left (marks that turn folded, merging with adjacent folded cards into one **×N folded card**); after clicking a folded card to expand it temporarily, each expanded card shows **Unfold** at its bottom-left (**unfolds that one card only** — the run's other turns collapse back into a folded card) and **Fold now** at its bottom-right (folds the whole temporary expansion back into the folded card, no document write). The pill *replaces the card's status text in place* (same font size, same left edge, with the status row fading out while hovered), so nothing shifts or gets squeezed. A folded card (×N) itself carries no pill. Hovering a **session head card** instead shows **Archive** (bottom-left) and **Summarize** (bottom-right). The pill and the right-click menu's Fold / Fold now share one implementation; touch devices have no hover and keep using the right-click menu.

### 4️⃣ Editor Context Injection

- The editor context appears as a non-editable prefix outside the textarea through the existing input dock: active sends freeze the context and render `<opened_file>...</opened_file>` or, for selected text, `<selection>...</selection>` (no file bytes without a selection); gray sends attach nothing.
- The Host validates it and prepends it to the direct user prompt; the conversation view folds that envelope into a one-line summary above the bubble showing the file name and range (hover to reveal the full injected XML), and history renders the logged user message only.
- **A prompt that starts with a command carries the context too**: a slash command whose argument IS the prompt (such as `/plan <message>`) submits through the harness's command-claim transaction (`claim.submit` → `commands.execute`), which never reaches `sendSession`; the plugin prepends the envelope to the command's argument text. **Both entry routes inject** — typing the whole line and pressing Enter, and picking the command from the `/` menu (or the Space gesture) before typing the argument; on the second route the harness writes the claim token into the draft and Enter submits that stored claim without adjudicating, so the plugin wraps the claim where it is created. The model therefore still sees "file/selection + your message", and the bubble folding and title guard keep working. Control words (`/plan off`) and bare commands inject nothing. `/goal` is currently outside the injection list (its argument is persisted as the durable objective, where an XML envelope does not belong).
- A **title guard** in the client cleans envelope prefixes that leak into session titles.
- See **Model Experience** below for the token and KV-cache effect.

## ➕ Other Capabilities

| Capability | Description |
|---|---|
| 🧹 **File operations** | Right-click create / rename / copy / cut / paste / delete / copy name and path / **Reveal in Explorer**, with `F2`, `Ctrl/Cmd+C/X/V`, and `Del`; cut + paste = move, colliding targets auto-rename (`a.txt → a-1.txt`); the clipboard is in-memory and workspace-isolated, resetting on reload |
| 🔎 **Search** | Results group by file: click a file header to collapse / expand its matches, click a match to open the file at that line; case-sensitive toggling is supported; files only partly searched are marked **Partial** |
| 🌿 **Version control status** | When the workspace is a Git / SVN checkout, every piece of change information **lives in the file tree itself** (no extra panel): rows carry a status badge (modified / added / untracked / deleted / renamed / conflicted / ignored), directories roll up a change count, and **deleted** files appear as struck-through ghost rows under their original parent (not previewable). A strip above the tree names the repository, its branch (Git) or `r<revision>` (SVN) plus the total change count, and drives two filters: **Changes** keeps only changed files in the same tree and **auto-expands every directory that contains a change** (nothing to click open; session-only, and a refresh restores the full tree), while **Ignored** dims ignored entries. The **editor** paints the same semantics right of the line numbers (change marks, see *Built-in editor*), and the **bottom status bar** gains a `+n ~n −n` recap between its existing items (only when there are changes, and it says why when they could not be computed). Status comes from the local `git` / `svn` commands and is **read-only**: no network, no staging, no commits, no `index.lock` writes; a missing command or a failed read is reported in the strip (click to retry) instead of silently showing nothing |
| 💬 **Chat enhancements** | Think blocks and edit/write diffs stay visible as **persistent cards** whose body viewport lines are adjustable (5–30, default 10), scrollable for history, and collapsible from the title row |
| 🪟 **Open in new window** | Right-click a tab → **Open in new window**: Markdown renders as a document (GFM, no scripts on the page), HTML runs its page scripts as-is, other files show the raw text; links and images are allowlisted to http / https / mailto (image / PDF / Office tabs do not offer it) |
| 📄 **Document preview** | PDFs preview directly; Word / PowerPoint / Excel (.doc/.docx/.ppt/.pptx/.xls/.xlsx) preview as a PDF converted locally by the Harness Host, with a banner naming any missing fonts |
| 📊 **Token statistics** | A settings panel aggregates token usage from every session log over a standard week / calendar month (this week, last week, this month, last month, all) or a custom date range, as totals or a per-model breakdown (input, cache read, output; cache-write tokens are neither shown nor priced), including archived sessions by default; the per-model view also offers a **Model filter** that narrows the table by a name fragment (case-insensitive; separate multiple keywords with spaces or commas); the panel bottom adds a **Quick calculator**: enter input / cache read / output unit prices (per 1M tokens, with an editable currency symbol and optional per-row overrides) and it turns the models currently shown and checked into a cost |
| 🔄 **Plugin update** | The settings page checks the GitHub (yishengjun8/dsh-workspace-studio) main branch for a newer version, downloads and replaces **this end's** installed files inside its own profile in one click, and states the per-end activation step (Web: restart the process and refresh the page; Desktop: quit and reopen the app; a local `file:` install only replaces the profile copy) |
| ⚡ **`/init` command** | Generates or updates `AGENTS.md` at the current session's workspace root; when the file already exists a dialog offers **Update** or **Cancel**, and the current agent analyzes the workspace and generates it |
| 📱 **Mobile mode** | A sidebar-footer toggle collapses the layout into a centered phone column: the sidebar becomes a floating drawer opened by the whale at the top-left, and a **Browse files** button in the conversation header fills the phone column; transient, so a reload returns to the desktop layout |
| 🌐 **Bilingual UI** | The UI language follows Harness Settings → General → Language (Chinese / English) and switches live, with no restart or reload |
| 🔒 **Security boundary** | Workspace-confined read/write, path containment, revision conflict protection, and rejection of symlinks and Windows reserved names — see **Security Boundary** below |

## 🛠️ Workspace Settings

- **Plugin Update** (at the top of the settings page) and **Token Statistics**: see **Other Capabilities**. The token index is cached Host-side and **warmed up in the background on every dsh start**, so the panel answers instantly; while a background scan is still running it shows **partial results** and refreshes every 1.5 s (the footer reports "N / M sessions done").
- **Session Browsing**: the spin speed of the sidebar mind-map entry icon while the family streams (a 0–3x multiplier, default 1.2x, where 0 means no rotation).
- **Mind Map Browsing**: hover and selected highlight colors, session-head and end-card accent colors, the mount-edge curve amount (0–6x, default 5x, where 0 is a straight line), and **AI card summaries** (an enable toggle, the summary model, the summary length 20–200 chars with a 48 default, and the session-summary length 20–500 chars with a 64 default).
- **File Browsing**: tree row height, search result display (expanded / collapsed by default), file icon badge colors, and the editor's **change marks** (added / modified / deleted colours, defaulting to green `#1a7f37` / blue `#1a63d8` / red `#d92f24`, each resettable individually or all at once) plus the **line background** switch (on by default: washes each row with its add/modify/delete colour).
- **Version Control**: whether the file tree shows version control status at all (master switch — turning it off hides the strip, the badges and the **Changes** view and stops every request), whether ignored entries are dimmed (off by default; enabling it costs one extra ignore-list scan, and the switch is greyed out in the **Changes** view because an ignored file is not a change), whether `.git` / `.svn` directories are hidden (hidden by default, display only), whether the status auto-refreshes (on by default, every 20 seconds and only while the file-browsing page is visible), and a per-tone badge palette (modified / added / untracked / deleted / renamed / conflicted / ignored, each resettable individually or all at once).
- **Content Browsing**: per-type highlight presets, save-conflict dialog font size, whether the file browser pane sits left or right of the conversation column (default: left), and file watching with auto-sync (on by default, switchable to notify-only without auto-reload).
- **Conversation Page Settings**: Think lines and edit lines (5–30 each, default 10).

## 🎨 Syntax Highlighting

Built in for **20+ languages**: JavaScript/JSX, TypeScript/TSX, JSON, HTML, CSS/SCSS/Less, Markdown/MDX, Python, SQL, XML/SVG, YAML, C/C++, C#, Java, Rust, PHP, Go, Shell, PowerShell, Ruby, TOML, INI, and Dockerfile.

`Makefile`, `.gitignore`, `LICENSE`, and unknown extensions stay browsable and editable in plain text.

## 📦 Installation

Run from Git Bash, Linux, or WSL. First `cd` into the directory that holds this bundle (use your own path):

```sh
cd <bundle-dir>
bash ./install.sh          # default target is the web profile
bash ./install.sh web      # a profile can be supplied explicitly
```

> In the sample path `C:/GreenSoftware/deepseek-harness/deepseek-harness-plugin/dsh-workspace-studio`
> the `deepseek-harness-plugin` segment is the author's custom plugin folder name, not a requirement.
> `install.sh` resolves the Harness root as two levels above the bundle directory (for the
> `pnpm --dir` fallback when `dsh` is not on PATH), so **the recommended layout is a plugin folder
> two levels under the Harness root** (as in the example); with `dsh` on PATH the bundle can live
> anywhere.

The script picks the executable in this order: `DSH_BIN` when set, then `dsh` from PATH, then `pnpm --dir <harness-root> dsh` for a Harness checkout. After installation, **stop and restart the existing Web process** (stop it first, then start it again so the bundle reloads into the Web process), then refresh `http://127.0.0.1:3080`; the script does not start a second server.

### Install directly from Git

Install straight from the plugin repository without a local checkout. The repository commits its built artifacts (`lib/client.js`, `lib/index.js`, `lib/invariant.js`, and `cordis.patch.yml`) alongside the sources, so an install needs **no** build on the user's machine and pnpm ≥ 10 never asks for an `allowBuilds` entry:

```sh
bash ./install.sh --git          # default target is the web profile
bash ./install.sh --git web      # a profile can be supplied explicitly
```

The script resolves the git spec to this plugin's GitHub repository (override with the `GIT_SPEC` environment variable) and pins it to the current HEAD commit (`github:<owner>/<repo>#<commit>`), so a later push cannot silently change the installed code.

### Install through the built-in plugin manager

In the Web or Desktop "Plugins" panel choose "Add plugin" and enter one of these install sources (restart DSH afterwards):

```
github:yishengjun8/dsh-workspace-studio              # follow main
github:yishengjun8/dsh-workspace-studio#<commit>     # pin a commit
https://github.com/yishengjun8/dsh-workspace-studio  # equivalent form
```

> 💡 Only **older commits that still declare an install-time build script** make pnpm ≥ 10 refuse a git dependency and demand an allowance: copy the allowBuilds key pnpm prints into that profile's `pnpm-workspace.yaml` and retry (`install.sh --git` does this automatically). The current version ships no `prepare` script, so no allowance is needed.

### Desktop (packaged Electron app, Windows / macOS)

The Desktop app shares the **same profile mechanism and the same Web frontend** as the Web app (it is the Web application inside an Electron shell, and its Host is the complete Web composition), so this plugin has **no separate Desktop build** and needs no Desktop-specific code. The differences are which profile it installs into, which origin serves the page, and who restarts:

| Aspect | Web | Desktop |
|---|---|---|
| Profile | `$DSH_HOME/profiles/web` | `$DSH_HOME/profiles/desktop` (owned exclusively by the Desktop app) |
| Install | `install.sh` / Plugins panel | **the Desktop app's Plugins page only** (or the Desktop-provided `dsh` command) |
| Activation | restart the Web process, then refresh | **restart the app** (follow the Plugins page notice: "takes effect at the next start" means restart; refreshing the page does nothing on Desktop, which loads the bundled frontend) |
| Page origin | `http://127.0.0.1:3080` | `dsh-app://app` (its Host always listens on `127.0.0.1:19387`) |

- **Install**: Desktop → Plugins → Add plugin, with the same sources as Web (`github:yishengjun8/dsh-workspace-studio`, a pinned-commit form, or a `file:` / absolute local path), then restart the app. The Desktop and Web profiles are **two independent installed copies**: the "plugin update" action replaces only the copy it runs from (both update from the same GitHub repository).
- **"Plugin update" works on both ends and never crosses over**: each end's settings page fetches the same GitHub main branch and replaces only **its own** profile copy. On Desktop it takes effect only after you **quit and reopen the app** (refreshing the page does nothing there — it loads the frontend bundled into the app); on Web, restart the process and refresh the page. The panel picks its note from the install shape: a `file:` install says only the profile copy was replaced, a git install says the lockfile still pins the commit recorded at install time.
- **Desktop installs are usually git installs → the update does not change lockfile bookkeeping**: the Desktop profile's `pnpm-lock.yaml` still pins the commit resolved at install time and the update only swapped the directory under `node_modules/`, so a later plugin-page reinstall or dependency re-resolve can move the plugin back to that commit. To stay on one version long-term, go by the version the Plugins page installs. The swap also accepts only install copies **under this end's profile `node_modules/`**: a `link:` install (whose copy is the link target) or a built-in install is not inside a profile, so the check reports it as not updatable and the settings page explains instead of offering a download, while `/update/download` refuses it too — a link target or the app's own directory is never treated as an install copy.
- `install.sh` targets the Web profile. `bash ./install.sh desktop` works only when the `dsh` on PATH is the **Desktop command** (Desktop → "Manage dsh Command…" → Install); a registry `dsh` refuses the reserved profile, and the script then prints exactly those two routes and exits instead of leaving a half-finished install.
- **UI state is per origin; data is shared**: localStorage is scoped to the page origin, so settings, preview tabs, tree expansion, and mind-map viewport each have their own copy per side, while sessions, `$DSH_HOME` configuration, and `~/.dsh-plugin/dsh-workspace-studio/` (editor drafts, mind-map documents, update cache) are one shared store. Editing the same mind-map document from both sides at once resolves last-write-wins.
- **"Open in new window"**: the Desktop window hands only `http(s)` to the system browser and denies every other scheme, so that menu item opens the **default browser** there (the plugin's endpoints share the built-in `/api` trust shape, so a loopback request reads raw bytes without a cookie). Web behaviour is unchanged: a new browser tab.
- **The window caption row belongs to the plugin**: on Windows the shell paints its caption row (the window drag strip, the `Application` / `Edit` menus, and the native window buttons at the top right) over the page, and the Harness reserved that row inside `ui-layout`'s own root frame — which this plugin disables through its root-layout patch. The plugin's three-pane frame therefore reserves the same 40 px band, keeps it as the window's drag region, and republishes the window-chrome clearances (`--dsh-frame-*`) that Harness overlays read, so the settings dialog and portalled menus still start below the band. Web has no such row and is unaffected.
- **Change state through the Plugins page, never by hand-editing the profile**: after the Desktop app applies a plugin state change (enable / disable / install) it materializes `$DSH_HOME/profiles/desktop/cordis.yml` into a **full entry tree** (a measured disable turned that file from a 223 B empty root into 45 KB, and the same second removed the plugin from `dsh.profile.bundles`). Editing `dsh.profile.bundles` by hand does enable the bundle, but it leaves that materialized result disagreeing with the manifest and makes later diagnosis needlessly hard — use the Plugins page.
- **Version control status never assumes PATH**: a Desktop shell (especially a macOS GUI process) usually inherits a PATH that cannot find `git` / `svn`. When the command is not found by name, the plugin probes the platform's usual install locations once (macOS: `/usr/local/bin`, `/opt/homebrew/bin`, `/opt/local/bin`, `/usr/bin`; Windows: `%ProgramFiles%\Git\cmd`, `%ProgramFiles%\TortoiseSVN\bin`, `%ProgramFiles%\Subversion\bin`, built from environment variables rather than hardcoded drives). When neither works, the status strip says "No git / svn command found" (amber, click to retry) instead of silently showing no status; the Host's `gitExecutable` / `svnExecutable` can also point at an absolute path, which is then used exclusively. This is the same code as Web (a capability probe, not a Desktop branch).
- **If it will not start**: should the plugin break Desktop Host startup, the native recovery dialog offers "Disable third-party plugins, back up profile patch, and restart"; installed package files are preserved, and the plugin can be re-enabled from the Plugins page once fixed.
- **Verified**: the official nightly Desktop app (Electron 44 / Node 24.18.1 / bundled dsh 0.2.0-rc.2 / pnpm 11.7.0) loads 1.0.20 installed from GitHub — the Host serves this plugin's `/workspace-studio/api/*` responses, and the client half writes its UI state under the `dsh-app://app` origin (localStorage). The bundled dsh version is fixed by the release: if it differs from the Web version you run, re-check the maintainer's local harness coupling-point list once — that is ordinary version-upgrade work, unrelated to Desktop.

## 🗑️ Uninstallation

```sh
bash ./uninstall.sh
```

Restart the existing Web process after removal; the built-in `ui-layout` returns when the bundle layer is removed.

## ⚙️ Configuration

The plugin row in `cordis.patch.yml` accepts:

| Field | Default | Description |
|---|---:|---|
| `enableEditing` | `false` | Enables the Host write endpoints; this bundle patch sets it to `true`. |
| `maxPreviewBytes` | `1048576` | Maximum bytes read and returned for one file (1024–10485760). |
| `maxEditableBytes` | `1048576` | Maximum UTF-8 bytes saved for one file (1024–10485760). |
| `maxExternalUploadBytes` | `8388608` | Upload cap for a dragged-in non-workspace file; the preview still truncates to `maxPreviewBytes` (1024–268435456). |
| `maxEntryNameBytes` | `255` | Maximum UTF-8 bytes allowed for one create/rename entry name (1–1024). |
| `maxMutationBodyBytes` | `4096` | Maximum JSON bytes accepted by create and rename requests (128–65536). |
| `maxContextBytes` | `65536` | Explorer preflight maximum for selected-text UTF-8 bytes (1024–1048576); path-only contexts submit no file bytes. |
| `maxPromptContextBytes` | `69632` | Host maximum for the complete rendered context, including the envelope and selected text (4096–2097152). |
| `maxContextSourceBytes` | `10485760` | Maximum raw source bytes read for clean revision verification (1024–104857600). |
| `maxSearchQueryLength` | `1024` | Maximum search query length in characters (1–4096); queries containing newlines or control characters are always refused. |
| `enableUpdateCheck` | `true` | Enables the "Plugin Update" check and download (when `false` the check answers a disabled state, the download endpoint refuses, and the settings group hides itself once the user has run a check). |

A separate group tunes search: `searchExcludeDirs` (default `['.git', 'node_modules']`), `maxSearchFileBytes` (1 MiB), `maxSearchFiles` (10000), `maxSearchMatches` (2000), `maxMatchesPerFile` (100), and `searchConcurrency` (16).

Version control status adds another group:

| Field | Default | Description |
|---|---:|---|
| `enableVcsStatus` | `true` | Enables the file browser's version control status endpoint; when `false` it only answers `enabled:false` and the client hides the strip, the badges and the changes list. |
| `gitExecutable` | `git` | The `git` executable; an absolute path is used **exclusively** (no PATH or install-location fallback). |
| `svnExecutable` | `svn` | The `svn` executable, same semantics. |
| `vcsTimeoutMs` | `10000` | Timeout of one `git` / `svn` call (1000–120000); a timeout degrades to "read failed, click to retry". |
| `vcsCacheTtlMs` | `8000` | How long a status payload stays cached (0–600000); client polls mostly hit it, and `refresh=1` bypasses it. |

Two further caps apply: `vcsMaxEntries` (default 5000, above which the counter shows `5000+`) and a fixed 8 MiB per-call output limit; the base read behind the editor's change marks is additionally bounded by `maxPreviewBytes` (above it, no marks are computed — see *File Browsing* settings).

> 💡 Edit the bundle's `cordis.patch.yml` to change these values. To prevent pnpm from reusing an installed local `file:` copy, run `uninstall.sh`, then `install.sh`, and finally restart the Web process.

## 🔒 Security Boundary

**Path containment**: Host endpoints accept only registered Workspace IDs and relative paths; every read or write resolves the real path and confirms the target stays under the canonical Workspace root, so `..`, absolute paths, and out-of-Workspace symlinks are inaccessible. Every path and file-name segment also obeys the Windows name rules (never ending in a dot or space, never `CON`/`PRN`/`AUX`/`NUL`/`CONIN$`/`CONOUT$`/`COM1-9`/`LPT1-9`). On Windows, paths containing `:` are rejected as well (drive-relative forms like `C:`/`a:b` resolve surprisingly, and a colon is illegal in Windows file names). The endpoints also enforce Host, Origin, and Fetch-Metadata source checks equivalent to the built-in `/api` routes.

**Write protection**: The write endpoint accepts `PUT` only when `enableEditing` is enabled; the body must be bounded UTF-8 text carrying the read-time `If-Match` revision, and a mismatch returns a conflict without overwriting. The target must be an existing regular file reached without any symbolic link. Create and rename reuse the same containment checks, require single-segment names, refuse existing targets, and reject Windows reserved device names and names ending in a dot or space. The Host commits through a same-directory temporary file, file synchronization, and atomic rename, preserving the original permission mode when possible.

**Version control is read-only**: The status endpoint only reads — it runs `git status --porcelain=v1 -z --untracked-files=all -- .` with the workspace as `cwd` (when the workspace is a subdirectory of the repository, `--` confines it to that subtree and `--show-prefix` converts repository-root-relative paths into workspace-relative ones, dropping anything outside) or `svn status --xml --depth infinity`; the base endpoint (which feeds the editor's change marks) only calls `git show HEAD:<path>` or `svn cat -r BASE <path>`, both pure reads. `shell: false`, every argument is a literal, and no client-supplied string ever reaches a command line; `--no-optional-locks` plus `GIT_OPTIONAL_LOCKS=0` guarantee that `.git/index.lock` is never written, `core.fsmonitor=false` keeps file-monitor daemons from being spawned, and `GIT_TERMINAL_PROMPT=0` prevents a credential prompt from hanging the call. Every call carries a timeout and an 8 MiB output cap, with a separate entry-count cap. It performs **no** staging, commit, checkout or pull, and **never touches the network** (`svn status` runs without `-u` and no ahead/behind query is made, so no "behind the server" state is ever shown).

**Context safety**: Editor context accepts only a relative path in a Workspace that owns the current Session (through its membership projection or the Session's canonical cwd); a path-only context carries no file bytes. The Host rejects symbolic links, validates clean selections against their disk revision, treats previews truncated by `maxPreviewBytes` as browser-authoritative, and prepends the rendered text to the direct prompt, so the ordinary Session log records the exact model-visible context. The conversation view folds that envelope into a one-line summary above the bubble showing the file name and range, and history renders the logged user message without rereading the current editor or disk.

**Self-update protection**: `/update/check` and `/update/download` are open only to trusted sources (the same Host / Origin / Fetch-Metadata fence as the other endpoints); the check downloads and caches the main-branch tarball, and the install consumes exactly those cached bytes (re-verified — package name, version, and the `lib/` and `cordis.patch.yml` files) through a same-directory staging dir, a backup, and atomic renames, rolling back automatically on failure. The swap targets the plugin's own install directory (a local `file:` install only affects the profile copy), and only when that directory really sits **under this end's profile `node_modules/`**: a `link:` install (whose install copy is the link target) or a built-in install is not inside a profile, so `/update/check` returns `updateSupported: false` (the settings page then replaces the download button with an explanation) and `/update/download` refuses — a link target or the app's own directory is never treated as an install copy. The check cache (`~/.dsh-plugin/dsh-workspace-studio/updates/`) is shared by both ends and the install consumes exactly what the check cached. Both endpoints use only `codeload.github.com`: `github.com` / `api.github.com` / `raw.githubusercontent.com` are commonly redirected to a local TLS proxy by hosts-level GitHub accelerators whose self-signed certificate Node's own CA store rejects, while codeload is unaffected. Updates are triggered only by an explicit click in the settings page — never automatically — and never restart dsh by themselves.

> ⚠️ These constraints govern only the explorer's file endpoints and Composer context; they do not change Agent permission policy, sandboxing, or tool capability. The endpoints provide application-level path-containment checks for trusted local UI use and do not replace Harness kernel-level isolation.

## 🧩 Dual-Face Implementation

One package ships three faces:

- **Host entry** (`lib/index.js`) registers `/workspace-studio/api`, authorizing the current Session by Workspace ID (membership projection or canonical cwd), split into six endpoint groups: **read** (`/tree`, `/search`, `/file` GET/HEAD, `/raw`, `/external-file`, `/encodings`, `/reveal`); **write** (accepted only when editing is explicitly enabled: `/file` PUT save, `/entry` create and rename, `/fs` copy / move / delete, all through revision validation, single-segment name checks, and atomic replacement, refusing stale revisions instead of silently overwriting); **context** (`/context` verifies the clean selection against the on-disk revision and renders the `<opened_file>` / `<selection>` envelope for the client to submit); **draft** (`/draft`, `/draft-tree`, persisted outside the workspace with owner validation, a generation fence, and tombstones); **mind map** (`/mindmap-doc` read / write / delete plus `/mindmap-doc/sync`, `/index`, `/rename`, `/models`, `/fork-cleanup`, `/regenerate-summary`, `/regenerate-all`, `/regenerate-session-summaries`, and `/summarize-session`, persisting per-session mind-map documents built by reverse-parsing full event logs and folding in every session's turns, with renames updating only the map title instead of round-tripping the whole document and AI-summary generation/regeneration/session-summarization serialized by the Host); and **plugin-global** (`/update/check` and `/update/download` back the "Plugin Update" group, with a dsh restart required to apply the swap, while `/token-stats` aggregates the `assistant/message` usage records of every session log over a client-supplied `[from, to)` epoch-ms window — `archived=0` excludes archived sessions — cached incrementally at `~/.dsh-plugin/dsh-workspace-studio/token-stats/usage-index.json`, keyed for change detection by `sessionRowFingerprint` — a session's own physical revision plus `sizeBytes`, with a legacy row's store-wide corpus suffix stripped).
- **Browser entry** (`lib/client.js`) provides the compatible `ctx.layout` service and the `usePanelInfo` standard hook (the `panelInfo` root contribution), occupies the root Slot, declares `sidebar`, `main` (keyed, hosting the newer Harness conversation panel), `details`, and `shell.overlay`, and adds the file tree, the CodeMirror 6 browser/editor, the editor-context row, the Workspace settings tab, the `/init` command, the renderer views, and the conversation-branch mind map (preview tab).
- **Shared invariants** (`lib/invariant.js`): registers this package's ownership with the Harness invariant registry and installs **no runtime checks**; per-request path-containment, symlink, and write-eligibility validation lives in `src/host/paths.js` and `src/host/write.js`.

### Activation Model

The layout provider intentionally does not hard-inject `conversation`: the conversation plugin itself consumes `layout`. The bundle therefore uses child injections after activation to wrap several concrete seams, avoiding an activation cycle:

- `sendSession` and `conversation.input.dock`: register the editor-context row and prepend the rendered context to the direct prompt. Prompt-bearing slash commands (`/plan <message>`) get two more wrappers: the session's slash adjudicator (the resident `inputTriggers` controller's `adjudicate`, for a line typed and submitted in one go) and the composer shell's `beginCommand` (for a claim established earlier by the `/` menu or the Space gesture) — both claim entry routes feed the same injection.
- `ctx.sidebarRight.openResource`: take over the chat's resource-open path into this plugin's preview tabs (file, plan, and change-review addresses); every other address is handed back to the harness, whose "no right-Sidebar seat" failure becomes one notice instead of an uncaught throw.
- `ctx.sessions.fork`: watch the harness's own fork entry points to clear the fork inbox and sync the mind-map family.

Every wrapper follows the marker + recorded-original convention, so an overlapping re-install unwraps the stale wrapper instead of recursing, and unload restores the original.

### Known Limitations and Deferred Work

Those seams adapt the concrete Harness 0.1.x `sendSession`, input-submit, queue-steer, `ctx.sidebarRight.openResource`, and `ctx.sessions.fork` implementations, because the public cross-package faces do not carry arbitrary Composer context. All of them stay behind this package and are restored on unload, so a future Harness release may require updating only this bundle.

Preview coverage spans Markdown, HTML, images, paged read-only text, code highlighting, and now PDF and Office documents (Word / PowerPoint / Excel converted to PDF by the Host). Office previews **depend on the Harness `officeToPdf` service and the local LibreOffice kit**: without that service the tab shows configuration guidance, and conversion obeys the Host's input/output size, concurrency, and timeout limits, reporting a retryable error when they are exceeded. Spreadsheets preview as the converted static PDF — there is no in-browser editable grid — and `.csv / .tsv` still open as text.

Editor selection and similar transient state stay in page memory; preview tabs, expanded directories, the sidebar/preview pane widths, per-tab vertical scroll positions, and the staging-draft state all come back — tabs, expanded directories, and widths are restored from local persistence across reloads and when returning to the previous Session or Workspace (unsaved content itself lives in staging-draft files, described above).

### Model Experience

When the prefix is active and the primary CodeMirror selection is non-empty, each send captures that exact selected text, its normalized workspace path, and its range, then renders it as a `<selection>...</selection>` envelope. When the selection is empty, each send captures only the open file path and renders the fixed `<opened_file>...</opened_file>` envelope; it never submits the full file.

The Browser bridge prepends the rendered text to the direct user prompt, so the ordinary `user/message` record contains the exact model-visible context. The conversation view folds that same envelope into a compact row above the bubble, showing the file name and the line/column range; hovering that row reveals the full injected XML. Gray prefixes contribute no context, and the same context is intentionally recorded again on each later active turn.

#### Token and KV Cache Effect

Selection contexts add the selected text plus the `<selection>...</selection>` envelope to input tokens. The Explorer preflights selected text against its default 65,536-byte UTF-8 limit; the Host independently bounds the complete rendering at 69,632 bytes by default and reads at most 10 MiB for clean revision verification. Truncated previews use browser-authoritative selection text. Path-only contexts add only the `<opened_file>...</opened_file>` envelope and no file bytes. Every active turn has its own logged prompt text, so repeated selections may increase prompt tokens until compaction.

## 📁 Project Structure

```text
.
├── package.json                         # Single-package manifest: bundle patch + client inject + exports
├── cordis.patch.yml                     # Disables the built-in root layout and mounts this plugin (self-referencing)
├── install.sh / uninstall.sh
├── src/client/                           # Browser source (multi-module: an entry shell + 29 top-level modules + 5 subdirectories)
│   ├── index.js / app.js                 # Pure entry + AppFrame assembly and mountStudio
│   ├── components/explorer/              # File tree / preview / tabs / search / editor session
│   ├── components/                       # Editor, settings page, menus, dialogs, mobile mode
│   ├── mindmap/                          # Mind-map view, cards, registry, global host, fork watch
│   ├── renderers/                        # Renderer registry plus Markdown / HTML / image / PDF / Office / paged views
│   ├── hooks/  locale/                   # Layout-domain hooks and the zh / en dictionaries
│   └── constants.js / styles.js / api.js / drafts.js / merge.js / preview-tabs.js / …
├── src/host/                             # Host source (multi-module; bundles to lib/index.js)
│   ├── index.js                          # Config schema + route dispatch
│   ├── http.js / paths.js / workspace.js # Trust fence, path validation, ownership lookups
│   ├── errors.js / session-rows.js       # Structured-error primitives, persistence.list row primitives
│   ├── fs.js / write.js / encodings.js   # Read side, write side, and codecs
│   └── drafts.js / prompt-context.js / markdown.js / mindmap.js / token-stats.js / update.js
├── lib/index.js                         # Host: bounded Workspace read, save, create, rename, draft, mind-map, stats, and self-update API
├── lib/invariant.js                     # Package registration with the Harness invariant registry (no-op; see Dual-Face Implementation)
└── lib/client.js                        # Prebuilt three-pane layout, file tree, editor, renderer views, and mind map
```

CodeMirror and its language modules are bundled into the prebuilt plain-JavaScript Client artifact; both a local `file:` install and a git install use the `lib/` already committed to the repository (no build runs at install time). To maintain the source, run `pnpm install --config.auto-install-peers=false` in the repo root and then `npm run bundle` to regenerate `lib/client.js` and `lib/index.js`, **and commit the rebuilt artifacts** — a git install and the in-app update both take that committed `lib/`.

## 🔄 Compatibility

This version targets a Harness that provides the `conversation.input.dock` Slot, the session input resolver, the conversation send service, `ctx.sidebarRight.openResource`, and `ctx.sessions.fork`; the **verified baseline is Harness `0.2.0-rc.2`** (the same version ships in the Web app and in the official nightly Desktop app), and it requires the shell to provide the `@deepseek-ai/dsh-client-ui-primitives` platform seed. The editor context, the chat file-open takeover, and the mind map are implemented entirely by this bundle and do not require modified Harness source; those seams all live in the bundle's bridge code, so a future release may need only that part updated. A higher-priority profile/home patch that re-enables `ui-layout` competes for the root Slot; retain this bundle's `ui-layout` disable entry. This plugin is **equivalent on Web and on the packaged Desktop app**: every feature is expected to work on both with no second artifact, and the only differences are the profile, the page origin, and how a change takes effect (see the "Desktop" section above); a capability that genuinely cannot be equivalent is documented there with its degraded behaviour rather than failing silently.
