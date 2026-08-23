# @deepseek-ai/dsh-client-ui-workspace-explorer-layout

English | [中文](README.md)

The dual-face implementation package behind the `@deepseek-ai/dsh-workspace-explorer-layout` bundle: a Host entry that serves workspace-confined file access, and a Browser entry that renders the four-pane explorer Web layout.

## Overview

Both faces ship inside one bundle so the outer package can guard file access and draw the UI at the same time.

- **Host entry** (`lib/index.js`) registers `/workspace-explorer-layout/api`, lists directories by Workspace ID, reads bounded UTF-8 files, authorizes the current Session by membership or canonical cwd, and, when editing is explicitly enabled, saves existing regular files, creates files and folders, and renames entries through revision validation, single-segment name checks, and atomic replacement.
- **Browser entry** (`lib/client.js`) provides the compatible `ctx.layout` service, occupies the root Slot, keeps declaring `sidebar`, `conversation`, `details`, and `shell.overlay`, and adds the file tree, the CodeMirror 6 browser/editor, the editor-context row, the Explorer settings tab, and the `/init` command.
- **Shared invariants** (`lib/invariant.js`) back every Host request with path-containment and write-eligibility checks.

## Host entry: lib/index.js

- Registers `/workspace-explorer-layout/api` and authorizes the current Session by Workspace membership or by its canonical cwd.
- Lists directory entries by Workspace ID and reads bounded UTF-8 files; every request enforces path containment and write eligibility through `lib/invariant.js`.
- When editing is explicitly enabled, saves existing regular files, creates files and folders, and renames existing entries using revision validation, single-segment name checks, and atomic replacement.
- Refuses stale revisions instead of overwriting them.

## Browser entry: lib/client.js

### Layout and file tree

- Provides the compatible `ctx.layout` service, occupies the root Slot, and keeps declaring `sidebar`, `conversation`, `details`, and `shell.overlay`.
- Adds the file tree and the CodeMirror 6 browser/editor to the root layout; the opened Explorer may expand up to 80% of the visible layout while the chat column keeps shrinking.
- Opens files in per-Session preview tabs with drag reorder, close `X`, tree reveal, and per-tab scroll restore.
- Adds file/folder creation and `F2` rename actions in the tree, and registers the mobile-mode toggle in `sidebar.footer.action`.
- Tints each tree row's leading type badge by file-type color group (directory, TypeScript, JavaScript, JSON, markup, styles, Markdown, log, Python, C#, shell, config, C-family, other, blocked).

### Editor-context row

- Registers a non-editable editor-context row in the existing `conversation.input.dock` Slot; the prefix shows the open file path and the primary CodeMirror range.
- Stays outside the draft, tracks the composer card width when the column narrows, sits slightly taller, and nudges the icon and label a little to the right.
- Can be toggled between active and persistently gray per Session, and offers a context-only send action when the editable draft is empty.

### Explorer settings

- Groups every Explorer preference in one place on the browser Settings page under three headings.
- **File browsing** — tree row height, search-result default expand/collapse, and a per-group icon color scheme with instant preview.
- **Content browsing** — a per-file-type code-highlight preset (default, classic, warm, cool, mono), plus a VS Code palette for every code language and a Visual Studio 2022 palette.
- **Chat dialog** — chat font size and the streaming Think auto-expand switch (on by default: the chat opens a reasoning block while it streams and collapses it again after a configurable delay, 0–10 s in 0.1 s steps, default 3 s, unless the user interacts with the block during the window, deferring to manual interaction), plus the collapse-delay slider.
- Defaults each language group to its VS Code preset (XML, Python, JSON, TypeScript, JavaScript, CSS, Markdown, Shell, config, and C/C++), while C# defaults to the Visual Studio 2022 preset; dedicated resets restore the row height, the font size, all colors, or all presets.

### /init command

- Registers an `init` command in the `/` slash menu provided by `ui-commands` (similar to Claude Code's `/init`): it resolves the current session's workspace, shows a confirmation popup listing the target root, and sends the current agent an instruction to analyze the workspace and generate or update the root `AGENTS.md` (merging into existing content instead of blindly overwriting).
- Is available to direct sessions only and is skipped when the `commandUi` service is absent.

## Activation model

The layout provider intentionally does not hard-inject `conversation`: the conversation plugin itself consumes `layout`. The bundle therefore uses a child injection after activation to patch the existing `sendSession` seam and to register the editor row in `conversation.input.dock`, avoiding an activation cycle.

## Installation

Install this package through its outer bundle rather than adding it to a profile directly. Licenses covering third-party code in the prebuilt Client bundle are listed in `THIRD_PARTY_NOTICES.md`.

## Known Limitations and Deferred Work

The editor-context bridge adapts the concrete Harness 0.1.x `sendSession`, input-submit, and queue-steer implementations because the public cross-package faces do not carry arbitrary Composer context. These seams stay behind this package and are restored on unload, so a future Harness release may require updating only this bundle.

Layout state, expanded directories, editor selection, and the workspace draft cache remain page-memory state; preview tabs and their per-tab vertical scroll positions persist and are restored across reloads and when returning to the previous Session or Workspace.

## Model Experience

When the prefix is active and the primary CodeMirror selection is non-empty, each send captures that exact selected text, its normalized workspace path, and its range, then renders it as a `<selection>...</selection>` envelope. When the selection is empty, each send captures only the open file path and renders the fixed `<opened_file>...</opened_file>` envelope; it never submits the full file.

The Browser bridge prepends the rendered text to the direct user prompt, so the ordinary `user/message` record contains the exact model-visible context. The conversation view folds that same envelope into a compact row above the bubble, showing the file name and the line/column range; hovering that row reveals the full injected XML. Gray prefixes contribute no context, and the same context is intentionally recorded again on each later active turn.

### Token and KV cache effect

Selection contexts add the selected text plus the `<selection>...</selection>` envelope to input tokens. The Explorer preflights selected text against its default 65,536-byte UTF-8 limit; the Host independently bounds the complete rendering at 69,632 bytes by default and reads at most 10 MiB for clean revision verification. Truncated previews use browser-authoritative selection text. Path-only contexts add only the `<opened_file>...</opened_file>` envelope and no file bytes. Every active turn has its own logged prompt text, so repeated selections may increase prompt tokens until compaction.
