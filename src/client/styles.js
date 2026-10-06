export const styles = `
.dsh-ws-viewport{position:relative;height:100%;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-ws-frame{--dsh-ws-sidebar:280px;--dsh-ws-preview:420px;position:relative;display:grid;grid-template-columns:var(--dsh-ws-sidebar) var(--dsh-ws-preview) minmax(0,1fr);grid-template-rows:100%;width:100%;min-width:0;height:100%;overflow:hidden;background:var(--dsw-alias-bg-base);transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-ws-frame[data-resizing]{transition:none;user-select:none}.dsh-ws-sidebar,.dsh-ws-tree,.dsh-ws-preview,.dsh-ws-chat{min-width:0;height:100%;overflow:hidden}.dsh-ws-sidebar{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1)}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right]{grid-template-columns:var(--dsh-ws-sidebar) minmax(0,1fr) var(--dsh-ws-preview)}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right] .dsh-ws-sidebar{grid-column:1;grid-row:1}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right] .dsh-ws-chat{grid-column:2;grid-row:1}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right] .dsh-ws-preview{grid-column:3;grid-row:1;border-right:0;border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-ws-tree,.dsh-ws-preview{display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2)}.dsh-ws-chat{display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-base)}
/* Windows Desktop (Electron): the shell draws a caption row (drag strip, menu bar,
   native controls) over the page. This plugin's patch disables ui-layout, so that
   markup and its stylesheet are gone and this frame owns the reservation plus the
   window-chrome clearance tokens portalled overlays read (--dsh-ws-caption-h is the
   published band height). See AGENTS.md「双端目标」and docs/development-notes.md §39. */
html[data-windows-titlebar]{--dsh-ws-caption-h:var(--dsh-windows-titlebar-height,40px);--dsh-frame-top-clearance:var(--dsh-ws-caption-h);--dsh-frame-chrome-top:var(--dsh-ws-caption-h);--dsh-frame-overlay-top:calc(var(--dsh-ws-caption-h) + 20px)}
html[data-windows-titlebar][data-fullscreen]{--dsh-frame-chrome-top:0px;--dsh-frame-overlay-top:20px}
html[data-windows-titlebar] .dsh-ws-frame{box-sizing:border-box;padding-top:var(--dsh-ws-caption-h);grid-template-rows:minmax(0,1fr)}
html[data-windows-titlebar] .dsh-ws-frame::before{content:'';position:absolute;inset:0 0 auto;height:var(--dsh-ws-caption-h);background:var(--dsw-specific-sidebar-fill);-webkit-app-region:drag}
/* Absolute children resolve against the padding box, which still spans the band:
   keep the content-level ones below it. The sidebar's own caption controls stay
   fixed and no-drag where the shell put them, so the band stays draggable. */
html[data-windows-titlebar] .dsh-ws-details{top:var(--dsh-ws-caption-h)}
html[data-windows-titlebar] .dsh-ws-splitter{top:var(--dsh-ws-caption-h)}
/* macOS desktop: the disabled frame also published the portalled overlays'
   clearance; mirror its values (that platform pads no frame). */
html[data-platform='darwin']{--dsh-frame-top-clearance:48px;--dsh-frame-overlay-top:calc(48px + 20px)}
html[data-platform='darwin'][data-fullscreen]{--dsh-frame-overlay-top:20px}
.dsh-ws-panel-header{display:flex;align-items:center;gap:8px;min-height:52px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}.dsh-ws-panel-title{min-width:0;display:flex;flex:1;flex-direction:column;gap:2px}.dsh-ws-panel-title strong{overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-panel-title>span{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}
/* Preview page top rows share the sidebar fill so the file browsing page reads as one band with the sidebar. */
.dsh-ws-preview .dsh-ws-panel-header{background:var(--dsw-specific-sidebar-fill)}.dsh-ws-preview .dsh-ws-preview-file-header{min-height:26px;gap:4px;padding:0 8px}.dsh-ws-preview-file-path{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-preview-file-header .dsh-ws-icon-button{width:22px;height:22px}.dsh-ws-preview-file-header .dsh-ws-icon-button svg{width:14px;height:14px}.dsh-ws-preview-file-header .dsh-ws-text-button{height:22px;padding:0 6px;font-size:11px}
.dsh-ws-panel-actions{display:flex;flex:none;align-items:center;gap:2px}.dsh-ws-icon-button,.dsh-ws-text-button{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.dsh-ws-icon-button{width:30px;padding:0;font-size:18px}.dsh-ws-icon-button svg{display:block;width:16px;height:16px}.dsh-ws-icon-button:hover,.dsh-ws-text-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-icon-button:disabled,.dsh-ws-text-button:disabled{cursor:not-allowed;opacity:.55}
/* Preview text size: the file header's first control (left of 控制台) publishes
   --dsh-ws-content-scale for the ACTIVE tab; 1 = 100% = the harness's own body size,
   so an untouched tab renders pixel-identically. It sizes the SOURCE EDITOR's text only —
   the header hides it in every rendered / read-only state, the chrome keeps its fixed
   sizes, and the gutter slots keep their widths so nothing shifts sideways. Click turns
   the number button into an input: 1px accent box, 20px tall so the 26px header row does
   not grow, and as wide as the button it replaces so the row never jumps. */
.dsh-ws-font-size{flex:none;display:inline-flex;align-items:center;gap:0}
.dsh-ws-font-size .dsh-ws-font-step{padding:0 4px}
.dsh-ws-font-a{font-weight:600;letter-spacing:.2px}
.dsh-ws-font-a[data-glyph='sm']{font-size:9px;align-self:flex-end;margin-bottom:3px}
.dsh-ws-font-a[data-glyph='lg']{font-size:13px;align-self:flex-end;margin-bottom:1px}
.dsh-ws-font-sign{font-size:12px;line-height:1;margin-left:1px}
.dsh-ws-font-value{min-width:40px;justify-content:center;padding:0 3px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-ws-font-value[data-inherit]{text-decoration:underline dotted;text-decoration-color:var(--dsw-alias-label-caption);text-underline-offset:3px}
.dsh-ws-font-input{display:inline-flex;align-items:center;height:20px;padding:0 5px 0 0;box-sizing:border-box;border:1px solid var(--dsw-alias-state-business-primary);border-radius:6px;background:var(--dsw-alias-bg-base)}
.dsh-ws-font-field{width:26px;height:16px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:16px;text-align:right;font-variant-numeric:tabular-nums;outline:none}
.dsh-ws-font-field::selection{background:var(--dsw-alias-interactive-bg-active)}
/* An emptied field is not an error — empty means "follow the base size" — so it shows that size as
   ghosted placeholder text instead of flagging anything. */
.dsh-ws-font-field::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-ws-font-pct{padding-left:1px;color:var(--dsw-alias-label-caption);font-size:10px}
/* The size acts on the rule that OWNS this editor's metrics: .cm-scroller (the
   12px/19px pair above, scaled). Sizing .cm-editor does nothing — the scroller sets
   its own font-size, so the text never moves; that mistake shipped first. The scroller
   also contains .cm-gutters, so line numbers scale while the diff / fold slots keep
   their fixed widths. Deliberately NOT applied to the rendered views (.dsh-ws-md-preview,
   .dsh-ws-html-preview, the paged browse, the run console): they show content this
   control does not size — hence the hidden header there — and their type ladder
   belongs to the harness components. */
.dsh-ws-icon-button:focus-visible,.dsh-ws-text-button:focus-visible,.dsh-ws-tree-row:focus-visible,.dsh-ws-preview-tab-button:focus-visible,.dsh-ws-preview-tab-close:focus-visible,.dsh-ws-preview-tab-mark:focus-visible,.dsh-ws-splitter:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-ws-tree-scroll{flex:1;min-height:0;overflow:auto;padding:8px 6px 16px}.dsh-ws-tree-row{display:flex;align-items:center;gap:5px;width:100%;height:var(--dsh-ws-row-height,28px);padding:0 7px 0 calc(7px + var(--dsh-ws-depth,0) * 15px);border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;box-sizing:border-box}.dsh-ws-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-tree-row[data-selected]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.dsh-ws-tree-row:disabled{cursor:not-allowed;opacity:.55}.dsh-ws-tree-row[data-cut]{opacity:.55}
.dsh-ws-chevron{display:inline-flex;align-items:center;justify-content:center;flex:0 0 12px;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-ws-file-mark{display:inline-flex;align-items:center;justify-content:center;flex:0 0 16px;width:16px;height:16px;border-radius:4px;background:color-mix(in srgb,var(--dsh-ws-file-accent,var(--dsw-alias-label-tertiary)) 16%,transparent);color:var(--dsh-ws-file-accent,var(--dsw-alias-label-tertiary));font-size:8px;font-weight:600;text-transform:uppercase}.dsh-ws-file-mark[data-group='directory']{--dsh-ws-file-accent:var(--dsh-ws-file-directory,#3b82f6)}.dsh-ws-file-mark[data-group='typescript']{--dsh-ws-file-accent:var(--dsh-ws-file-typescript,#3178c6)}.dsh-ws-file-mark[data-group='javascript']{--dsh-ws-file-accent:var(--dsh-ws-file-javascript,#e5c158)}.dsh-ws-file-mark[data-group='json']{--dsh-ws-file-accent:var(--dsh-ws-file-json,#e07a3c)}.dsh-ws-file-mark[data-group='markup']{--dsh-ws-file-accent:var(--dsh-ws-file-markup,#e04a3c)}.dsh-ws-file-mark[data-group='style']{--dsh-ws-file-accent:var(--dsh-ws-file-style,#a855f7)}.dsh-ws-file-mark[data-group='markdown']{--dsh-ws-file-accent:var(--dsh-ws-file-markdown,#12a5a0)}.dsh-ws-file-mark[data-group='log']{--dsh-ws-file-accent:var(--dsh-ws-file-log,#d99a2b)}.dsh-ws-file-mark[data-group='python']{--dsh-ws-file-accent:var(--dsh-ws-file-python,#4b8bb8)}.dsh-ws-file-mark[data-group='shell']{--dsh-ws-file-accent:var(--dsh-ws-file-shell,#22a06b)}.dsh-ws-file-mark[data-group='config']{--dsh-ws-file-accent:var(--dsh-ws-file-config,#8a95a5)}.dsh-ws-file-mark[data-group='c-family']{--dsh-ws-file-accent:var(--dsh-ws-file-c-family,#5a7ba6)}.dsh-ws-file-mark[data-group='csharp']{--dsh-ws-file-accent:var(--dsh-ws-file-csharp,#a25fd0)}.dsh-ws-file-mark[data-group='other']{--dsh-ws-file-accent:var(--dsh-ws-file-other,#9aa3ad)}.dsh-ws-file-mark[data-group='blocked']{--dsh-ws-file-accent:var(--dsh-ws-file-blocked,#e5484d)}.dsh-ws-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Version-control status (git / svn, read-only): the strip above the tree, the changes
   list and the row badges. Tones read --dsh-ws-vcs-* (user colors, defaulting to the
   picker's own hex so picked == rendered); with no repository none of it renders. */
.dsh-ws-vcs-bar{flex:none;display:flex;align-items:center;gap:6px;height:26px;padding:0 8px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-sizing:border-box;font-size:11px}
.dsh-ws-vcs-chip{display:flex;align-items:center;gap:5px;flex:1;min-width:0;height:20px;padding:0 6px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dsh-ws-vcs-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-vcs-icon{flex:none;display:inline-flex;width:12px;height:12px;color:var(--dsw-alias-label-tertiary)}
.dsh-ws-vcs-icon svg{width:12px;height:12px}
.dsh-ws-vcs-kind{flex:none;color:var(--dsw-alias-label-tertiary);font-weight:600;letter-spacing:.02em}
.dsh-ws-vcs-label{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-vcs-count{flex:none;min-width:16px;padding:0 5px;border-radius:8px;background:color-mix(in srgb,var(--dsh-ws-vcs-modified,#b7791f) 16%,transparent);color:var(--dsh-ws-vcs-modified,#b7791f);font-weight:600;text-align:center}
.dsh-ws-vcs-chip[data-state=loading] .dsh-ws-vcs-label{color:var(--dsw-alias-label-tertiary)}
.dsh-ws-vcs-chip[data-state=warn] .dsh-ws-vcs-label,.dsh-ws-vcs-chip[data-state=warn] .dsh-ws-vcs-icon{color:var(--dsh-ws-vcs-modified,#b7791f)}
.dsh-ws-vcs-chip[data-state=error] .dsh-ws-vcs-label,.dsh-ws-vcs-chip[data-state=error] .dsh-ws-vcs-icon{color:var(--dsh-ws-vcs-deleted,#d92f24)}
.dsh-ws-vcs-toggle{flex:none;height:20px;padding:0 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;cursor:pointer}
.dsh-ws-vcs-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-vcs-toggle[aria-pressed=true]{border-color:var(--dsh-ws-vcs-renamed,#1a63d8);background:color-mix(in srgb,var(--dsh-ws-vcs-renamed,#1a63d8) 14%,transparent);color:var(--dsh-ws-vcs-renamed,#1a63d8)}
.dsh-ws-vcs-toggle:disabled{opacity:.55;cursor:not-allowed}
.dsh-ws-tree-row[data-ignored] .dsh-ws-row-name,.dsh-ws-tree-row[data-ignored] .dsh-ws-file-mark{opacity:.55}
.dsh-ws-tree-row[data-deleted] .dsh-ws-row-name{text-decoration:line-through}
.dsh-ws-vcs-badge{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 3px;border-radius:4px;font-size:10px;font-weight:700;font-variant-numeric:tabular-nums}
.dsh-ws-vcs-badge[data-shape=hollow]{background:transparent;box-shadow:inset 0 0 0 1px currentColor}
.dsh-ws-vcs-badge[data-tone=modified],.dsh-ws-vcs-badge[data-tone=dirty-dir]{color:var(--dsh-ws-vcs-modified,#b7791f);background:color-mix(in srgb,var(--dsh-ws-vcs-modified,#b7791f) 16%,transparent)}
.dsh-ws-vcs-badge[data-tone=added]{color:var(--dsh-ws-vcs-added,#1a7f37);background:color-mix(in srgb,var(--dsh-ws-vcs-added,#1a7f37) 16%,transparent)}
.dsh-ws-vcs-badge[data-tone=untracked]{color:var(--dsh-ws-vcs-untracked,#1a7f37);background:color-mix(in srgb,var(--dsh-ws-vcs-untracked,#1a7f37) 16%,transparent)}
.dsh-ws-vcs-badge[data-tone=deleted],.dsh-ws-vcs-badge[data-tone=conflict-dir]{color:var(--dsh-ws-vcs-deleted,#d92f24);background:color-mix(in srgb,var(--dsh-ws-vcs-deleted,#d92f24) 16%,transparent)}
.dsh-ws-vcs-badge[data-tone=renamed]{color:var(--dsh-ws-vcs-renamed,#1a63d8);background:color-mix(in srgb,var(--dsh-ws-vcs-renamed,#1a63d8) 16%,transparent)}
.dsh-ws-vcs-badge[data-tone=conflict]{color:var(--dsw-alias-label-primary-inverted);background:var(--dsh-ws-vcs-conflict,#d92f24)}
.dsh-ws-vcs-badge[data-tone=ignored]{color:var(--dsh-ws-vcs-ignored,#8a9099);background:color-mix(in srgb,var(--dsh-ws-vcs-ignored,#8a9099) 16%,transparent)}
/* Staged = a left bar; a property-only change = a bottom bar; both can apply at once. */
.dsh-ws-vcs-badge[data-staged]{box-shadow:inset 2px 0 0 0 var(--dsh-ws-vcs-added,#1a7f37)}
.dsh-ws-vcs-badge[data-props]{box-shadow:inset 0 -2px 0 0 currentColor}
.dsh-ws-vcs-badge[data-staged][data-props]{box-shadow:inset 2px 0 0 0 var(--dsh-ws-vcs-added,#1a7f37),inset 0 -2px 0 0 currentColor}.dsh-ws-symlink{margin-left:auto;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-ws-tree-status{padding:8px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dsh-ws-tree-status[data-error]{color:var(--dsw-alias-state-error-primary)}.dsh-ws-empty{display:flex;flex:1;min-height:0;align-items:center;justify-content:center;padding:24px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;text-align:center}
.dsh-ws-preview-header-meta{display:flex;align-items:center;gap:6px;min-width:0}.dsh-ws-preview-header-meta>span:not(.dsh-ws-language):not(.dsh-ws-encoding){overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-language{flex:0 0 auto;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px;text-transform:uppercase}.dsh-ws-encoding{flex:0 0 auto;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px;text-transform:uppercase}/* Per-tab disk-state marker: one fixed 12px slot between the name and the close button. Runtime only — the clean state renders no node at all, so a normal tab is not widened. */
.dsh-ws-preview-tab-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;padding:0;border:0;border-radius:3px;background:transparent;color:inherit;font:inherit;cursor:default;box-sizing:border-box}
.dsh-ws-mark-core{display:block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-label)}
.dsh-ws-mark-reload{display:none;color:var(--dsw-alias-state-business-primary);font-size:12px;line-height:1}
/* Disk moved while the tab is clean: a hollow ring, which turns into a reload affordance on hover. */
.dsh-ws-preview-tab-mark[data-kind='stale']{cursor:pointer}
.dsh-ws-preview-tab-mark[data-kind='stale'] .dsh-ws-mark-core{width:9px;height:9px;background:transparent;border:1.5px solid var(--dsw-alias-state-business-primary)}
.dsh-ws-preview-tab-mark[data-kind='stale']:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent)}
.dsh-ws-preview-tab-mark[data-kind='stale']:hover .dsh-ws-mark-core{display:none}
.dsh-ws-preview-tab-mark[data-kind='stale']:hover .dsh-ws-mark-reload{display:block}
/* Disk moved while the tab holds unsaved edits: two-tone, and deliberately not clickable (a reload would bin the draft). */
.dsh-ws-preview-tab-mark[data-kind='conflict'] .dsh-ws-mark-core{width:10px;height:10px;background:var(--dsw-alias-state-warn-label);border:1.5px solid var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 1.5px var(--dsw-specific-sidebar-fill)}
/* File deleted on disk: ring plus a slash. */
.dsh-ws-preview-tab-mark[data-kind='gone'] .dsh-ws-mark-core{position:relative;width:9px;height:9px;background:transparent;border:1.5px solid var(--dsw-alias-state-error-primary)}
.dsh-ws-preview-tab-mark[data-kind='gone'] .dsh-ws-mark-core::after{content:'';position:absolute;inset:0;margin:auto;width:8px;height:1.5px;background:var(--dsw-alias-state-error-primary);transform:rotate(-45deg)}
/* AUTO-mode reload feedback: the tab whose content an automatic sync just replaced flashes once, so a silent swap is visible. The overlay (not the tab background) keeps the active tint intact, and the forwards fill mode holds it invisible until the flag is cleared. */
.dsh-ws-preview-tab[data-flash]::after{content:'';position:absolute;inset:0;pointer-events:none;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 26%,transparent);animation:dsh-ws-tab-flash 700ms var(--ds-ease-out,ease-out) forwards}
@keyframes dsh-ws-tab-flash{from{opacity:1}to{opacity:0}}
@media (prefers-reduced-motion:reduce){.dsh-ws-preview-tab[data-flash]::after{animation:none;opacity:0}}.dsh-ws-preview-tabs{display:flex;align-items:stretch;gap:0;min-width:0;height:29px;padding:0;box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill);overflow-x:auto;overflow-y:hidden}.dsh-ws-preview-tab{flex:none;position:relative;display:flex;align-items:center;gap:5px;min-width:0;max-width:220px;padding:0 5px 0 9px;border-radius:0;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:grab;box-sizing:border-box;white-space:nowrap}.dsh-ws-preview-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-preview-tab[data-active]{border-bottom:2px solid var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,transparent);color:var(--dsw-alias-state-business-primary)}.dsh-ws-preview-tab[data-dragging]{opacity:.7}/* A single-click preview tab stays italic until it is made permanent (double-click, first edit, or pin). */.dsh-ws-preview-tab[data-temporary] .dsh-ws-preview-tab-name{font-style:italic}.dsh-ws-preview-tab-mindmap{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;color:var(--dsw-alias-state-business-primary)}.dsh-ws-preview-tab-mindmap svg{width:12px;height:12px}.dsh-ws-preview-tabs::-webkit-scrollbar{height:0;background:transparent}@supports not selector(::-webkit-scrollbar){.dsh-ws-preview-tabs{scrollbar-width:none}}.dsh-ws-preview-scrollbar{position:absolute;top:29px;left:0;right:0;height:4px;border-radius:2px;opacity:0;pointer-events:none;transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);touch-action:none;z-index:3}.dsh-ws-preview-scrollbar[data-visible='true']{opacity:1;pointer-events:auto}.dsh-ws-preview-scrollbar-thumb{height:100%;min-width:24px;border-radius:2px;background:var(--dsw-alias-scrollbar-bg-l1)}.dsh-ws-preview-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l1)}.dsh-ws-preview-drop-indicator{flex:none;width:3px;height:20px;border-radius:2px;background:var(--dsw-alias-state-business-primary);align-self:center;pointer-events:none}.dsh-ws-preview-tab-button{display:flex;flex:0 1 auto;align-items:center;gap:5px;min-width:0;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.dsh-ws-preview-tab-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.dsh-ws-preview-tab-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-left:auto;border:0;border-radius:2px;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer}.dsh-ws-preview-tab-close svg{display:block;flex:none;width:16px;height:16px}.dsh-ws-preview-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.dsh-ws-preview-tab-close:disabled{cursor:not-allowed;opacity:.45}.dsh-ws-preview-body{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--dsw-alias-markdown-code-block)}.dsh-ws-editor-host{height:100%;min-width:0}.dsh-ws-editor-host .cm-editor{height:100%;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary)}.dsh-ws-editor-host .cm-scroller{font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:calc(12px * var(--dsh-ws-content-scale,1));line-height:calc(19px * var(--dsh-ws-content-scale,1));overflow:auto}.dsh-ws-editor-host .cm-gutters{background:var(--dsw-alias-markdown-code-block-banner);color:var(--dsw-alias-label-caption);border-right:1px solid var(--dsw-alias-border-l2)}.dsh-ws-editor-host .cm-activeLine,.dsh-ws-editor-host .cm-activeLineGutter{background:var(--dsw-alias-interactive-bg-hover)}.dsh-ws-editor-host .cm-selectionBackground,.dsh-ws-editor-host .cm-content ::selection{background:var(--dsw-alias-interactive-bg-active)!important}.dsh-ws-editor-host .cm-cursor{border-left-color:var(--dsw-alias-label-primary)}.dsh-ws-editor-host .cm-foldPlaceholder{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}

/* Editor change gutter (repository base vs the live buffer). Left-to-right order is line numbers →
   change marks → fold arrows; the tones come from --dsh-ws-diff-* (Workspace Settings → File
   Browsing), falling back to the same default hex the settings picker shows. */
.dsh-ws-editor-host .dsh-ws-diffGutter{width:9px}
.dsh-ws-editor-host .dsh-ws-diffGutter .cm-gutterElement{display:flex;align-items:center;justify-content:center;padding:0}
.dsh-ws-editor-host .dsh-ws-diffMark{position:relative;display:block;width:9px;height:100%}
.dsh-ws-editor-host .dsh-ws-diffMark[data-kind=added]::before{content:'';position:absolute;left:1px;top:0;bottom:0;width:4px;border-radius:1px;background:var(--dsh-ws-diff-added,#1a7f37)}
.dsh-ws-editor-host .dsh-ws-diffMark[data-kind=modified]::before{content:'';position:absolute;left:1px;top:0;bottom:0;width:4px;border-radius:1px;background:var(--dsh-ws-diff-modified,#1a63d8)}
.dsh-ws-editor-host .dsh-ws-diffMark[data-deleted=top]::after{content:'';position:absolute;left:2px;top:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid var(--dsh-ws-diff-deleted,#d92f24)}
.dsh-ws-editor-host .dsh-ws-diffMark[data-deleted=bottom]::after{content:'';position:absolute;left:2px;bottom:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:6px solid var(--dsh-ws-diff-deleted,#d92f24)}
.dsh-ws-editor-host .dsh-ws-diff-line-added{background:color-mix(in srgb,var(--dsh-ws-diff-added,#1a7f37) 10%,transparent)}
.dsh-ws-editor-host .dsh-ws-diff-line-modified{background:color-mix(in srgb,var(--dsh-ws-diff-modified,#1a63d8) 10%,transparent)}
.dsh-ws-editor-host .dsh-ws-diff-line-deleted-top{box-shadow:inset 0 2px 0 -0.5px color-mix(in srgb,var(--dsh-ws-diff-deleted,#d92f24) 60%,transparent)}
.dsh-ws-editor-host .dsh-ws-diff-line-deleted-bottom{box-shadow:inset 0 -2px 0 -0.5px color-mix(in srgb,var(--dsh-ws-diff-deleted,#d92f24) 60%,transparent)}
/* Scrollbar change ruler (VS Code's overview ruler): the preview column's VERTICAL bars
   are widened and the editor's track paints the change map UNDER the native slider — two
   gradients written as custom properties on view.scrollDOM, so dragging, paging, keyboard,
   trackpad and auto-hide stay native. Width / mark span come from Workspace Settings →
   Version Control (off: the harness's 8px look). Horizontal bars are deliberately left
   alone — thicker would only eat code width; "none" is a file with no computable base. */
/* The preview column's bars take the file tree's elevated-surface binding (l2) instead of the body's
   l1: in light the two tokens match, in dark l2 sits one neutral step brighter — what the tree has
   always shown. */
.dsh-ws-preview{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-ws-preview[data-diff-ruler='on']{--dsh-ws-ruler-w:calc(var(--dsh-ws-vscroll-w,14px) - 6px);--dsh-scrollbar-width:var(--dsh-ws-vscroll-w,14px)}
.dsh-ws-preview[data-diff-ruler='on'][data-diff-ruler-span='full']{--dsh-ws-ruler-w:var(--dsh-ws-vscroll-w,14px)}
.dsh-ws-preview[data-diff-ruler='on'] ::-webkit-scrollbar:vertical{width:var(--dsh-ws-vscroll-w,14px)}
/* The slider must not hide the marks it passes over: same size, but translucent, with
   the darker hover token paying the alpha back so the bar never reads fainter than the
   default one. A held slider is still hovered, so the hover value is what matters while
   DRAGGING — at 65% the marks stay legible in both themes, which 90% failed at. */
.dsh-ws-preview[data-diff-ruler='on'] ::-webkit-scrollbar-thumb:vertical{background-color:color-mix(in srgb,var(--dsh-scrollbar-thumb-hover) 55%,transparent);background-clip:padding-box;border:3px solid transparent;border-radius:7px}
.dsh-ws-preview[data-diff-ruler='on'] ::-webkit-scrollbar-thumb:vertical:hover{background-color:color-mix(in srgb,var(--dsh-scrollbar-thumb-hover) 65%,transparent)}
/* Hover / drag highlight, EDITOR SCROLLER ONLY: a 1px accent ring hugging the capsule, so
   the translucent slider still reads as "grabbable" without darkening its fill (which would
   hide the marks). An inset box-shadow is required — a real border would outline the whole
   14px track and shrink the fill to 12px, and outline does not paint on scrollbar
   pseudo-elements at all (verified). With the ruler off, the bar is harness default again. */
.dsh-ws-preview[data-diff-ruler='on'] .dsh-ws-editor-host .cm-scroller::-webkit-scrollbar-thumb:vertical:hover{box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsh-ws-preview[data-diff-ruler='on'][data-diff-ruler-thumb='full'] ::-webkit-scrollbar-thumb:vertical{border-width:0}
.dsh-ws-editor-host .cm-scroller::-webkit-scrollbar-track:vertical{background-image:var(--dsh-ws-ruler-ticks,none),var(--dsh-ws-ruler-bands,none);background-repeat:no-repeat;background-position:center top;background-size:var(--dsh-ws-ruler-w,8px) 100%,var(--dsh-ws-ruler-w,8px) 100%}
/* Fold arrows: one vector chevron per foldable line, replacing CodeMirror's ⌄ / › text glyphs
   (font-dependent metrics, no rotation, no hover affordance). */
.dsh-ws-editor-host .cm-foldGutter{width:15px}
.dsh-ws-editor-host .cm-foldGutter .cm-gutterElement{display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.dsh-ws-editor-host .cm-foldGutter .cm-gutterElement:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-editor-host .dsh-ws-foldMark{display:inline-flex;align-items:center;justify-content:center;width:15px;height:100%}
.dsh-ws-editor-host .fold-mark{display:block;width:10px;height:10px;color:var(--dsw-alias-label-tertiary);opacity:.5;transition:transform .12s ease,opacity .12s ease}
.dsh-ws-editor-host .cm-foldGutter .cm-gutterElement:hover .fold-mark{opacity:1;color:var(--dsw-alias-label-primary)}
.dsh-ws-editor-host .fold-mark[data-open=false]{opacity:1;color:var(--dsw-alias-label-secondary);transform:rotate(-90deg)}
/* The change summary rides the EXISTING bottom status bar as one more item (plus a divider), so the
   bar keeps its original layout: actions │ summary │ file meta … transient notice. */
.dsh-ws-status-divider{flex:none;width:1px;height:12px;background:var(--dsw-alias-border-l2)}
.dsh-ws-diff-summary{flex:none;display:flex;align-items:center;gap:8px;min-width:0;font-variant-numeric:tabular-nums}
.dsh-ws-diff-token{display:inline-flex;align-items:center;gap:3px;padding:0 4px;border-radius:4px;font-weight:600;line-height:15px}
.dsh-ws-diff-token[data-kind=added]{color:var(--dsh-ws-diff-added,#1a7f37);background:color-mix(in srgb,var(--dsh-ws-diff-added,#1a7f37) 12%,transparent)}
.dsh-ws-diff-token[data-kind=modified]{color:var(--dsh-ws-diff-modified,#1a63d8);background:color-mix(in srgb,var(--dsh-ws-diff-modified,#1a63d8) 12%,transparent)}
.dsh-ws-diff-token[data-kind=deleted]{color:var(--dsh-ws-diff-deleted,#d92f24);background:color-mix(in srgb,var(--dsh-ws-diff-deleted,#d92f24) 12%,transparent)}
.dsh-ws-diff-count{min-width:1.2em;text-align:right}
.dsh-ws-diff-muted{flex:none;padding:0 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-tertiary);line-height:15px}.dsh-ws-editor-host .cm-panels{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dsh-ws-editor-host .cm-panel input{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dsh-ws-context-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:none;width:min(var(--dsh-composer-card-max-width),max(0px,calc(100% - (var(--dsh-composer-side-clearance) * 2))));margin:0 auto;padding:0}.dsh-ws-context-prefix{display:flex;flex:1;align-items:center;gap:6px;min-width:0;min-height:28px;padding:5px 8px 5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:22px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;text-align:left;cursor:pointer}.dsh-ws-context-prefix:hover{color:var(--dsw-alias-label-primary)}.dsh-ws-context-prefix:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.dsh-ws-context-prefix[data-inactive]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);filter:grayscale(1)}.dsh-ws-context-prefix-mark{flex:none;font-size:12px}.dsh-ws-context-prefix-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-message-context-summary{box-sizing:border-box;display:flex;align-items:center;align-self:flex-end;gap:6px;max-width:100%;min-height:24px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:22px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}.dsh-ws-message-context-summary-mark{flex:none;font-size:12px}.dsh-ws-message-context-summary-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-message-context-summary-range{flex:none;color:var(--dsw-alias-label-caption)}.dsh-ws-message-context-bubble[data-dsh-ws-empty-prompt]{display:none}
.dsh-ws-banner{padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:16px}.dsh-ws-banner-actions{display:flex;gap:6px;margin-top:5px}.dsh-ws-status{flex:none;display:flex;align-items:center;gap:8px;min-width:0;box-sizing:border-box;width:100%;padding:3px 12px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-ws-preview-status-actions{flex:none;display:flex;align-items:center;gap:2px;min-width:0}.dsh-ws-preview-status-actions .dsh-ws-text-button{height:22px;padding:0 6px;font-size:11px}.dsh-ws-preview-status-meta{flex:none;display:flex;align-items:center;gap:6px;min-width:0}.dsh-ws-preview-status-meta>span:not(.dsh-ws-language):not(.dsh-ws-encoding){overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-preview-status-msg{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-align:right;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-preview-status-msg[data-error]{color:var(--dsw-alias-state-error-primary)}.dsh-ws-error-card{max-width:300px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:19px;text-align:left}.dsh-ws-dialog-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.38));box-sizing:border-box}.dsh-ws-dialog{width:min(360px,100%);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}.dsh-ws-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-ws-dialog-title{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-dialog-body{display:flex;flex-direction:column;gap:8px;padding:14px}.dsh-ws-dialog-input{width:100%;height:32px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;box-sizing:border-box}.dsh-ws-dialog-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.dsh-ws-dialog-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.dsh-ws-dialog-message{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}.dsh-ws-dialog-warning{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}.dsh-ws-danger-button{color:var(--dsw-alias-state-error-primary)}.dsh-ws-dialog-footer{display:flex;justify-content:flex-end;gap:8px;padding:0 14px 14px}.dsh-ws-conflict-region{display:flex;flex-direction:column;gap:8px;min-height:0}.dsh-ws-conflict-region-title{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}.dsh-ws-conflict-cols{display:grid;grid-template-columns:1fr 1fr;gap:8px;min-height:0;flex:1}.dsh-ws-conflict-cols-final{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}.dsh-ws-conflict-col{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:6px}.dsh-ws-conflict-col-label{padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-ws-conflict-mine .dsh-ws-conflict-col-label{color:var(--dsw-alias-state-warn-label)}.dsh-ws-conflict-theirs .dsh-ws-conflict-col-label{color:var(--dsw-alias-state-business-primary)}.dsh-ws-conflict-code{margin:0;min-height:0;flex:1;overflow:auto;padding:10px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:var(--dsh-ws-conflict-font-size,12px);line-height:20px;white-space:pre;box-sizing:border-box}.dsh-ws-inline-add{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-ws-inline-del{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;text-decoration-thickness:1.5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-radius:3px;opacity:.9;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-ws-conflict-code-row{display:inline;border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-ws-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 16%,transparent)}.dsh-ws-conflict-mine .dsh-ws-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 20%,transparent);color:var(--dsw-alias-state-warn-label)}.dsh-ws-conflict-theirs .dsh-ws-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent);color:var(--dsw-alias-state-business-primary)}.dsh-ws-conflict-code-row[data-kind='del']{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;text-decoration-thickness:1.5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);opacity:.85}.dsh-ws-conflict-dialog{width:66vw;max-width:66vw;max-height:min(90vh,1000px);display:flex;flex-direction:column}.dsh-ws-conflict-dialog .dsh-ws-dialog-body{flex:1;min-height:0;overflow:auto}.dsh-ws-conflict-progress{margin-left:8px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:18px;white-space:nowrap}
.dsh-ws-frame [data-slot='sidebar.footer.action']{display:flex!important;flex-direction:column;align-items:stretch;width:100%;min-width:0}
.dsh-ws-splitter{position:absolute;top:0;bottom:0;z-index:8;width:8px;margin-left:-4px;border:0;background:transparent;cursor:col-resize;touch-action:none}.dsh-ws-splitter::after{content:'';position:absolute;top:0;bottom:0;left:3px;width:2px;background:transparent;transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dsh-ws-splitter:hover::after,.dsh-ws-splitter[data-dragging]::after,.dsh-ws-splitter:focus-visible::after{background:var(--dsw-alias-state-business-primary)}.dsh-ws-details{position:absolute;z-index:16;top:0;right:0;bottom:0;width:min(440px,45vw);overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px var(--dsw-alias-bg-mask-1));transform:translateX(0);opacity:1;transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dsh-ws-details[data-closed]{pointer-events:none;visibility:hidden;transform:translateX(100%);opacity:0}.dsh-ws-overlay{position:absolute;inset:0;z-index:20;pointer-events:none}.dsh-ws-overlay>*{pointer-events:auto}.dsh-ws-tree{position:relative}.dsh-ws-context-menu{position:fixed;z-index:40;min-width:168px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}.dsh-ws-context-menu-wide{min-width:220px;max-width:280px;max-height:min(420px,70vh);overflow-y:auto}.dsh-ws-context-label{padding:4px 10px 6px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;user-select:none}.dsh-ws-context-item-check{display:flex;align-items:center;gap:8px}.dsh-ws-context-item-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-context-item-check-mark{flex:none;color:var(--dsw-alias-state-business-primary);font-weight:700}.dsh-ws-context-item.dsh-ws-context-item-check{color:var(--dsw-alias-state-business-primary)}.dsh-ws-context-item{display:block;width:100%;height:30px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:30px;text-align:left;cursor:pointer;box-sizing:border-box}.dsh-ws-context-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-context-item-danger{color:var(--dsw-alias-state-error-primary)}.dsh-ws-context-item-danger:hover{color:var(--dsw-alias-state-error-primary)}.dsh-ws-context-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-ws-context-item:disabled{cursor:not-allowed;opacity:.5}.dsh-ws-context-item[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.dsh-ws-context-item:disabled:hover{background:transparent;color:var(--dsw-alias-label-primary)}.dsh-ws-context-separator{height:1px;margin:4px 0;border:0;background:var(--dsw-alias-border-l2)}.dsh-ws-copy-notice{position:absolute;right:10px;bottom:10px;z-index:12;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;box-shadow:var(--dsw-shadow-elevated,0 4px 12px rgba(0,0,0,.18))}@media(prefers-reduced-motion:reduce){.dsh-ws-frame,.dsh-ws-details,.dsh-ws-splitter::after{transition:none}}
.dsh-ws-search-header{flex-direction:column;align-items:stretch;gap:8px;padding:8px}
.dsh-ws-search-input-row{display:flex;align-items:center;gap:6px}
.dsh-ws-search-input{flex:1;min-width:0;height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-sizing:border-box}
.dsh-ws-search-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-ws-search-input::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-ws-search-case{width:34px;padding:0;font-size:11px;font-weight:600}
.dsh-ws-search-nameonly{display:flex;align-items:center;gap:6px;height:20px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;user-select:none}
.dsh-ws-search-nameonly:hover{color:var(--dsw-alias-label-primary)}
.dsh-ws-search-nameonly input{margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
.dsh-ws-search-kind{flex:none;display:inline-flex;width:16px;color:var(--dsw-alias-label-caption)}
.dsh-ws-icon-button[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsh-ws-text-button[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsh-ws-search-summary{padding:8px 10px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-ws-search-file{margin:2px 0}
.dsh-ws-search-file-header{display:flex;align-items:center;gap:6px;width:100%;min-height:26px;padding:3px 7px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;box-sizing:border-box}
.dsh-ws-search-file-header:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-search-file-count{flex:none;color:var(--dsw-alias-label-caption);font-size:10px}
.dsh-ws-search-truncated{flex:none;color:var(--dsw-alias-state-warn-label);font-size:10px}
.dsh-ws-search-row{display:flex;align-items:flex-start;gap:8px;width:100%;min-height:22px;padding:2px 7px 2px 18px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:17px;text-align:left;cursor:pointer;box-sizing:border-box}
.dsh-ws-search-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-search-line{flex:none;width:32px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;text-align:right}
.dsh-ws-search-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-search-hit{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);border-radius:2px}
/* Workspace settings page (设置 → 工作区设置): cards over one shared row grid —
   label | control | reset. Long explanations live in a per-card 说明 block,
   collapsed by default, and every reset is the same ↺ icon. */
/* Field label/select shared by the dialogs (encoding picker, token statistics): the settings page
   no longer uses these two classes, but the dialogs still do. */
.dsh-ws-settings-label{flex:none;min-width:64px;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-ws-settings-select{flex:1;min-width:0;max-width:320px;height:28px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.dsh-ws-settings-select:disabled{opacity:.55;cursor:not-allowed}
.dsh-ws-settings{display:flex;flex-direction:column;width:100%;max-width:600px;box-sizing:border-box}
.dsh-ws-settings-bar{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:10px;margin:0 -24px;padding:8px 24px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);box-sizing:border-box}
.dsh-ws-settings-chips{flex:1;min-width:0;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
.dsh-ws-settings-chips::-webkit-scrollbar{display:none}
.dsh-ws-chip{flex:none;height:26px;padding:0 10px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dsh-ws-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-chip[aria-current=true]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);font-weight:600}
.dsh-ws-settings-match{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;white-space:nowrap}
.dsh-ws-settings-search{flex:none;display:flex;align-items:center;gap:6px;height:28px;padding:0 4px 0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}
.dsh-ws-settings-search svg{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-tertiary)}
.dsh-ws-settings-search input{width:118px;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.dsh-ws-settings-search input::placeholder{color:var(--dsw-alias-label-caption)}
.dsh-ws-settings-search-clear{width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1;cursor:pointer}
.dsh-ws-settings-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-settings-empty{padding:34px 0;color:var(--dsw-alias-label-caption);font-size:12.5px;text-align:center}
.dsh-ws-card{margin-top:12px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-sizing:border-box;scroll-margin-top:52px}
.dsh-ws-card[hidden]{display:none}
.dsh-ws-card-head{display:flex;align-items:center;gap:8px;padding:11px 0 9px}
.dsh-ws-card-title{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-card-meta{flex:none;color:var(--dsw-alias-label-caption);font-size:11px}
.dsh-ws-card-body{padding-bottom:8px}
.dsh-ws-notes-toggle{flex:none;display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;cursor:pointer}
.dsh-ws-notes-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-notes-toggle[aria-expanded=true]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-notes-caret{display:block;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid currentColor;transition:transform .12s ease}
.dsh-ws-notes-toggle[aria-expanded=true] .dsh-ws-notes-caret{transform:rotate(180deg)}
.dsh-ws-notes{padding:0 0 10px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:18px}
.dsh-ws-notes p{margin:0 0 5px}
.dsh-ws-notes p:last-child{margin-bottom:0}
.dsh-ws-row{display:grid;grid-template-columns:minmax(0,1fr) auto 26px;align-items:center;gap:10px;min-height:34px;padding:2px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-ws-card-body>.dsh-ws-row:first-child{border-top:0}
.dsh-ws-row[hidden]{display:none}
.dsh-ws-row-label{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-ws-row-label-text{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-row-control{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0}
.dsh-ws-row-status{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px}
.dsh-ws-row-reset{display:flex;align-items:center;justify-content:flex-end;width:26px}
.dsh-ws-row-note{grid-column:1/-1;padding:0 0 4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-ws-row-action{display:flex;justify-content:flex-end;padding:0 0 6px}
.dsh-ws-value{flex:none;min-width:46px;color:var(--dsw-alias-label-secondary);font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums}
.dsh-ws-slider{flex:none;width:132px;height:20px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
.dsh-ws-slider:disabled{cursor:not-allowed;opacity:.5}
.dsh-ws-switch{appearance:none;-webkit-appearance:none;position:relative;display:inline-block;flex:none;width:34px;height:20px;margin:0;padding:0;border:0;border-radius:10px;background:var(--dsw-alias-border-l4);cursor:pointer;transition:background .12s ease}
.dsh-ws-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);box-shadow:0 1px 1px rgba(0,0,0,.16);transition:transform .12s ease}
.dsh-ws-switch:checked{background:var(--dsw-alias-state-business-primary)}
.dsh-ws-switch:checked::after{transform:translateX(14px)}
.dsh-ws-switch:disabled{opacity:.45;cursor:not-allowed}
.dsh-ws-select{flex:none;max-width:200px;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.dsh-ws-select:disabled{opacity:.5;cursor:not-allowed}
.dsh-ws-color{flex:none;width:28px;height:26px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;box-sizing:border-box}
.dsh-ws-color::-webkit-color-swatch-wrapper{padding:0}
.dsh-ws-color::-webkit-color-swatch{border:0;border-radius:3px}
.dsh-ws-reset{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:0;transition:opacity .12s ease}
.dsh-ws-reset svg{display:block;width:13px;height:13px}
.dsh-ws-reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-reset[data-custom]{opacity:.85}
.dsh-ws-reset[data-custom]:hover{opacity:1;color:var(--dsw-alias-state-business-primary)}
.dsh-ws-reset:disabled{display:none}
.dsh-ws-row:hover .dsh-ws-reset:not(:disabled){opacity:1}
.dsh-ws-sub{margin:0 0 6px;padding-left:12px;border-left:2px solid var(--dsw-alias-border-l2)}
.dsh-ws-sub[hidden]{display:none}
.dsh-ws-sub[data-off]{opacity:.55}
.dsh-ws-sub .dsh-ws-row{min-height:32px}
.dsh-ws-sub .dsh-ws-row-label-text{color:var(--dsw-alias-label-secondary);font-size:12.5px}
.dsh-ws-section[hidden]{display:none}
.dsh-ws-subtitle{display:flex;align-items:center;gap:8px;padding:10px 0 2px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-ws-subtitle[hidden]{display:none}
.dsh-ws-card-body>.dsh-ws-section:first-child .dsh-ws-subtitle{border-top:0}
.dsh-ws-subtitle-text{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
.dsh-ws-palette{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 10px;padding:3px 0 6px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-ws-subtitle+.dsh-ws-palette{border-top:0}
.dsh-ws-palette[hidden]{display:none}
.dsh-ws-cell{display:flex;align-items:center;gap:8px;min-width:0;height:28px;padding:0 6px;border-radius:6px}
.dsh-ws-cell[hidden]{display:none}
.dsh-ws-cell:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-cell-color{flex:none;width:16px;height:16px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:transparent;cursor:pointer}
.dsh-ws-cell-color::-webkit-color-swatch-wrapper{padding:0}
.dsh-ws-cell-color::-webkit-color-swatch{border:0;border-radius:2px}
.dsh-ws-cell-name{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:12px;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-cell-select{flex:1;min-width:0;height:26px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;cursor:pointer}
.dsh-ws-cell .dsh-ws-reset{width:20px;height:20px}
.dsh-ws-cell .dsh-ws-reset svg{width:11px;height:11px}
.dsh-ws-state{flex:none;display:inline-flex;align-items:center;gap:5px;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:16px}
.dsh-ws-state::before{content:'';flex:none;width:6px;height:6px;border-radius:50%;background:currentColor}
.dsh-ws-state[data-ok]{color:var(--dsw-alias-state-success-primary)}
.dsh-ws-state[data-new]{color:var(--dsw-alias-state-business-primary)}
.dsh-ws-state[data-error]{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-version{flex:none;display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 7px;border-radius:5px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:10.5px;font-style:normal;white-space:nowrap}
.dsh-ws-version b{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.dsh-ws-version[data-fresh]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-version[data-fresh] b{color:var(--dsw-alias-state-business-primary)}
.dsh-ws-card-banner{margin:2px 0 6px;padding:6px 9px;border-radius:8px;font-size:11.5px;line-height:17px}
.dsh-ws-card-banner[data-tone=error]{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-ws-count-line{display:flex;align-items:center;gap:8px;padding:8px 0 2px;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-ws-count-text{flex:1;min-width:0;color:var(--dsw-alias-label-caption);font-size:11.5px}
.dsh-ws-empty-note{padding:6px 0 2px;color:var(--dsw-alias-label-caption);font-size:11.5px;line-height:17px}
.dsh-ws-text-button-accent{color:var(--dsw-alias-state-business-primary)}
.dsh-ws-text-button-accent:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}
/* Narrow windows: the harness panel keeps its 188px nav, so the content column gets tight. */
@media (max-width:720px){.dsh-ws-palette{grid-template-columns:minmax(0,1fr)}.dsh-ws-slider{width:88px}.dsh-ws-row-label-text{white-space:normal}.dsh-ws-select{max-width:150px}}
.dsh-ws-preview-tab-close[data-pinned]{color:var(--dsw-alias-state-business-primary);width:22px;height:22px}
.dsh-ws-preview-tab-close[data-pinned] svg{display:block;width:16px;height:16px;transform:translateY(1px) rotate(-45deg)}
.dsh-ws-highlight-preset-select{flex:1;min-width:0;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-sizing:border-box}.dsh-ws-highlight-preset-select:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-ws-editor-host[data-highlight-preset='classic']{--shiki-token-constant:#0451a5;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#001080;--shiki-token-function:#795e26;--shiki-token-string-expression:#a31515;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff;--shiki-token-module:#267f99}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='classic']{--shiki-token-constant:#4ec9b0;--shiki-token-string:#ce9178;--shiki-token-comment:#6a9955;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-function:#dcdcaa;--shiki-token-string-expression:#ce9178;--shiki-token-punctuation:#d4d4d4;--shiki-token-link:#569cd6;--shiki-token-module:#4ec9b0}
.dsh-ws-editor-host[data-highlight-preset='warm']{--shiki-token-constant:#b4452c;--shiki-token-string:#8a5a00;--shiki-token-comment:#a06a4a;--shiki-token-keyword:#c2410c;--shiki-token-parameter:#d97706;--shiki-token-function:#be185d;--shiki-token-string-expression:#9a3412;--shiki-token-punctuation:#6b4a3f;--shiki-token-link:#9a3412;--shiki-token-module:#0f766e}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='warm']{--shiki-token-constant:#ff8a65;--shiki-token-string:#ffd54f;--shiki-token-comment:#c8a48c;--shiki-token-keyword:#ff9e6d;--shiki-token-parameter:#ffb74d;--shiki-token-function:#f472b6;--shiki-token-string-expression:#ffcc80;--shiki-token-punctuation:#e0c8bb;--shiki-token-link:#ffab91;--shiki-token-module:#2dd4bf}
.dsh-ws-editor-host[data-highlight-preset='cool']{--shiki-token-constant:#1971c2;--shiki-token-string:#0f766e;--shiki-token-comment:#6f7d94;--shiki-token-keyword:#364fc7;--shiki-token-parameter:#0b7285;--shiki-token-function:#7048e8;--shiki-token-string-expression:#099268;--shiki-token-punctuation:#49576b;--shiki-token-link:#1c7ed6;--shiki-token-module:#e8590c}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='cool']{--shiki-token-constant:#4dabf7;--shiki-token-string:#38d9a9;--shiki-token-comment:#8fa3c2;--shiki-token-keyword:#91a7ff;--shiki-token-parameter:#22b8cf;--shiki-token-function:#b197fc;--shiki-token-string-expression:#63e6be;--shiki-token-punctuation:#b6c2d6;--shiki-token-link:#74c0fc;--shiki-token-module:#ffa94d}
.dsh-ws-editor-host[data-highlight-preset='mono']{--shiki-token-constant:#3f3f3f;--shiki-token-string:#2e2e2e;--shiki-token-comment:#9d9d9d;--shiki-token-keyword:#e8590c;--shiki-token-parameter:#565656;--shiki-token-function:#7a7a7a;--shiki-token-string-expression:#4a4a4a;--shiki-token-punctuation:#8a8a8a;--shiki-token-link:#a0a0a0;--shiki-token-module:#6e6e6e}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='mono']{--shiki-token-constant:#d0d0d0;--shiki-token-string:#e2e2e2;--shiki-token-comment:#6e6e6e;--shiki-token-keyword:#ffa94d;--shiki-token-parameter:#a8a8a8;--shiki-token-function:#bfbfbf;--shiki-token-string-expression:#cfcfcf;--shiki-token-punctuation:#8f8f8f;--shiki-token-link:#7d7d7d;--shiki-token-module:#c0c0c0}
/* VS Code default theme (Light+/Dark+) XML palette: tag names ride the function token, attribute names the parameter token, values/entities the string token. */
.dsh-ws-editor-host[data-highlight-preset='vscode-xml']{--shiki-token-comment:#008000;--shiki-token-function:#800000;--shiki-token-parameter:#e50000;--shiki-token-string:#a31515;--shiki-token-string-expression:#0000ff;--dsh-ws-token-xml-punctuation:#800000;--dsh-ws-token-xml-entity:#0000ff}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-xml']{--shiki-token-comment:#6A9955;--shiki-token-function:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-string:#ce9178;--shiki-token-string-expression:#569cd6;--dsh-ws-token-xml-punctuation:#808080;--dsh-ws-token-xml-entity:#569cd6}
/* VS Code default theme (Light+/Dark+) shared token palette: one rule serves every non-XML vscode-* preset. */
.dsh-ws-editor-host[data-highlight-preset='vscode-python'],.dsh-ws-editor-host[data-highlight-preset='vscode-json'],.dsh-ws-editor-host[data-highlight-preset='vscode-typescript'],.dsh-ws-editor-host[data-highlight-preset='vscode-javascript'],.dsh-ws-editor-host[data-highlight-preset='vscode-css'],.dsh-ws-editor-host[data-highlight-preset='vscode-markdown'],.dsh-ws-editor-host[data-highlight-preset='vscode-shell'],.dsh-ws-editor-host[data-highlight-preset='vscode-config'],.dsh-ws-editor-host[data-highlight-preset='vscode-cpp'],.dsh-ws-editor-host[data-highlight-preset='vscode-csharp']{--shiki-token-constant:#098658;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#001080;--shiki-token-function:#795e26;--shiki-token-string-expression:#795e26;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff;--shiki-token-module:#267f99}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-python'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-json'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-typescript'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-javascript'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-css'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-markdown'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-shell'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-config'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-cpp'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-csharp']{--shiki-token-constant:#b5cea8;--shiki-token-string:#ce9178;--shiki-token-comment:#6a9955;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-function:#dcdcaa;--shiki-token-string-expression:#dcdcaa;--shiki-token-punctuation:#d4d4d4;--shiki-token-link:#569cd6;--shiki-token-module:#4ec9b0}
.dsh-ws-editor-host[data-highlight-preset='vs2022']{--shiki-token-constant:#098658;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#000000;--shiki-token-function:#2b91af;--shiki-token-string-expression:#a31515;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff;--shiki-token-module:#267f99}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vs2022']{--shiki-token-constant:#b5cea8;--shiki-token-string:#d69d85;--shiki-token-comment:#57a64a;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#dcdcdc;--shiki-token-function:#4ec9b0;--shiki-token-string-expression:#d69d85;--shiki-token-punctuation:#b4b4b4;--shiki-token-link:#569cd6;--shiki-token-module:#4ec9b0}
/* Python import-module names (dsh-ws-token-module decoration): per-preset --shiki-token-module, falling back to the function color. */
.dsh-ws-editor-host .cm-line .dsh-ws-token-module{color:var(--shiki-token-module,var(--shiki-token-function))}
/* Preprocessor directive color (C# #if/#region, ...): purple, lighter in dark for contrast. */
.dsh-ws-editor-host{--dsh-ws-token-directive:#8e44ad}
body[data-ds-dark-theme] .dsh-ws-editor-host{--dsh-ws-token-directive:#c586c0}
/* Sidebar top actions: hide the harness New Session button; the plugin draws its own two-button row in the same flow position. */
.dsh-ws-frame [data-slot="sidebar"] > div > button{display:none}
/* The harness right-sidebar expand button is dead under this root layout (no rightbar track), and its document-preview purpose is served by the plugin's own preview column; hide it. */
.dsh-ws-frame [data-sidebar-right-expand]{display:none}
.dsh-ws-sidebar-top-actions{flex:none;min-width:0;display:flex;align-items:stretch;gap:6px;height:38px;margin:0 2px 8px;box-sizing:border-box}
.dsh-ws-sidebar-top-action{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 10px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;font-weight:500;line-height:22px;cursor:pointer;overflow:hidden;white-space:nowrap}
.dsh-ws-sidebar-top-action:hover{background:var(--dsw-alias-button-floating-hover)}
.dsh-ws-sidebar-top-action[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-brand-primary)}
.dsh-ws-sidebar-top-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-ws-sidebar-top-icon{flex:none;width:14px;height:14px}
.dsh-ws-sidebar-top-icon svg{display:block;width:100%;height:100%}
.dsh-ws-sidebar-top-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Collapsed rail: the two controls become icon-only 36px buttons, stacked. */
.dsh-ws-sidebar-top-actions[data-rail]{flex-direction:column;align-items:flex-start;gap:0;height:auto;margin:0 0 12px;position:relative;z-index:10}
.dsh-ws-sidebar-top-actions[data-rail] .dsh-ws-sidebar-top-action{flex:none;width:36px;height:36px;padding:0;gap:0;border-color:transparent;background:transparent}
.dsh-ws-sidebar-top-actions[data-rail] .dsh-ws-sidebar-top-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-sidebar-top-actions[data-rail] .dsh-ws-sidebar-top-icon{width:18px;height:18px}
.dsh-ws-sidebar-top-actions[data-rail] .dsh-ws-sidebar-top-label{display:none}
/* Collapsed rail: hide the harness workspace browser's rail controls; the plugin's two nav tabs are the only region icons. */
.dsh-ws-frame[data-sidebar-collapsed] [data-slot="sidebar.workspaces"] > *{display:none}
/* Files region: the harness workspace browser is hidden while the plugin's file tree fills the region seat. */
.dsh-ws-sidebar-files{display:none}
.dsh-ws-frame[data-sidebar-files] [data-slot="sidebar.workspaces"] > :not(.dsh-ws-sidebar-files){display:none}
/* The sidebar shell hides nested scrollbars until hover; the file list is scroll-heavy, so its scrollbar stays visible. The files panel is inset 12px both sides. */
.dsh-ws-frame[data-sidebar-files] .dsh-ws-sidebar-files{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;margin-right:12px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-ws-frame[data-sidebar-files] .dsh-ws-sidebar-files .dsh-ws-tree{flex:1;min-height:0;height:auto;border-right:0}
/* Sidebar foot: the global panel list (the Plugins seat ui-plugin-manager
   registers into sidebar.panellist) leaves the column top and joins the foot stack —
   below Mobile-mode, above Settings. The shell draws the foot as ONE box around the
   two footer seats, so that box is dissolved (display:contents) and the three are
   ordered flex items of the shell root. The list node never leaves its React-owned
   position: relocating it would make React's uninstall path call removeChild on a
   parent it no longer has (NotFoundError). The three box hooks are the shell's class
   names (no data-slot of their own). */
.dsh-ws-frame [data-slot="sidebar"] > div > div[class*="footArea"]{display:contents}
.dsh-ws-frame [data-slot="sidebar"] > div > div[class*="footArea"] > div[class*="footerActions"]{order:10}
.dsh-ws-frame [data-slot="sidebar"] > div > nav{order:20}
.dsh-ws-frame [data-slot="sidebar"] > div > div[class*="footArea"] > div[class*="settingsArea"]{order:30}
/* Wide sidebar: each panel row takes the Mobile-mode row's box (34px, 12px
   radius, the same 6px glyph inset and 4px/-4px margins, no list gap), so the
   rows read as one stack at an 8px rhythm; the Settings row keeps its own 42px
   box and the collapsed rail keeps the shell's 36px rows. */
.dsh-ws-frame:not([data-sidebar-collapsed]) [data-slot="sidebar"] > div > nav{gap:0;margin:0 0 4px}
.dsh-ws-frame:not([data-sidebar-collapsed]) [data-slot="sidebar"] > div > nav > button{height:34px;min-height:34px;margin:4px -4px;padding:6px 2px 6px 10px;gap:8px;border-radius:12px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dsh-ws-frame:not([data-sidebar-collapsed]) [data-slot="sidebar"] > div > nav > button[aria-current="page"]{color:var(--dsw-alias-brand-primary)}
/* The foot box paints nothing as display:contents, so the shell's rail entry
   fade (.railIn .footArea) is carried on the two seats it used to wrap.
   [class*=railIn] is the shell's own rail flag: the only selector here not
   anchored to a data-slot attribute. */
@keyframes dsh-ws-foot-rail-in{from{opacity:0}}
.dsh-ws-frame [data-slot="sidebar"] > div[class*="railIn"] > div[class*="footArea"] > div{animation:dsh-ws-foot-rail-in 150ms var(--ds-ease-in-out) backwards}
/* The desktop shell hides the whole foot in its collapsed rail; dissolving the
   box above must not resurrect it there. */
html[data-windows-titlebar] .dsh-ws-frame[data-sidebar-collapsed] [data-slot="sidebar"] > div > div[class*="footArea"]{display:none}
/* CodeMirror search panel (Ctrl+F) renders into .dsh-ws-preview-search, so the panel rules stay scoped to that container; !important keeps the controls legible under the harness's global styles. */
.dsh-ws-preview-search{flex:none;min-width:0;background:var(--dsw-alias-bg-layer-1);user-select:none}
.dsh-ws-preview-search .cm-panels.cm-panels-top{background:var(--dsw-alias-bg-layer-1)!important;color:var(--dsw-alias-label-primary)!important;border-bottom:1px solid var(--dsw-alias-border-l2)!important}
.dsh-ws-preview-search .cm-panel.cm-search{padding:5px 36px 5px 6px}
.dsh-ws-preview-search .cm-panel.cm-search .cm-textfield{height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2)!important;border-radius:6px;background:var(--dsw-alias-bg-base)!important;color:var(--dsw-alias-label-primary)!important;font:inherit!important;font-size:12px!important;box-sizing:border-box;user-select:text}
.dsh-ws-preview-search .cm-panel.cm-search .cm-textfield:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-ws-preview-search .cm-panel.cm-search .cm-button{height:26px;padding:0 8px;border:0!important;border-radius:6px;background:transparent!important;color:var(--dsw-alias-label-secondary)!important;font:inherit!important;font-size:12px!important;cursor:pointer}
.dsh-ws-preview-search .cm-panel.cm-search .cm-button:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
.dsh-ws-preview-search .cm-panel.cm-search label{display:inline-flex;align-items:center;gap:3px;height:28px;transform:translateY(3px);color:var(--dsw-alias-label-secondary)!important}
.dsh-ws-preview-search .cm-panel.cm-search input[type=checkbox]{margin:2px 0 0;vertical-align:middle;accent-color:var(--dsw-alias-state-business-primary)}
.dsh-ws-preview-search .cm-panel.cm-search [name=close]{display:inline-flex!important;align-items:center!important;justify-content:center!important;position:absolute!important;top:50%!important;right:4px!important;transform:translateY(-50%)!important;width:30px!important;height:30px!important;padding:0 0 2px!important;margin:0!important;border:0!important;border-radius:8px!important;background:transparent!important;color:var(--dsw-alias-label-secondary)!important;font-size:18px!important;line-height:1!important;cursor:pointer!important;box-sizing:border-box!important}
.dsh-ws-preview-search .cm-panel.cm-search [name=close]:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
/* The search field is wrapped (see CodeEditor) with a col-resize grip on its right edge. */
.dsh-ws-preview-search .dsh-ws-search-field-wrap{display:inline-flex;align-items:center;vertical-align:middle}
.dsh-ws-preview-search .dsh-ws-search-field-wrap .cm-textfield{flex:none;min-width:60px}
.dsh-ws-preview-search .dsh-ws-search-resize{flex:none;width:6px;height:16px;margin:0 2px 0 4px;border-radius:3px;background:var(--dsw-alias-border-l2);cursor:col-resize;opacity:.65}
.dsh-ws-preview-search .dsh-ws-search-resize:hover{background:var(--dsw-alias-state-business-primary);opacity:1}
.dsh-ws-preview-search .dsh-ws-search-resize:active{background:var(--dsw-alias-state-business-primary);opacity:1}
.dsh-ws-editor-host .cm-searchMatch{background-color:var(--dsw-alias-state-business-tertiary)!important}
.dsh-ws-editor-host .cm-searchMatch-selected{background-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent)!important}
.dsh-ws-editor-host .cm-selectionMatch{background-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)!important}
.dsh-ws-editor-host .cm-searchMatch .cm-selectionMatch{background-color:transparent!important}
.dsh-ws-drop-overlay{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);pointer-events:none}
.dsh-ws-drop-hint{display:inline-flex;align-items:center;padding:8px 14px;border:1px dashed var(--dsw-alias-state-business-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-business-primary);font-size:12px;box-shadow:var(--dsw-shadow-elevated,0 8px 24px rgba(0,0,0,.18))}
.dsh-ws-preview[data-drop-active] .dsh-ws-preview-tabs,.dsh-ws-preview[data-drop-active] .dsh-ws-panel-header,.dsh-ws-preview[data-drop-active] .dsh-ws-editor-host{pointer-events:none}
/* Hide the harness's full-viewport chat drop mask; the layout draws its own chat-confined mask. Scoped with :has(svg) so a future body-level role="status" toast is not hidden. */
body > [role="status"]:has(svg){display:none!important}
.dsh-ws-chat-drop-mask{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-drop,rgba(0,0,0,.32));backdrop-filter:blur(6px);pointer-events:none}
.dsh-ws-chat-drop-card{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px dashed var(--dsw-alias-state-business-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:var(--dsw-shadow-elevated,0 10px 28px rgba(0,0,0,.2))}
.dsh-ws-chat-drop-close{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box;pointer-events:auto}
.dsh-ws-chat-drop-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Close button on the preview drop hint, matching the chat drop mask. */
.dsh-ws-drop-close{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box;pointer-events:auto}
.dsh-ws-drop-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Transient toast matching the harness conversation Toast look for failed external-file opens; positioned inside the preview pane. */
.dsh-ws-toast{position:absolute;top:12px;left:50%;z-index:60;pointer-events:none;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100% - 48px));padding:12px 16px;border-radius:14px;background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);font-size:14px;line-height:22px;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.28));transform:translateX(-50%);animation:dsh-ws-toast-in 160ms ease-out,dsh-ws-toast-fade 1000ms ease 3000ms forwards}
.dsh-ws-toast-icon{display:grid;place-items:center;flex:none;color:var(--dsw-alias-state-warn-label)}
.dsh-ws-toast-text{min-width:0}
@keyframes dsh-ws-toast-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes dsh-ws-toast-fade{to{opacity:0}}
@media (prefers-reduced-motion: reduce){.dsh-ws-toast{animation:dsh-ws-toast-fade 1000ms ease 3000ms forwards}.dsh-ws-frame [data-slot="sidebar"] > div[class*="railIn"] > div[class*="footArea"] > div{animation:none}}
/* ── Mobile (phone-column) mode ─────────────────────────────────────────
   The document-class gate (dsh-ws-mobile-on) drives every override; the floating
   sidebar drawer and the file-fullscreen view ride sibling classes. The aside is an
   absolute drawer, so explicit grid-column keeps each section in the phone track. */
.dsh-ws-mobile-toggle{flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 8px);height:34px;margin:4px -4px 4px;padding:6px 2px 6px 10px;box-sizing:border-box;border:0;border-radius:12px;background:transparent;cursor:pointer;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:22px;text-align:left}.dsh-ws-mobile-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-mobile-toggle[data-open]{color:var(--dsw-alias-brand-primary)}.dsh-ws-mobile-toggle[data-rail]{width:36px;height:36px;margin:8px 0 10px;justify-content:center;gap:0;padding:0;border-radius:50%}.dsh-ws-mobile-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-ws-mobile-toggle-icon{flex:none;width:16px;height:16px}.dsh-ws-mobile-toggle[data-rail] .dsh-ws-mobile-toggle-icon{width:18px;height:18px}.dsh-ws-mobile-toggle-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
html.dsh-ws-mobile-on .dsh-ws-frame{grid-template-columns:0 minmax(0,430px) 0!important;justify-content:center}
html.dsh-ws-mobile-on .dsh-ws-chat{grid-column:2}
html.dsh-ws-mobile-on .dsh-ws-preview{display:none}
html.dsh-ws-mobile-on .dsh-ws-sidebar{position:absolute;top:0;bottom:0;left:0;z-index:30;width:min(280px,85vw);box-shadow:8px 0 24px #0000002e;transform:translateX(-100%);transition:transform .2s var(--ds-ease-in-out)}
html.dsh-ws-mobile-on .dsh-ws-sidebar [data-slot="sidebar"] > div{width:100%!important}
html.dsh-ws-mobile-on.dsh-ws-mobile-drawer-open .dsh-ws-sidebar{transform:translateX(0)}
html.dsh-ws-mobile-on .dsh-ws-splitter{display:none}
html.dsh-ws-mobile-on .dsh-ws-details{display:none}
html.dsh-ws-mobile-on [data-slot="sidebar"] > div > div:first-child > button:last-child{display:none}
.dsh-ws-mobile-scrim{position:absolute;inset:0;z-index:25;background:#00000047}
/* File browsing fills the phone column below the pinned conversation header (height measured into --dsh-ws-mobile-header-h); the chat's scroll area is hidden so only the header stays reachable. */
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-frame{grid-template-columns:0 minmax(0,430px) 0!important}
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-preview{display:flex;grid-column:2;visibility:visible;pointer-events:auto;box-sizing:border-box;padding-top:var(--dsh-ws-mobile-header-h,52px)}
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-chat{position:fixed;top:0;left:50%;width:min(430px,100%);margin-left:calc(min(430px,100%) / -2);z-index:3;height:var(--dsh-ws-mobile-header-h,52px);overflow:hidden}
/* Mobile file-fullscreen pins that header to the viewport top: on the Windows
   Desktop shell it starts below the caption band instead. */
html[data-windows-titlebar].dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-chat{top:var(--dsh-ws-caption-h)}
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-chat [data-slot="main"] [data-conversation-scroll]{display:none}
/* In file-fullscreen the conversation's view tabs are pinned with the title row; hiding them lets the file content start flush under the title row. */
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on [data-slot="conversation.session.header"] > header > div[role="tablist"]{display:none}
/* Session-header controls: hidden outside mobile, inline at the phone column's top-left in mobile. */
.dsh-ws-mobile-controls{display:none;align-items:center;gap:2px}
html.dsh-ws-mobile-on .dsh-ws-mobile-controls{display:flex;order:-1}
.dsh-ws-mobile-whale,.dsh-ws-mobile-files{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-ws-mobile-whale:hover,.dsh-ws-mobile-files:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-mobile-active{color:var(--dsw-alias-brand-primary)}
.dsh-ws-mobile-files-icon{width:16px;height:16px}
html.dsh-ws-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > div:first-child,html.dsh-ws-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > div:first-child > div:nth-child(2){display:contents}
html.dsh-ws-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > nav{flex:1}
html.dsh-ws-mobile-on [data-slot="conversation.session.header.utilities"]{display:none!important}
/* Hero whale + file button: a frame-level overlay visible only on the blank-session hero. */
.dsh-ws-mobile-hero{display:none;position:absolute;top:10px;left:calc(max(0px,50% - 215px) + 8px)}
html.dsh-ws-mobile-on:has([data-slot="main"] [data-phase="hero"]) .dsh-ws-mobile-hero{display:flex;align-items:center;gap:2px}
/* Settings dialog: in mobile the centered 800px modal becomes a fullscreen phone panel with the
   section nav as a horizontal bottom bar. The drawer keeps a transform even when open, which would
   make the dialog's position:fixed overlay resolve against the drawer instead of the viewport;
   dropping the transform frees the modal to cover the phone column. */
html.dsh-ws-mobile-on .dsh-ws-sidebar:has([data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]){transform:none;transition:none}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav){width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;border-radius:0;flex-direction:column;overflow:hidden}
/* The harness insets its settings overlay from the top by the published window
   chrome clearance, so the full-height dialog subtracts the same band. */
html[data-windows-titlebar].dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav){height:calc(100vh - var(--dsh-frame-chrome-top,0px));height:calc(100dvh - var(--dsh-frame-chrome-top,0px))}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav{order:2;flex:none;display:flex;flex-direction:row;align-items:center;gap:8px;width:100%;padding:8px 12px 10px;box-sizing:border-box;overflow-x:auto;scrollbar-width:thin}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav > div:last-child{display:flex;flex-direction:row;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav > div:last-child > button{flex:none}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > nav > div:first-child{position:absolute;top:0;left:0;z-index:1;display:flex;align-items:center;height:54px;padding:0 16px;box-sizing:border-box;white-space:nowrap}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > div{flex:1;min-height:0;display:flex;flex-direction:column}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav) > div > div:first-child{height:auto;min-height:54px;align-items:center;padding:12px 16px}
.dsh-ws-tree-rename{box-sizing:border-box;width:100%;padding:0 7px 0 calc(7px + var(--dsh-ws-depth,0) * 15px)}
.dsh-ws-tree-rename-row{display:flex;align-items:center;gap:5px;width:100%;height:var(--dsh-ws-row-height,28px);box-sizing:border-box}
.dsh-ws-tree-rename-input{flex:1;min-width:0;height:22px;padding:0 6px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;box-sizing:border-box}
.dsh-ws-tree-rename-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-ws-tree-rename-error{padding:2px 0 4px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:15px}
.dsh-ws-session-rename-overlay{position:fixed;z-index:45;box-sizing:border-box;padding:0}
.dsh-ws-session-rename-input{width:100%;height:100%;box-sizing:border-box;padding:0 4px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}
.dsh-ws-session-rename-input:disabled{opacity:.7;cursor:not-allowed}
.dsh-ws-session-rename-error{position:fixed;z-index:45;max-width:280px;padding:2px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;box-shadow:var(--dsw-shadow-elevated,0 4px 12px rgba(0,0,0,.18))}
.dsh-ws-copy-notice[data-error]{color:var(--dsw-alias-state-error-primary)}
/* Mind-map conversation branching view ("导图") and the sidebar branch-row hider.
   Semantic tones for everything NOT one of the four user-pickable accents (hover /
   selected / head / end): the folded-run slate and the AI pink. Base values are the LIGHT
   ones, overridden by the dark block below (as with the shiki presets). --dsh-ws-mm-fold
   tints the fold wash, dashed border, ×N badge and 折叠 pill, so "folded" is one axis;
   --dsh-ws-mm-ai tints both summarize entry points. */
.dsh-ws-mindmap{--dsh-ws-mm-fold:#64748b;--dsh-ws-mm-ai:#db2777;height:100%;position:relative;box-sizing:border-box;padding:14px 16px;display:flex;flex-direction:column;overflow:hidden}
body[data-ds-dark-theme] .dsh-ws-mindmap{--dsh-ws-mm-fold:#94a3b8;--dsh-ws-mm-ai:#f472b6}
.dsh-ws-mindmap-toolbar{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:8px;row-gap:6px;margin-bottom:8px}
.dsh-ws-mindmap-toolbar-button{flex:none;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease}
.dsh-ws-mindmap-toolbar-button:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
/* Danger variant for the "archive entire mind map" button: red border + red text, hover gets a faint red fill. Rules sit after the base hover rule so the red wins. */
.dsh-ws-mindmap-toolbar-button-danger{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-ws-mindmap-toolbar-button-danger:hover{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
/* Highlighted "new session" action: a light-blue pill echoing the virtual root node's style. Hover lifts the button 1px, scales the badge and rotates the plus 90°. */
.dsh-ws-mindmap-toolbar-button-new{flex:none;display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 6px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);border-radius:999px;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,var(--dsw-alias-bg-layer-1)),color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,var(--dsw-alias-bg-layer-1)));color:var(--dsw-alias-state-business-primary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);transition:transform .12s ease,box-shadow .12s ease;white-space:nowrap}
.dsh-ws-mindmap-toolbar-button-new:hover{transform:translateY(-1px);box-shadow:0 0 0 5px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.dsh-ws-mindmap-toolbar-button-new-plus{flex:none;width:15px;height:15px;border-radius:50%;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);display:flex;align-items:center;justify-content:center;transition:transform .15s ease}
.dsh-ws-mindmap-toolbar-button-new-plus svg{display:block;width:9px;height:9px;transition:transform .15s ease}
.dsh-ws-mindmap-toolbar-button-new:hover .dsh-ws-mindmap-toolbar-button-new-plus{transform:scale(1.08)}
.dsh-ws-mindmap-toolbar-button-new:hover .dsh-ws-mindmap-toolbar-button-new-plus svg{transform:rotate(90deg)}
/* Badge-family icons: every toolbar button carries a small circular icon badge echoing the new-session plus badge — neutral gray at rest, turning solid blue on hover; the danger badge stays solid red. */
.dsh-ws-mindmap-toolbar-badge{flex:none;width:15px;height:15px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 28%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);transition:background .15s ease,color .15s ease}
.dsh-ws-mindmap-toolbar-badge svg{display:block;width:9px;height:9px}
.dsh-ws-mindmap-toolbar-button:hover .dsh-ws-mindmap-toolbar-badge{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted)}
.dsh-ws-mindmap-toolbar-button-danger .dsh-ws-mindmap-toolbar-badge,.dsh-ws-mindmap-toolbar-button-danger:hover .dsh-ws-mindmap-toolbar-badge{background:var(--dsw-alias-state-error-primary);color:#fff}
/* Archive button: right-aligned within the toolbar. */
.dsh-ws-mindmap-toolbar-archive{margin-left:auto}
.dsh-ws-mindmap-viewport{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none}
.dsh-ws-mindmap-viewport[data-dragging]{cursor:grabbing;user-select:none}
/* A mind map docked as a preview tab fills the preview column below the tab strip. */
.dsh-ws-preview-body.dsh-ws-mindmap-dock{display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1)}
.dsh-ws-preview-body.dsh-ws-mindmap-dock .dsh-ws-mindmap{flex:1;min-height:0;height:auto}
/* The global host's stable per-map container: the explorer parks this element into the dsh-ws-mindmap-dock placeholder, so the portal target never changes and the map body never remounts. */
.dsh-ws-preview-body.dsh-ws-mindmap-dock>.dsh-ws-mindmap-host-body{flex:1;min-height:0;display:flex;flex-direction:column}
/* A plan opened as a preview tab: the harness plan document scrolls inside the preview column, below the tab strip. */
.dsh-ws-preview-body.dsh-ws-plan-dock{overflow:auto;box-sizing:border-box;padding:16px 18px 40px;background:var(--dsw-alias-bg-base)}
.dsh-ws-plan-message{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}
.dsh-ws-preview-tab-plan{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;color:var(--dsw-alias-state-business-primary)}
.dsh-ws-preview-tab-plan svg{width:12px;height:12px}
/* A turn's change review opened as a preview tab: the file list sits beside the
   comparison inside the preview column, below the tab strip. The tab is
   session-only and has no file chrome, so it owns its own header. */
.dsh-ws-preview-body.dsh-ws-review-dock{display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base)}
.dsh-ws-preview-tab-review{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;color:var(--dsw-alias-state-business-primary)}
.dsh-ws-preview-tab-review svg{width:12px;height:12px}
.dsh-ws-review{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.dsh-ws-review-header{flex:none;display:flex;align-items:center;gap:8px;min-width:0;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill)}
.dsh-ws-review-title{flex:none;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-weight:600}
.dsh-ws-review-path{flex:0 1 auto;min-width:0;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-review-spacer{flex:1;min-width:0}
.dsh-ws-review-counts{flex:none;display:inline-flex;gap:6px;font-size:11px;line-height:16px}
.dsh-ws-review-added{color:var(--dsw-alias-state-success-primary)}
.dsh-ws-review-deleted{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-review-label{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
/* The review body is the split's positioning context: the separator is absolutely
   placed at the list's width, and while it is dragged the whole split stops
   selecting text (the same rule the frame applies to its own splitters). */
.dsh-ws-review-body{position:relative;flex:1;min-height:0;display:flex;overflow:hidden}
.dsh-ws-review-body[data-resizing]{user-select:none;cursor:col-resize}
.dsh-ws-review-list{flex:0 0 var(--dsh-ws-review-list,180px);min-width:0;overflow:auto;padding:6px;border-right:1px solid var(--dsw-alias-border-l1);box-sizing:border-box}
.dsh-ws-review-row{display:flex;align-items:center;gap:6px;width:100%;padding:4px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;text-align:left;cursor:pointer;box-sizing:border-box}
.dsh-ws-review-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-review-row[data-active]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsh-ws-review-row-path{flex:1;min-width:0;overflow:hidden;direction:rtl;text-align:left;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-review-diff{flex:1;min-width:0;overflow:auto;background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-code-block)}
.dsh-ws-review-diff-body{padding:8px 0 16px}
.dsh-ws-review-note{margin:6px 12px;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:16px}
.dsh-ws-review-hunk{display:block;padding:0}
.dsh-ws-review-hunk-header{padding:2px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:pre}
.dsh-ws-review-line{display:flex;align-items:flex-start;min-height:20px;white-space:pre}
.dsh-ws-review-line-add{background:var(--dsw-alias-file-diff-added-bg)}
.dsh-ws-review-line-del{background:var(--dsw-alias-file-diff-deleted-bg)}
.dsh-ws-review-line-add .dsh-ws-review-number{background:var(--dsw-alias-file-diff-added-gutter);color:var(--dsw-alias-file-diff-added-marker)}
.dsh-ws-review-line-del .dsh-ws-review-number{background:var(--dsw-alias-file-diff-deleted-gutter);color:var(--dsw-alias-file-diff-deleted-marker)}
.dsh-ws-review-line-add .dsh-ws-review-sign{color:var(--dsw-alias-file-diff-added-marker)}
.dsh-ws-review-line-del .dsh-ws-review-sign{color:var(--dsw-alias-file-diff-deleted-marker)}
.dsh-ws-review-number{flex:none;width:42px;padding:0 6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:20px;text-align:right;user-select:none}
.dsh-ws-review-sign{flex:none;width:12px;color:var(--dsw-alias-label-tertiary);line-height:20px;text-align:center;user-select:none}
.dsh-ws-review-text{flex:1;min-width:0;padding-right:12px;line-height:20px}
.dsh-ws-review-message{padding:12px 12px 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}
.dsh-ws-review-message .dsh-ws-text-button{margin-left:8px}
/* Convert-to-mind-map confirm dialog: a roomier modal than the default with pill buttons. */
.dsh-ws-mindmap-confirm-dialog{width:min(440px,100%)}
.dsh-ws-mindmap-confirm-dialog .dsh-ws-dialog-body{padding:18px 20px}
.dsh-ws-mindmap-confirm-dialog .dsh-ws-dialog-message{font-size:14px;line-height:22px}
.dsh-ws-mindmap-confirm-dialog .dsh-ws-dialog-footer{padding:0 20px 18px;gap:10px}
.dsh-ws-mindmap-confirm-button{height:34px;padding:0 18px;border-radius:999px;font-size:13px}
.dsh-ws-mindmap-confirm-cancel{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dsh-ws-mindmap-confirm-cancel:hover{border-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-primary)}
.dsh-ws-mindmap-confirm-ok{border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dsh-ws-mindmap-confirm-ok:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);border-color:var(--dsw-alias-state-business-primary)}
/* Archive-entire-mind-map confirm dialog: an enlarged 480px warning dialog with a red border + glow, a red→amber gradient band, an amber ⚠ badge, and a solid red-gradient confirm pill. All colors are theme vars, so both themes adapt. */
.dsh-ws-mindmap-archive-dialog{width:min(480px,100%);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent);border-radius:14px;box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent),var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));overflow:hidden}
.dsh-ws-mindmap-archive-dialog .dsh-ws-dialog-header{justify-content:flex-start;gap:10px;padding:16px 18px 0;border-bottom:0}
.dsh-ws-mindmap-archive-dialog .dsh-ws-dialog-title{flex:1;font-size:16px;font-weight:700;color:var(--dsw-alias-state-error-primary)}
.dsh-ws-mindmap-archive-band{flex:none;height:4px;background:linear-gradient(90deg,var(--dsw-alias-state-error-primary) 0%,color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,var(--dsw-alias-state-warn-primary)) 45%,var(--dsw-alias-state-warn-primary) 100%)}
.dsh-ws-mindmap-archive-badge{flex:none;width:34px;height:34px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);color:#1f2430;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent)}
.dsh-ws-mindmap-archive-badge svg{display:block;width:19px;height:19px;transform:translateY(-1.5px)}
.dsh-ws-mindmap-archive-dialog .dsh-ws-dialog-body{padding:16px 18px 0;gap:10px}
.dsh-ws-mindmap-archive-dialog .dsh-ws-dialog-message{font-size:14px;line-height:23px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,var(--dsw-alias-bg-layer-1));border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent);border-radius:10px;padding:12px 14px}
.dsh-ws-mindmap-archive-dialog .dsh-ws-dialog-footer{padding:18px 18px 16px;gap:10px}
.dsh-ws-mindmap-archive-dialog .dsh-ws-text-button{height:36px;padding:0 20px;border-radius:999px;font-size:13px}
.dsh-ws-mindmap-archive-ok{border:0;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-state-error-primary) 88%,#fff 12%),var(--dsw-alias-state-error-primary));color:#fff;font-weight:600;box-shadow:0 2px 10px color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);transition:filter .15s ease,box-shadow .15s ease}
.dsh-ws-mindmap-archive-ok:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 72%,#000 28%);color:#fff;box-shadow:inset 0 2px 6px rgba(0,0,0,.22),0 2px 10px color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
.dsh-ws-mindmap-archive-ok:active:not(:disabled){filter:brightness(.85);box-shadow:inset 0 3px 8px rgba(0,0,0,.3)}
.dsh-ws-mindmap-archive-ok:focus-visible{outline:2px solid var(--dsw-alias-state-error-primary);outline-offset:2px}
/* Type-"yes" confirm gate for archiving the whole map: centered label + input + status capsule (red until "yes" matches, then green). */
.dsh-ws-mindmap-archive-confirm{display:flex;flex-direction:column;gap:6px;padding:0 2px}
.dsh-ws-mindmap-archive-confirm-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:center}
.dsh-ws-mindmap-archive-confirm-input{height:36px;padding:0 12px;border-radius:8px;font-size:14px;text-align:center}
.dsh-ws-mindmap-archive-confirm-input[data-matched="true"]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 60%,transparent)}
.dsh-ws-mindmap-archive-confirm-hint{align-self:center;display:inline-flex;align-items:center;padding:3px 14px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,transparent);border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;min-height:16px}
.dsh-ws-mindmap-archive-confirm-hint[data-matched="true"]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 42%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
/* The session-header 导图 button: opens the map as a preview tab. */
.dsh-ws-mindmap-header-button{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;box-sizing:border-box}
.dsh-ws-mindmap-header-button:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-header-icon{width:14px;height:14px;flex:none}
html.dsh-ws-mobile-on .dsh-ws-mindmap-header-button{display:none}
.dsh-ws-mindmap-canvas{position:absolute;left:0;top:0;transform-origin:0 0}
.dsh-ws-mindmap-edges{position:absolute;inset:0;pointer-events:none;overflow:visible}
.dsh-ws-mindmap-edge:not(.dsh-ws-mindmap-edge-flow){fill:none;stroke:var(--dsw-alias-border-l2,#8a8f98);stroke-width:1.5;opacity:.62}
/* V3 mount edges (root → session head, parent card → nested head): the IDENTITY violet,
   dashed and weaker than the ancestor traces below. Deliberately NOT primary blue any more —
   blue dashed means "the selected card's chain", so a structural edge must not share a
   state edge's color. */
.dsh-ws-mindmap-edge-mount{stroke:var(--dsh-ws-mindmap-head,var(--dsw-alias-state-business-primary));stroke-width:1.6;opacity:.55;stroke-dasharray:4 4}
.dsh-ws-mindmap-edge.dsh-ws-mindmap-edge-flow-under{fill:none;stroke-width:3;stroke-linecap:round;opacity:.9}
.dsh-ws-mindmap-edge-flow{fill:none;stroke-width:3;stroke-linecap:round;stroke-dasharray:10 8;opacity:1;animation:dsh-ws-mindmap-edge-flow 1.1s linear infinite}
@keyframes dsh-ws-mindmap-edge-flow{to{stroke-dashoffset:-18}}
.dsh-ws-mindmap-node{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px;text-align:left;cursor:pointer;overflow:hidden;transition:border-color .12s ease,box-shadow .12s ease}
.dsh-ws-mindmap-node:hover{border-color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-node-current{border-color:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 1px var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary))}
.dsh-ws-mindmap-node-title{flex:none;display:flex;align-items:center;gap:8px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px}
.dsh-ws-mindmap-node-title-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transform:translateY(-1px)}
.dsh-ws-mindmap-node-q{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);flex:1;min-height:0}.dsh-ws-mindmap-node-q-summarizing{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-style:italic;font-weight:500}
.dsh-ws-mindmap-node-status{flex:none;font-size:11px;line-height:15px}
.dsh-ws-mindmap-node-thinking{color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-node-done{color:var(--dsw-alias-label-secondary)}
.dsh-ws-mindmap-node-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.dsh-ws-mindmap-branch{flex:none;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.dsh-ws-mindmap-branch:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-branch:disabled{opacity:.55;cursor:not-allowed}
.dsh-ws-mindmap-node-current-badge{position:absolute;top:3px;right:8px;padding:1px 7px;border-radius:999px;background:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-inverted);font-size:10px;line-height:14px}
/* Branch cards: fork children that cannot overlap the shared chain window render as their own card, with a head row and, when the branch has visible rounds, a per-round preview list. */
.dsh-ws-mindmap-pending{border-style:dashed;cursor:pointer;justify-content:flex-start;align-items:stretch}
.dsh-ws-mindmap-branchcard{border-style:dashed;cursor:pointer;justify-content:flex-start;align-items:stretch;gap:6px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 93%,var(--dsw-alias-label-primary) 7%)}
/* End-of-branch card ("末端"): the whole card wears the accent tint — border, background wash and the "末端" capsule all resolve --dsh-ws-mindmap-end (default success green). The selected / hover ancestor rules still override the border, so the trace highlight stays visible. */
.dsh-ws-mindmap-node.dsh-ws-mindmap-endcard{border-color:var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary));background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 86%,var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary)) 14%)}
/* V3 nodes: the virtual root node (click it to create a new top-level session) and each session's head node (its identity card at the left of the question chain). */
.dsh-ws-mindmap-root{position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:12px;padding:0 18px;border:2px solid var(--dsw-alias-state-business-primary);border-radius:16px;cursor:pointer;user-select:none;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,var(--dsw-alias-bg-layer-1)),color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,var(--dsw-alias-bg-layer-1)));box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);transition:transform .12s ease,box-shadow .12s ease;overflow:hidden}
.dsh-ws-mindmap-root:hover{transform:translateY(-1px);box-shadow:0 0 0 6px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.dsh-ws-mindmap-root-plus{flex:none;width:26px;height:26px;border-radius:50%;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);display:flex;align-items:center;justify-content:center;transition:transform .15s ease}
.dsh-ws-mindmap-root-plus svg{display:block;width:14px;height:14px;transition:transform .15s ease}
.dsh-ws-mindmap-root:hover .dsh-ws-mindmap-root-plus{transform:scale(1.06)}
.dsh-ws-mindmap-root:hover .dsh-ws-mindmap-root-plus svg{transform:rotate(90deg)}
.dsh-ws-mindmap-root-col{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0}
.dsh-ws-mindmap-root-title{font-weight:800;font-size:14px;color:var(--dsw-alias-label-primary);white-space:nowrap}
.dsh-ws-mindmap-root-hint{font-size:10px;line-height:14px;color:var(--dsw-alias-state-business-primary);white-space:nowrap}
.dsh-ws-mindmap-head{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;gap:5px;padding:9px 10px;border:1px solid var(--dsh-ws-mindmap-head,var(--dsw-alias-state-business-primary));border-radius:10px;cursor:pointer;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,var(--dsh-ws-mindmap-head,var(--dsw-alias-state-business-primary)) 12%);overflow:hidden}
.dsh-ws-mindmap-head:hover{box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-head,var(--dsw-alias-state-business-primary)) 40%,transparent)}
.dsh-ws-mindmap-head-current{border-color:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 1px var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary))}
.dsh-ws-mindmap-head-row{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-ws-mindmap-head-icon{flex:none;width:15px;height:15px;color:var(--dsh-ws-mindmap-head,var(--dsw-alias-state-business-primary))}
.dsh-ws-mindmap-head-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary);transform:translateY(-1px)}
.dsh-ws-mindmap-head-meta{display:flex;align-items:center;gap:6px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary)}
.dsh-ws-mindmap-head-meta-live{color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-head-summary{flex:1;min-height:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden;font-size:10px;line-height:14px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsh-ws-mindmap-head-summary-empty{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-style:italic}
/* Session-head hover actions: bottom-left 归档 + bottom-right 总结会话, revealed on card hover /
   focus. A transparent absolute overlay, no scrim — a filled strip would paint a solid band
   across the card's tinted bottom edge — so the card box never shifts and only the summary's
   last line is covered; the full text stays in the tooltip. opacity + pointer-events:none keep
   it from intercepting a click meant for the card. Both sit one size UP (11px / 20px) from the
   in-card pills: heaviest consequences here (an irreversible archive, a paid model call), and
   they used to be the smallest buttons on the canvas at 10px. */
.dsh-ws-mindmap-head-actions{position:absolute;left:0;right:0;bottom:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 6px 5px;box-sizing:border-box;opacity:0;pointer-events:none;transition:opacity .12s ease}
.dsh-ws-mindmap-head:hover .dsh-ws-mindmap-head-actions,.dsh-ws-mindmap-head:focus-within .dsh-ws-mindmap-head-actions{opacity:1;pointer-events:auto}
.dsh-ws-mindmap-head-action{--dsh-ws-mm-tone:var(--dsh-ws-mm-ai);--dsh-ws-mm-tone-bg:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,var(--dsh-ws-mm-tone) 12%);--dsh-ws-mm-tone-border:color-mix(in srgb,var(--dsh-ws-mm-tone) 45%,transparent);flex:none;display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 9px;box-sizing:border-box;border:1px solid var(--dsh-ws-mm-tone-border);border-radius:999px;background:var(--dsh-ws-mm-tone-bg);color:var(--dsh-ws-mm-tone);font:inherit;font-size:11px;line-height:15px;white-space:nowrap;cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease}
.dsh-ws-mindmap-head-action svg{display:block;flex:none}
/* ARCHIVE rests in the neutral fold slate and only turns red while pointed at: it is the one
   destructive action here, already behind a type-"yes" dialog, and a red capsule on every
   crossed head card reads as an error state. Its partner keeps the AI pink at rest — the useful
   action of the pair, and red/pink are ~70° apart in hue so the two never blur. */
.dsh-ws-mindmap-head-action-danger{--dsh-ws-mm-tone:var(--dsh-ws-mm-fold)}
.dsh-ws-mindmap-head-action:hover{--dsh-ws-mm-tone-bg:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 74%,var(--dsh-ws-mm-tone) 26%);--dsh-ws-mm-tone-border:var(--dsh-ws-mm-tone)}
.dsh-ws-mindmap-head-action-danger:hover{--dsh-ws-mm-tone:var(--dsw-alias-state-error-primary);--dsh-ws-mm-tone-border:var(--dsw-alias-state-error-primary)}
.dsh-ws-mindmap-head-action:active{--dsh-ws-mm-tone-bg:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 64%,var(--dsh-ws-mm-tone) 36%)}
.dsh-ws-mindmap-head-action-danger:active{--dsh-ws-mm-tone:var(--dsw-alias-state-error-primary)}
/* Disabled (0 rounds / summarizing / queued): colorless + dashed, the same "state, not a lighter
   button" treatment the in-card pills use. Declared last, and for the hovered case too, so neither
   a tone or the red hover tint can leak back in. */
.dsh-ws-mindmap-head-action:disabled,.dsh-ws-mindmap-head-action:disabled:hover{--dsh-ws-mm-tone:var(--dsw-alias-label-tertiary);--dsh-ws-mm-tone-bg:transparent;--dsh-ws-mm-tone-border:color-mix(in srgb,var(--dsw-alias-label-tertiary) 45%,transparent);border-style:dashed;cursor:not-allowed}
/* "Summary in flight" marker, replacing the sparkle: the streaming status row's pulsing dot, in
   primary blue. It deliberately survives the disabled (dashed, colorless) capsule — "already
   running" must stay distinguishable from "nothing to summarize" (0 rounds). */
.dsh-ws-mindmap-head-action-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary);animation:dsh-ws-mindmap-dot-pulse 1s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.dsh-ws-mindmap-head-action-dot{animation:none}}
/* Live streaming pair: the STREAMING CARD keeps the rotating conic ring (border plus a
   full-colour conic interior spinning through --dsw-ws-mm-angle). Its PARENT node — a question
   card, a folded card or a session head — instead wears a LEFT-TO-RIGHT iridescent flow on both
   the 2px border and the card interior, travelling the same way as the connecting edge's dashes. */
@property --dsw-ws-mm-angle{syntax:'<angle>';initial-value:0deg;inherits:false}
@property --dsh-ws-mm-flow{syntax:'<length>';initial-value:0px;inherits:false}
/* Parent flow, three background layers (top to bottom): a static base-colour scrim
   (padding-box, 66% — keeps title/question readable), the translucent interior flow
   (padding-box, 42% of the pair palette) and the opaque border flow (border-box). The two
   flow layers share ONE 480px period, repeat-x and phase, so one band of light crosses
   border and interior alike; the 0 -> 480px shift is exactly one period, so the loop is
   seamless and moves left to right. The 2px transparent border + compensated padding keep
   content from shifting as the ring appears. Declared BEFORE the streaming rule below,
   which resets these background longhands via shorthand. */
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ring,.dsh-ws-mindmap-head.dsh-ws-mindmap-node-ring{border:2px solid transparent;border-radius:12px;box-shadow:0 0 14px color-mix(in srgb,var(--dsw-ws-mm-c1) 18%,transparent);background-image:linear-gradient(color-mix(in srgb,var(--dsw-alias-bg-layer-1) 66%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-1) 66%,transparent)),linear-gradient(90deg,color-mix(in srgb,var(--dsw-ws-mm-c1) 42%,transparent) 0%,color-mix(in srgb,var(--dsw-ws-mm-c2) 42%,transparent) 33.33%,color-mix(in srgb,var(--dsw-ws-mm-c3) 42%,transparent) 66.67%,color-mix(in srgb,var(--dsw-ws-mm-c1) 42%,transparent) 100%),linear-gradient(90deg,var(--dsw-ws-mm-c1) 0%,var(--dsw-ws-mm-c2) 33.33%,var(--dsw-ws-mm-c3) 66.67%,var(--dsw-ws-mm-c1) 100%);background-size:auto,480px 100%,480px 100%;background-repeat:no-repeat,repeat-x,repeat-x;background-origin:padding-box,padding-box,border-box;background-clip:padding-box,padding-box,border-box;background-position:0 0,var(--dsh-ws-mm-flow) 0,var(--dsh-ws-mm-flow) 0;animation:dsh-ws-mindmap-ring-flow 3.2s linear infinite}
/* Compensated padding per card kind (the head rule wins over the node rule by source order: a head
   carries both classes). The head also pins the plain card fill so a purple-tinted head turns into
   the same base as a question card while it is the parent of a streaming card. */
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ring{padding:7px 9px}
.dsh-ws-mindmap-head.dsh-ws-mindmap-node-ring{padding:8px 9px;background-color:var(--dsw-alias-bg-layer-1)}
/* The streaming card keeps its own conic ring: this rule must re-assert the animation (the parent
   rule above sets the flow animation on the very same element) and its background shorthand resets
   every flow longhand. */
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ring.dsh-ws-mindmap-node-streaming{box-shadow:0 0 14px color-mix(in srgb,var(--dsw-ws-mm-c1) 22%,transparent);background:linear-gradient(color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent)) padding-box,conic-gradient(from var(--dsw-ws-mm-angle),var(--dsw-ws-mm-c1),var(--dsw-ws-mm-c2),var(--dsw-ws-mm-c3),var(--dsw-ws-mm-c1)) padding-box,conic-gradient(from var(--dsw-ws-mm-angle),var(--dsw-ws-mm-c1),var(--dsw-ws-mm-c2),var(--dsw-ws-mm-c3),var(--dsw-ws-mm-c1)) border-box;animation:dsh-ws-mindmap-ring-spin 2.4s linear infinite}
.dsh-ws-mindmap-node-streaming-status{display:flex;align-items:center;gap:6px;color:var(--dsw-ws-mm-c1,var(--dsw-alias-state-business-primary))}
.dsh-ws-mindmap-node-streaming-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-ws-mm-c1,var(--dsw-alias-state-business-primary));animation:dsh-ws-mindmap-dot-pulse 1s ease-in-out infinite}
/* AI-summary-in-progress status row: replaces "已完成" while a summary is being generated; primary blue, same pulse dot as streaming. */
.dsh-ws-mindmap-node-summarizing{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-state-business-primary)}
@keyframes dsh-ws-mindmap-ring-spin{to{--dsw-ws-mm-angle:360deg}}
/* Parent flow: one full 480px period per iteration — the same distance as the tiled gradient, so
   the loop is seamless; the positive direction is what makes the light travel left to right. */
@keyframes dsh-ws-mindmap-ring-flow{to{--dsh-ws-mm-flow:480px}}
@keyframes dsh-ws-mindmap-dot-pulse{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion: reduce){.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ring,.dsh-ws-mindmap-head.dsh-ws-mindmap-node-ring{animation:none}.dsh-ws-mindmap-edge-flow{animation:none}.dsh-ws-mindmap-node-streaming-dot{animation:none}}
.dsh-ws-mindmap-pending-head{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-ws-mindmap-pending-label{flex:none;display:inline-flex;align-items:center;gap:2px;padding:1px 6px 1px 5px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent);border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);font-size:10px;line-height:14px}
/* End-of-branch capsule ("末端"): the same chip shape, tinted with the success green so the terminal-point chip is distinguishable from a fork point. */
.dsh-ws-mindmap-end-label{border-color:color-mix(in srgb,var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary)) 28%,transparent);background:color-mix(in srgb,var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary)) 12%,transparent);color:var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary))}
.dsh-ws-mindmap-pending-icon{flex:none;display:block}
.dsh-ws-mindmap-pending-title{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-weight:600;font-size:12px;line-height:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-mindmap-pending-count{color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px}
.dsh-ws-mindmap-branch-round{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;column-gap:8px;row-gap:1px;align-items:center;padding:5px 7px;border:1px solid var(--dsw-alias-border-l1,transparent);border-radius:8px;background:var(--dsw-alias-bg-base)}
.dsh-ws-mindmap-branch-round .dsh-ws-mindmap-node-q{grid-column:1;font-size:11px;line-height:15px;flex:none;-webkit-line-clamp:1}
.dsh-ws-mindmap-branch-round .dsh-ws-mindmap-node-status{grid-column:1;font-size:11px;line-height:15px}
.dsh-ws-mindmap-branch-round .dsh-ws-mindmap-branch{grid-column:2;grid-row:1 / span 2;align-self:center}
.dsh-ws-mindmap-more{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:15px}
.dsh-ws-mindmap-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-ws-mindmap-bar-title{font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-mindmap-status{display:flex;align-items:flex-start;justify-content:center;padding:48px 24px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;text-align:center}
.dsh-ws-mindmap-loading-hint{margin-top:8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-ws-mindmap-error{color:var(--dsw-alias-state-error-primary)}
/* Transient map messages (fold/unfold notices, fork failures) are an absolutely
   positioned OVERLAY, never in-flow flex rows: as siblings above the viewport they used
   to push the whole canvas down by their own height (~31px + margin) for as long as they
   lived and let it snap back on expiry, so a click aimed at a card's fold pill landed on
   whatever had moved into that spot. pointer-events:none keeps a message from eating a
   click; the shadow keeps an opaque bubble legible over the cards. */
.dsh-ws-mindmap-toasts{position:absolute;left:50%;bottom:14px;z-index:6;display:flex;flex-direction:column;align-items:center;gap:8px;max-width:min(560px,calc(100% - 32px));transform:translateX(-50%);pointer-events:none;box-sizing:border-box}
.dsh-ws-mindmap-fork-error{padding:6px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:17px;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.24));box-sizing:border-box}
.dsh-ws-mindmap-notice{padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.24));box-sizing:border-box}
.dsh-ws-mindmap-notice-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-ws-mindmap-node[data-branch]{border-style:solid}
/* Folded card: one compact card for a maximal run of consecutive folded turns — dashed border + muted wash, fold icon + count badge in the title row, first-turn text in the body. Placed after the [data-branch] solid rule and before the ancestor/hover rules so the traces keep their border-color overrides. A RING card is exempt: its background shorthand would wipe the streaming pair's flow layers (a folded card can parent a streaming card) and its dashed border would replace the flow border. */
.dsh-ws-mindmap-node.dsh-ws-mindmap-folded:not(.dsh-ws-mindmap-node-ring){border-style:dashed;border-color:color-mix(in srgb,var(--dsh-ws-mm-fold) 42%,transparent);background-color:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 90%,var(--dsh-ws-mm-fold) 10%);background-image:repeating-linear-gradient(135deg,color-mix(in srgb,var(--dsh-ws-mm-fold) 26%,transparent) 0 5px,transparent 5px 11px)}
/* Folded-run count badge: a neutral OUTLINED capsule on the fold slate. It used to be a solid
   business-blue pill — the same shape and color as the "当前" badge and the hint chip — which read
   as "primary action" for what is only a count of collapsed turns. */
.dsh-ws-mindmap-fold-count{flex:none;padding:0 6px;border:1px solid color-mix(in srgb,var(--dsh-ws-mm-fold) 55%,transparent);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px;font-weight:600}
.dsh-ws-mindmap-node-q-folded{color:var(--dsw-alias-label-secondary);font-style:italic;font-weight:500}
.dsh-ws-mindmap-node-folded-status{color:var(--dsh-ws-mm-fold)}
/* Peeked card status: a folded-marked turn temporarily expanded (click on the folded card); the folded attribute is untouched, so the status row says 已折叠 in amber. */
.dsh-ws-mindmap-node-peeked-status{color:var(--dsw-alias-state-warn-primary)}
/* Temporary-expand (peek) outline around the run: amber dashed box, never intercepts pointer events. */
.dsh-ws-mindmap-peek-box{position:absolute;border:1.5px dashed var(--dsw-alias-state-warn-primary);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 4%,transparent);pointer-events:none;box-sizing:border-box}
/* Selected-card ancestor trace: the current card's chain back to the root — edges turn dashed primary-blue, parent nodes get a dashed primary-blue border. */
.dsh-ws-mindmap-edge.dsh-ws-mindmap-edge-active{stroke:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));stroke-dasharray:6 5;stroke-width:2;opacity:1}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ancestor{border-style:dashed;border-color:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary)) 18%,transparent)}
/* Hover ancestor trace: the card under the pointer gets a solid amber border + soft glow, its ancestors and path edges go amber dashed — distinct from the selected card's blue chain. Each hover class sits after its blue counterpart, so hover wins when a card or edge is on both paths. Ring (streaming) cards are excluded. */
.dsh-ws-mindmap-edge.dsh-ws-mindmap-edge-hover-active{stroke:var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary));stroke-dasharray:6 5;stroke-width:2;opacity:1}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-hover-ancestor{border-style:dashed;border-color:var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary)) 22%,transparent)}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-hover:not(.dsh-ws-mindmap-node-ring){border-style:solid;border-color:var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary)) 35%,transparent),0 0 14px color-mix(in srgb,var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary)) 22%,transparent)}
/* Hover hint chip: tells the user what a click on this card will do. It is NOT a button
   (pointer-events:none), so it must not LOOK like one — it used to be a blue capsule with a solid
   border, indistinguishable from the real pills, in the very corner the colored 总结卡片 / 立刻折叠
   pill uses. Neutral text on a faint wash with a DASHED border says "caption", and the colorless
   corner keeps the action pill dominant. */
.dsh-ws-mindmap-node-hint{position:absolute;right:5px;bottom:5px;z-index:1;max-width:calc(100% - 10px);padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 94%,transparent);color:var(--dsw-alias-label-secondary);border:1px dashed color-mix(in srgb,var(--dsw-alias-label-secondary) 50%,transparent);font-size:10px;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;box-sizing:border-box}
/* In-card hover pills — the card's four buttons: 折叠 / 取消折叠 / 立刻折叠 / 总结卡片. One tone
   system (--dsh-ws-mm-tone + 12% wash, 45% border, tone as text); only [data-tone] picks the hue:
   折叠 = fold slate, 取消折叠 = primary blue, 立刻折叠 = warn amber, 总结卡片 = AI pink. Two
   departures from the old single gray capsule: (1) the tone is STATIC — that rule stayed neutral
   until :hover, so all four looked identical until you already pointed at one; (2) the wash is
   OPAQUE — folded cards carry 135° stripes and a streaming parent a moving light band, and a
   92%-transparent capsule let those patterns show through the 11px label. Contract untouched: the
   hidden state keeps opacity:0 + pointer-events:none (an invisible pill must never steal the card's
   own click: fork / switch / peek), and the status row cross-fades underneath between SAME-hue
   values instead of gray-to-color. The pills sit exactly where the status row was, so the fixed
   card box never shifts. */
.dsh-ws-mindmap-node-status{transition:opacity .12s ease}
.dsh-ws-mindmap-node-foldpill{--dsh-ws-mm-tone:var(--dsh-ws-mm-fold);--dsh-ws-mm-tone-bg:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,var(--dsh-ws-mm-tone) 12%);--dsh-ws-mm-tone-border:color-mix(in srgb,var(--dsh-ws-mm-tone) 45%,transparent);position:absolute;left:10px;bottom:5px;z-index:2;height:20px;padding:0 8px;box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsh-ws-mm-tone-border);border-radius:999px;background:var(--dsh-ws-mm-tone-bg);color:var(--dsh-ws-mm-tone);cursor:pointer;font:inherit;font-size:11px;line-height:15px;white-space:nowrap;opacity:0;transform:translateY(2px);pointer-events:none;transition:opacity .12s ease,transform .12s ease,border-color .12s ease,color .12s ease,background .12s ease}
.dsh-ws-mindmap-node-foldpill svg{display:block;flex:none}
.dsh-ws-mindmap-node-foldpill-right{left:auto;right:10px}
.dsh-ws-mindmap-node-foldpill[data-tone="unfold"]{--dsh-ws-mm-tone:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-node-foldpill[data-tone="peek"]{--dsh-ws-mm-tone:var(--dsw-alias-state-warn-primary)}
.dsh-ws-mindmap-node-foldpill[data-tone="ai"]{--dsh-ws-mm-tone:var(--dsh-ws-mm-ai)}
.dsh-ws-mindmap-node:hover>.dsh-ws-mindmap-node-foldpill{opacity:1;transform:none;pointer-events:auto}
.dsh-ws-mindmap-node-foldpill:hover{--dsh-ws-mm-tone-bg:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 76%,var(--dsh-ws-mm-tone) 24%);--dsh-ws-mm-tone-border:var(--dsh-ws-mm-tone)}
.dsh-ws-mindmap-node-foldpill:active{--dsh-ws-mm-tone-bg:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 66%,var(--dsh-ws-mm-tone) 34%)}
.dsh-ws-mindmap-node-foldpill:focus-visible{outline:2px solid var(--dsh-ws-mm-tone);outline-offset:1px}
.dsh-ws-mindmap-node:has(>.dsh-ws-mindmap-node-foldpill):hover>.dsh-ws-mindmap-node-status{opacity:0}
/* A disabled pill (this card's summary is already generating) drops its color and switches to a DASHED border instead of fading the capsule, so "not clickable right now" reads as a state, not a lighter button. The reveal rules keep pointer events on: the click must land here rather than fall through to the card and fork (same contract as the head's disabled button). */
.dsh-ws-mindmap-node-foldpill:disabled{opacity:0;cursor:default;border-style:dashed;--dsh-ws-mm-tone:var(--dsw-alias-label-tertiary);--dsh-ws-mm-tone-bg:transparent;--dsh-ws-mm-tone-border:color-mix(in srgb,var(--dsw-alias-label-tertiary) 45%,transparent)}
.dsh-ws-mindmap-node:hover>.dsh-ws-mindmap-node-foldpill:disabled{opacity:.9}
/* Settings color swatch for the mind-map highlight pickers. */
.dsh-ws-mindmap-hidden-row{display:none!important}
.dsh-ws-mindmap-no-overflow{display:none!important}
/* Sidebar mind-map session entries: rendered inside each workspace group's session list; flat / search modes use a region-area fallback seat instead. Draggable to reorder; right-click menu (rename / reveal). Empty containers collapse. */
.dsh-ws-sidebar-mindmaps{min-width:0;display:flex;flex-direction:column;gap:2px;padding:2px 8px 4px;box-sizing:border-box}
.dsh-ws-sidebar-mindmaps:empty{display:none}
.dsh-ws-sidebar-mindmaps-fallback{flex:none;padding:2px 2px 6px}
.dsh-ws-sidebar-mindmaps-empty{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:11px;line-height:16px;padding:0 4px}
.dsh-ws-sidebar-mindmaps-list{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-ws-sidebar-mindmaps-item{display:flex;align-items:center;gap:6px;min-width:0;height:30px;padding:0 8px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:17px;text-align:left;cursor:grab}
.dsh-ws-sidebar-mindmaps-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-sidebar-mindmaps-item[data-dragging]{opacity:.45}
.dsh-ws-sidebar-mindmaps-item[data-drop="before"]{box-shadow:inset 0 2px 0 var(--dsw-alias-state-business-primary)}
.dsh-ws-sidebar-mindmaps-item[data-drop="after"]{box-shadow:inset 0 -2px 0 var(--dsw-alias-state-business-primary)}
.dsh-ws-sidebar-mindmaps-icon{flex:none;width:14px;height:14px;color:var(--dsw-alias-state-business-primary)}
/* While any session in a mind map family streams, spin the left icon to mirror the hidden ordinary rows' live generation. */
@keyframes dsh-ws-mindmap-spin{to{transform:rotate(360deg)}}
.dsh-ws-sidebar-mindmaps-item[data-running] .dsh-ws-sidebar-mindmaps-icon{animation:dsh-ws-mindmap-spin var(--dsh-ws-mindmap-spin-duration,1.2s) linear infinite;transform-origin:center}
@media (prefers-reduced-motion: reduce){.dsh-ws-sidebar-mindmaps-item[data-running] .dsh-ws-sidebar-mindmaps-icon{animation:none}}
.dsh-ws-sidebar-mindmaps-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-sidebar-mindmaps-count{flex:none;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px}
.dsh-ws-frame[data-sidebar-files] .dsh-ws-sidebar-mindmaps{display:none}
.dsh-ws-frame[data-sidebar-collapsed] .dsh-ws-sidebar-mindmaps{display:none}
/* A collapsed group renders no rows, but the injected mind-map seat is a foreign node React leaves in place. Harness wraps the group header in a HoverCard span and appends the seat to it, so both share one direct parent; fold the seat with the folder by matching that parent. */
[data-slot="sidebar.workspaces"] *:has(> [role="treeitem"][aria-expanded="false"]) > .dsh-ws-sidebar-mindmaps{display:none}
/* Rendered-Markdown overlay inside the preview body: absolute keeps the mounted CodeMirror alive underneath. */
.dsh-ws-md-preview{position:absolute;inset:0;overflow:auto;box-sizing:border-box;padding:16px 20px;background:var(--dsw-alias-bg-base)}
/* Rendered-page overlay for HTML files: the iframe fills the body; the page owns its background and scrolling. */
.dsh-ws-html-preview{position:absolute;inset:0;overflow:hidden;box-sizing:border-box;background:var(--dsw-alias-bg-base)}
.dsh-ws-html-preview iframe{display:block;width:100%;height:100%;border:0}
.dsh-ws-html-preview .dsh-ws-banner{position:absolute;top:0;left:0;right:0;z-index:1}
/* ---- Renderer views (registry-driven, mirroring the harness right-Sidebar document-preview pipeline) ---- */
/* Standalone image view and paged read-only browse share the scrollable body. */
.dsh-ws-renderer-view{flex:1;min-height:0;overflow:auto;box-sizing:border-box;background:var(--dsw-alias-bg-base)}
.dsh-ws-renderer-image{display:flex;align-items:center;justify-content:center;padding:16px}
.dsh-ws-renderer-image img{max-width:100%;max-height:100%;object-fit:contain}
.dsh-ws-renderer-browse{padding:16px 20px}
.dsh-ws-renderer-status{display:flex;align-items:center;justify-content:center;flex:1;min-height:0;padding:16px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:center}
.dsh-ws-renderer-status[data-error]{color:var(--dsw-alias-state-error-primary)}
/* PDF / Office view: a banner (missing fonts) above a full-height native PDF frame. The frame is deliberately NOT sandboxed — a sandboxed frame has no PDF viewer in Chromium. */
.dsh-ws-renderer-status-stack{display:flex;flex-direction:column;align-items:center;gap:8px}
.dsh-ws-renderer-retry{padding:3px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-ws-renderer-retry:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-renderer-converted{display:flex;flex-direction:column;overflow:hidden}
.dsh-ws-renderer-converted .dsh-ws-pdf-frame{flex:1;min-height:0;width:100%;border:0;background:var(--dsw-alias-bg-base)}
.dsh-ws-renderer-more{display:block;margin:10px auto;padding:4px 14px;border:0;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.dsh-ws-renderer-more:hover{color:var(--dsw-alias-label-primary)}
.dsh-ws-renderer-more:disabled{cursor:not-allowed;opacity:.55}
/* ---- Studio edit/write tool rows (chat takeover): one card per file, header inside ---- */
.dsh-ws-tool-row{box-sizing:border-box;display:flex;flex-direction:column;width:100%;min-width:0;margin:6px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
/* Scroll-gate armed cue: the card owns the wheel after a click inside. */
.dsh-ws-tool-row[data-scroll-armed]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsh-ws-tool-rowline{position:relative;display:flex;align-items:center;gap:6px;min-height:24px;padding:4px 10px;cursor:pointer;overflow:hidden}
.dsh-ws-tool-rowline:hover{background:rgba(128,138,158,.08)}
.dsh-ws-tool-chevron{flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-caption);transition:transform 120ms ease}
.dsh-ws-tool-row[data-collapsed] .dsh-ws-tool-chevron{transform:rotate(-90deg)}
.dsh-ws-tool-leading{flex:none;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;margin-right:0;padding:0;border:none;background:none;color:var(--dsw-alias-label-tertiary)}
.dsh-ws-tool-leading svg:not([data-state]){width:14px;height:14px}
.dsh-ws-tool-title{flex:none;font-size:13px;line-height:24px;color:var(--dsw-alias-label-secondary);font-weight:400}
.dsh-ws-tool-sep{flex:none;width:2px;height:2px;border-radius:1px;margin:0 8px;background:var(--dsw-alias-label-caption)}
.dsh-ws-tool-summary{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:24px;color:var(--dsw-alias-label-tertiary)}
.dsh-ws-tool-error-summary{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-tool-filelink{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0;padding:0;border:none;background:none;font:inherit;text-align:left;font-size:13px;line-height:24px;color:var(--dsw-alias-label-secondary);text-decoration:underline dotted;text-decoration-color:var(--dsw-alias-label-tertiary);text-decoration-thickness:1px;text-underline-offset:3px;cursor:pointer}
.dsh-ws-tool-filelink:hover{color:var(--dsw-alias-label-primary);text-decoration-color:currentColor}
.dsh-ws-tool-head-spacer{flex:1 1 auto;min-width:8px}
.dsh-ws-tool-diffstat{flex:none;margin-left:10px;font-family:var(--ds-font-family-code);font-size:11px;color:var(--dsw-alias-label-caption);transform:translateY(.5px)}
/* State chrome (running / failed / stopped) at the header right. */
.dsh-ws-tool-state{flex:none;display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-ws-tool-state-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-caption)}
.dsh-ws-tool-state[data-state='running'] .dsh-ws-tool-state-dot{background:var(--dsw-alias-state-business-primary);animation:dsh-ws-tool-dot-pulse 1s ease-in-out infinite}
.dsh-ws-tool-state[data-state='error'] .dsh-ws-tool-state-dot{background:var(--dsw-alias-state-error-primary)}
.dsh-ws-tool-state[data-state='stopped'] .dsh-ws-tool-state-dot{background:var(--dsw-alias-state-warn-primary)}
@keyframes dsh-ws-tool-dot-pulse{0%,100%{opacity:1}50%{opacity:.25}}
/* Always-visible header copy button (diff cards only). */
.dsh-ws-tool-copy{flex:none;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.dsh-ws-tool-copy:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dsh-ws-tool-body{display:flex;flex-direction:column}
.dsh-ws-tool-io{display:flex;flex-direction:column;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-code-block-small)}
.dsh-ws-tool-io-section{display:grid;grid-template-columns:max-content 1fr;column-gap:14px;align-items:baseline;padding:12px 16px;overflow-y:auto}
.dsh-ws-tool-io-label{position:sticky;top:0;align-self:start;color:var(--dsw-alias-label-caption)}
.dsh-ws-tool-io-divider{flex:none;height:0.5px;background:var(--dsw-alias-border-l2)}
.dsh-ws-tool-io-text{min-width:0;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}
.dsh-ws-tool-io-text[data-error]{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-tool-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dsh-ws-tool-row[data-state='running'] .dsh-ws-tool-rowline::after{content:'';position:absolute;top:0;bottom:0;left:0;width:300px;background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent) 55%,transparent 100%);animation:dsh-ws-tool-sweep 2.6s ease-out infinite;pointer-events:none}
@keyframes dsh-ws-tool-sweep{0%{left:-300px}90%,100%{left:100%}}
.dsh-ws-diff-body{padding:12px 14px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-code-block);overflow-x:auto}
.dsh-ws-diff-line{min-height:22px;white-space:pre}
.dsh-ws-diff-gap{color:var(--dsw-alias-label-tertiary)}
.dsh-ws-diff-del{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;text-decoration-thickness:1.5px}
.dsh-ws-diff-ins{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary);border-radius:3px;padding:0 1px;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.dsh-ws-diff-ins-line{display:block;margin:0 -14px;padding:0 14px}
/* ---- Edit/write tool cards share the Think-card pattern: the per-file diff body and the generic input/output sections are fixed-height viewports limited to the --dsh-ws-edit-lines line count (the 编辑显示行数 slider, independent of the Think-card count), with the same slim right-side scrollbar. ---- */
.dsh-ws-diff-body,.dsh-ws-tool-io-section{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,transparent) transparent;overscroll-behavior:contain}
.dsh-ws-diff-body::-webkit-scrollbar,.dsh-ws-tool-io-section::-webkit-scrollbar{width:6px;height:6px}
.dsh-ws-diff-body::-webkit-scrollbar-thumb,.dsh-ws-tool-io-section::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,transparent);border:1px solid transparent;border-radius:6px;background-clip:padding-box}
.dsh-ws-diff-body::-webkit-scrollbar-thumb:hover,.dsh-ws-tool-io-section::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,transparent)}
.dsh-ws-diff-body::-webkit-scrollbar-track,.dsh-ws-tool-io-section::-webkit-scrollbar-track{background:transparent}
.dsh-ws-diff-body{max-height:calc(var(--dsh-ws-edit-lines,10) * 22px + 24px);overflow-y:auto}
.dsh-ws-tool-io-section{max-height:calc(var(--dsh-ws-edit-lines,10) * 20px + 24px)}
/* ---- Think card (chat thinking blocks): the block stays open as a card (hooks/think-card.js keeps rows open) whose body viewport shows only the latest --dsh-ws-think-lines rows, with the card's own slim scrollbar. The body class is a CSS-module name (may be hashed), so rules match the "thinkBody" substring. ---- */
.dsh-ws-chat [data-variant="think"]{box-sizing:border-box;margin:6px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.dsh-ws-chat [data-variant="think"][data-scroll-armed]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsh-ws-chat [data-variant="think"] [class*="thinkBody"]{box-sizing:border-box;max-height:calc(var(--dsh-ws-think-lines,10) * (20px + var(--dsh-content-font-delta-secondary,0px)) + 11px);overflow-y:auto;padding:2px 10px 8px 22px;border-top:1px solid var(--dsw-alias-border-l1);overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,transparent) transparent}
.dsh-ws-chat [data-variant="think"] [class*="thinkBody"]::-webkit-scrollbar{width:6px}
.dsh-ws-chat [data-variant="think"] [class*="thinkBody"]::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,transparent);border:1px solid transparent;border-radius:6px;background-clip:padding-box}
.dsh-ws-chat [data-variant="think"] [class*="thinkBody"]::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,transparent)}
.dsh-ws-chat [data-variant="think"] [class*="thinkBody"]::-webkit-scrollbar-track{background:transparent}
/* Think-card header chevron: nudge the disclosure glyph right off the card's left border edge. */
.dsh-ws-chat [data-variant="think"] [data-disclosure-row] > span:first-child{margin-left:6px}
/* Token statistics dialog (设置 → 工作区设置 → Token 统计): a wide two-column panel — model detail |
   quick calculator — with the range controls and the foot line full width above/below. Each column
   owns one scrolling list, so a long model list can never spill out of the panel or push the name
   filter / calculator out of view; the dialog is a flex column because the body's flex:1 /
   min-height:0 means nothing inside a block parent (the rows would just overflow the fixed-height
   box unreachable). The body's own overflow is only a fallback for a window too short for both
   columns' minimum height. */
.dsh-ws-token-dialog{display:flex;flex-direction:column;width:min(1400px,100%);height:min(700px,92vh);overflow:hidden;border-radius:12px}
.dsh-ws-token-dialog .dsh-ws-dialog-header,.dsh-ws-token-dialog .dsh-ws-token-foot{flex:none}
.dsh-ws-token-dialog .dsh-ws-dialog-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;gap:10px}
.dsh-ws-token-dialog .dsh-ws-dialog-body>.dsh-ws-token-controls,
.dsh-ws-token-dialog .dsh-ws-dialog-body>.dsh-ws-token-kpis{flex:none}
.dsh-ws-token-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-ws-token-controls .dsh-ws-settings-select{flex:1;min-width:0;max-width:200px}
/* Model name filter: the left column's own control chip, framed exactly like the calculator's
   price chips (same border / radius / fill) and hugging its content — align-self overrides the
   column's stretch, and max-width:100% plus the field's min-width:0 keeps the chip shrinking with
   the card instead of overflowing it when the divider is dragged far right. Reuses
   .dsh-ws-search-input for the field look and .dsh-ws-search-hit for matched fragments; the model
   count it used to carry now lives in the column header. box-sizing:border-box is declared because
   this plugin has no global reset — without it max-width:100% would cap only the content and the
   padding+border would still push past the card's edge on a narrow column. */
.dsh-ws-token-filter{display:flex;align-items:center;gap:8px;flex-wrap:wrap;align-self:flex-start;box-sizing:border-box;max-width:100%;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-ws-token-filter-field{position:relative;display:inline-flex;align-items:center;flex:1 1 auto;width:300px;min-width:0;max-width:340px}
.dsh-ws-token-filter-field .dsh-ws-search-input{width:100%;height:28px;padding-right:26px}
.dsh-ws-token-filter-clear{position:absolute;right:3px;width:22px;height:22px;font-size:15px;line-height:1}
.dsh-ws-token-date{height:28px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-sizing:border-box}
.dsh-ws-token-date:disabled{opacity:.5}
.dsh-ws-token-check{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;user-select:none}
/* Two-column body: 模型明细 (left) | 快速计算 (right). flex, never grid — a grid auto row takes
   its content height and ignores the container, so a long list would blow the panel open; flex's
   flex:1 1 0% + min-height:0 is what hands each column the leftover height and lets the table
   inside scroll. box-sizing is declared here because this plugin has no global reset. */
.dsh-ws-token-split{display:flex;flex:1 1 0%;gap:0;min-width:0;min-height:220px}
.dsh-ws-token-pane{display:flex;flex:1 1 0%;flex-direction:column;gap:8px;box-sizing:border-box;min-width:0;min-height:0}
/* Both columns are one card design: same border, radius, padding and fill, so the panel reads as
   two equal halves and only the divider separates them. box-sizing is border-box, so the left
   column's remembered pixel width still includes its border — the divider's maths is unaffected. */
.dsh-ws-token-pane[data-side='left'],
.dsh-ws-token-pane[data-side='right']{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
/* Never dragged: the built-in ratio, so both columns keep scaling with the window. */
.dsh-ws-token-split>.dsh-ws-token-pane[data-side='left']{flex-grow:1.08}
.dsh-ws-token-split>.dsh-ws-token-pane[data-side='right']{flex-grow:0.92}
/* Dragged at least once: the left column is the remembered pixel width. max-width is the second
   clamp — a width stored on a wide window must not squeeze the right column on a narrow one. */
.dsh-ws-token-split[data-custom]>.dsh-ws-token-pane[data-side='left']{flex:0 1 auto;width:var(--dsh-ws-token-split);max-width:calc(100% - 424px)}
/* …and the right column must then take the WHOLE remainder. The two ratio factors add up to 2, so
   by default both columns grow and the panel fills exactly; with the left column pinned its grow
   factor is 0 and only 0.92 is left — and by the flexbox rule for a grow-factor sum below one, only
   that fraction of the free space is handed out. The card then floated inward by a gap (8% of the
   remainder) that changed with every drag, so its right border no longer lined up with the panel's
   right edge / the summary strip above it. */
.dsh-ws-token-split[data-custom]>.dsh-ws-token-pane[data-side='right']{flex-grow:1}
.dsh-ws-token-pane-head{display:flex;align-items:center;gap:8px;flex:none}
.dsh-ws-token-pane-title{display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
.dsh-ws-token-pane-title::before{content:'';flex:none;width:3px;height:13px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}
/* The trailing figure of a column header: both columns render the same 选中 N 个模型 line, pushed to
   the far right of their own card, so the two headers line up and only the titles differ. */
.dsh-ws-token-pane-sub{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap;font-variant-numeric:tabular-nums}
/* Left column: the filter is fixed, the table is scroll region 1. */
.dsh-ws-token-pane[data-side='left']>.dsh-ws-token-filter,
.dsh-ws-token-pane[data-side='left']>.dsh-ws-token-state{flex:none}
.dsh-ws-token-pane[data-side='left']>.dsh-ws-token-table-wrap{flex:1 1 auto;min-height:0}
.dsh-ws-token-pane[data-side='left']>.dsh-ws-token-state{flex:1 1 auto;justify-content:center}
/* Right column: the quick-calculator card. Header and price chips are fixed, the money table is
   scroll region 2. The old padding-top + border-top divider is gone — the card's own border does it. */
.dsh-ws-token-cost{gap:8px}
.dsh-ws-token-pane[data-side='right']>.dsh-ws-token-cost-head,
.dsh-ws-token-pane[data-side='right']>.dsh-ws-token-prices{flex:none}
.dsh-ws-token-pane[data-side='right']>.dsh-ws-token-table-wrap{flex:1 1 auto;min-height:0}
/* Summary strip above the split, hidden when there is nothing to summarize. Its six cards are the
   five token figures plus the calculator's money total, so the strip ends on the number the user
   came for. */
.dsh-ws-token-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
.dsh-ws-token-kpi{display:flex;flex-direction:column;gap:2px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);box-sizing:border-box}
.dsh-ws-token-kpi-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-ws-token-kpi-value{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;line-height:22px;font-variant-numeric:tabular-nums}
.dsh-ws-token-kpi[data-accent] .dsh-ws-token-kpi-value{color:var(--dsw-alias-state-business-primary)}
/* The money card reuses the money column's success tint; a genuine zero (no prices filled in yet)
   stays quiet instead of shouting a green ¥0.0000. */
.dsh-ws-token-kpi[data-money] .dsh-ws-token-kpi-value{color:var(--dsw-alias-state-success-primary)}
.dsh-ws-token-kpi[data-money][data-zero] .dsh-ws-token-kpi-value{color:var(--dsw-alias-label-tertiary);font-weight:400}
/* The token panel's divider: the shared .dsh-ws-splitter drag/keyboard behaviour, placed as a real
   flex child instead of an absolutely positioned frame handle. Declared after the base rule on
   purpose — same specificity, so source order is what makes the inline variant win. */
.dsh-ws-splitter-inline{position:relative;top:auto;bottom:auto;left:auto;z-index:2;flex:none;align-self:stretch;width:14px;height:auto;margin:0}
.dsh-ws-splitter-inline::after{left:6px;border-radius:2px}
.dsh-ws-splitter-inline:focus-visible{outline:none}
.dsh-ws-token-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,transparent) transparent}
.dsh-ws-token-table-wrap::-webkit-scrollbar{width:8px;height:8px}
.dsh-ws-token-table-wrap::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,transparent);border:2px solid transparent;border-radius:8px;background-clip:padding-box}
.dsh-ws-token-table-wrap::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,transparent);background-clip:padding-box}
.dsh-ws-token-table-wrap::-webkit-scrollbar-track{background:transparent}
.dsh-ws-token-table{width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap}
.dsh-ws-token-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-weight:600;text-align:right;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);z-index:1}
.dsh-ws-token-table th:first-child,.dsh-ws-token-table td:first-child{text-align:left}
.dsh-ws-token-table td{padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);text-align:right;font-variant-numeric:tabular-nums}
.dsh-ws-token-table tbody tr:last-child td{border-bottom:0}
.dsh-ws-token-table tbody tr:hover td{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent)}
.dsh-ws-token-table .dsh-ws-token-dim td{opacity:.45}
/* The per-model checkbox is the model cell's first inline box — there is no checkbox column any
   more. That column measured 46px (declared 34px + 12px padding, content box: this plugin has no
   global box-sizing) while the checkbox is 13px, so two thirds was empty gutter; merging the two
   also lets the 模型 header and 汇总 row start flush at the cell's left edge. width/height are
   pinned like the collection-member checkbox; margin:0 is required because the UA stylesheet gives
   a checkbox 4px/3px margins, which this table used to keep. */
.dsh-ws-token-table .dsh-ws-token-model-check{width:13px;height:13px;margin:0 6px 0 0;vertical-align:-2px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
/* The model column is PINNED, not merely capped. Both tables share this cell class, and with only
   a max-width the column still grew with the card's slack — measured 355px in the model table
   against 402px in the calculator at the same card width, so the two 模型 columns stopped matching
   as soon as the divider was dragged. border-box makes 304px the whole column (12px + 280px +
   12px), exactly what the cap produced before; the number columns left of it absorb the remainder,
   so the table still fills its card and its right edge stays aligned. Trade-off: on a wider card
   the extra width goes to the number columns, the name column stays at 280px (what max-width:280px
   always meant). */
.dsh-ws-token-table .dsh-ws-token-model{width:304px;max-width:304px;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;text-align:left}
.dsh-ws-token-table .dsh-ws-token-total-row td{font-weight:700;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent)}
/* The summary row rides the bottom of its own scroll region, so scrolling a long list never hides
   the totals. Both tables use the same row class; the opaque background is required — the plain
   total-row tint above is translucent and the rows scrolling underneath would show through. */
.dsh-ws-token-table tr.dsh-ws-token-total-row td{position:sticky;bottom:0;z-index:1;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,var(--dsw-alias-bg-layer-1))}
/* The whole model row is a second hit area for its checkbox: pointer cursor on the row plus a slightly stronger hover/active tint, so the target is obvious without adding a hint line. Specificity beats the plain row-hover rule above. The checkbox sits in that same cell, so it keeps the pointer cursor — clicking it is the same action, not a second path. */
.dsh-ws-token-table tbody tr.dsh-ws-token-selectable{cursor:pointer}
.dsh-ws-token-table tbody tr.dsh-ws-token-selectable:hover td{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dsh-ws-token-table tbody tr.dsh-ws-token-selectable:active td{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}
/* Both tables' data and summary rows are pinned to the same height. The calculator's rows each sit
   in their own <tbody> and keep a collapsed border under every model, which rounded them half a
   pixel taller than the model table's rows (33.5 vs 33) — across ten models that drift becomes
   visible between the two row grids. An explicit height is only a floor in table layout: taller
   content (the expanded price row, a larger font) still wins, nothing gets clipped. */
.dsh-ws-token-table tbody tr.dsh-ws-token-selectable,
.dsh-ws-token-table tbody tr.dsh-ws-token-cost-row,
.dsh-ws-token-table tbody tr.dsh-ws-token-total-row{height:34px}
.dsh-ws-token-state{display:flex;flex-direction:column;align-items:center;gap:10px;padding:36px 16px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-align:center}
.dsh-ws-token-state[data-error]{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-token-foot{padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;display:flex;flex-direction:column;gap:2px}
.dsh-ws-token-failed{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-token-warming{color:var(--dsw-alias-label-secondary)}
/* ---- Quick calculator: the split's right column — shared unit prices (per 1M tokens) as one bordered chip per field, plus a per-model amount table whose price line sits on its own row so the table stays at five columns and never needs a horizontal scrollbar. No new colors: the money column reuses the success tint, everything else the shared aliases. The card look (border / radius / padding) lives with the pane rules above. ---- */
.dsh-ws-token-cost{display:flex;flex-direction:column;gap:8px}
.dsh-ws-token-cost-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-ws-token-cost-title{display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
.dsh-ws-token-cost-title::before{content:'';flex:none;width:3px;height:13px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}
.dsh-ws-token-prices{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
/* Default prices: one chip = one label + its input — flex:none with a never-wrapping label, so a narrow panel breaks between chips and a label can never drift away from its own box. Padding (5px) + a 28px input give a 40px chip — exactly the height of the model-filter chip in the left column, which must stay equal: the two control rows sit in twin cards at the same y, and a 4px difference reads as a misalignment. Change one side and change the other. */
.dsh-ws-token-price-group{display:inline-flex;flex:none;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-ws-token-price-label{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;white-space:nowrap}
/* 28px, the same height the filter chip's search field uses, so both control rows measure 40px. The per-row override boxes inside the money table keep their own 24px (rule further down). */
.dsh-ws-token-price-input{width:66px;height:28px;padding:0 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:right;font-variant-numeric:tabular-nums;box-sizing:border-box}
.dsh-ws-token-price-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-ws-token-price-input::placeholder{color:var(--dsw-alias-label-caption);opacity:.75}
.dsh-ws-token-price-cur{width:40px;text-align:center}
.dsh-ws-token-price-unit{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;white-space:nowrap}
/* Amount table: one model per <tbody> (token/money line + a price line that only exists once the row is revealed), so :hover can light up both lines of that model at once. The separator sits BELOW the price line, and a collapsed row keeps its own separator — a model must never run into the next one. */
.dsh-ws-token-cost-table tbody:hover tr td{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent)}
.dsh-ws-token-cost-table tbody[data-open] tr:first-child td{border-bottom:0}
.dsh-ws-token-cost-table tbody tr.dsh-ws-token-cost-prices td{padding:4px 12px 6px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-ws-token-cost-table tbody:hover tr.dsh-ws-token-cost-prices td{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent)}
.dsh-ws-token-cost-table tbody:not(:last-child) tr:last-child td{border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-ws-token-cost-table tbody:last-child tr:last-child td{border-bottom:0}
/* Clicking a model row reveals its price boxes; a row with its own prices is always open, so it keeps the default cursor and a disabled toggle. */
.dsh-ws-token-cost-row{cursor:pointer}
.dsh-ws-token-cost-row[data-locked]{cursor:default}
/* The calculator's ▸/▾ row toggle occupies exactly what the model table's checkbox does — a 13px box
   plus a 6px gap — so both tables' names start at the same offset in their model column (31px) and the
   row grids line up. Its vertical-align matches the checkbox's -2px too, instead of the middle it used
   before, which made the calculator's rows a pixel taller. */
.dsh-ws-token-cost-toggle{width:13px;height:13px;margin-right:6px;padding:0;border:0;border-radius:3px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:10px;line-height:1;cursor:pointer;vertical-align:-2px}
.dsh-ws-token-cost-toggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-token-cost-toggle:disabled{cursor:default;opacity:.6}
/* Each override box lives in the cell of the token column it prices, so its right edge lines up with the number above. */
.dsh-ws-token-cost-table tbody tr.dsh-ws-token-cost-prices td>.dsh-ws-token-price-input{width:78px;height:24px}
.dsh-ws-token-cost-pricelegend{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.dsh-ws-token-cost-table .dsh-ws-token-money{font-weight:600;color:var(--dsw-alias-state-success-primary)}
.dsh-ws-token-cost-table .dsh-ws-token-money[data-zero]{color:var(--dsw-alias-label-tertiary);font-weight:400}
.dsh-ws-token-cost-table .dsh-ws-token-total-row td.dsh-ws-token-money{font-size:13px}
.dsh-ws-token-override-clear{flex:none;width:22px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-caption);font:inherit;font-size:11px;line-height:1;cursor:pointer}
.dsh-ws-token-override-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Executable-file run console (see run-panel.js / run-store.js): the preview column's lower half
   under the code preview. The body becomes a two-part split, the splitter is draggable and
   keyboard-adjustable, and everything inside the console keeps the app's mono voice. */
.dsh-ws-run-split{display:flex;flex:1;flex-direction:column;min-height:0}
.dsh-ws-run-code{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;overflow:hidden}
.dsh-ws-run-console{display:flex;flex:none;flex-direction:column;min-height:0}
.dsh-ws-run-splitter{flex:none;display:flex;align-items:center;justify-content:center;height:6px;border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);cursor:row-resize}
.dsh-ws-run-splitter::after{content:'';width:46px;height:2px;border-radius:2px;background:var(--dsw-alias-border-l2)}
.dsh-ws-run-splitter:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}
.dsh-ws-run-splitter:hover::after{background:var(--dsw-alias-state-business-primary)}
.dsh-ws-run-splitter:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-ws-run-panel{display:flex;flex:1;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base)}
.dsh-ws-run-bar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;min-height:30px;padding:3px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill);box-sizing:border-box}
.dsh-ws-run-chip{flex:0 1 auto;display:inline-flex;align-items:center;gap:5px;min-width:0;height:18px;padding:0 7px;overflow:hidden;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:18px;white-space:nowrap;text-overflow:ellipsis}
.dsh-ws-run-chip[data-tone=run]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-run-chip[data-tone=ok]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-ws-run-chip[data-tone=err]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-ws-run-chip[data-tone=warn]{background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 16%,transparent);color:var(--dsw-alias-state-warn-label)}
.dsh-ws-run-cmd{display:flex;flex:1 1 150px;align-items:center;min-width:110px;height:22px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base)}
.dsh-ws-run-cmd-prefix{flex:none;max-width:55%;overflow:hidden;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px;line-height:20px;white-space:nowrap;text-overflow:ellipsis}
.dsh-ws-run-args{flex:1;min-width:36px;height:20px;padding:0 0 0 5px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px}
.dsh-ws-run-args:focus{outline:none}
.dsh-ws-run-args::placeholder{color:var(--dsw-alias-label-tertiary)}
/* Six actions cannot fit a narrow preview column on one row with the command line: the group wraps
   to a second row instead of clipping a button (the bar grows, the output area gives up the space). */
.dsh-ws-run-actions{display:flex;flex:0 1 auto;flex-wrap:wrap;align-items:center;gap:2px}
.dsh-ws-run-button{display:inline-flex;align-items:center;justify-content:center;height:22px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1;white-space:nowrap;cursor:pointer}
.dsh-ws-run-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-run-button:disabled{cursor:not-allowed;opacity:.42}
.dsh-ws-run-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-ws-run-button[data-tone=danger]{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-run-button[data-tone=danger]:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-ws-run-button[data-active]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-run-button-run{background:var(--dsw-alias-state-business-primary);color:#fff}
.dsh-ws-run-button-run:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 84%,#fff);color:#fff}
.dsh-ws-run-meta{flex:none;display:flex;align-items:center;gap:14px;height:22px;padding:0 10px;overflow:hidden;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:22px}
.dsh-ws-run-meta>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.dsh-ws-run-notice{flex:none;padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-ws-run-notice[data-error]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-ws-run-output{flex:1;min-height:0;overflow:auto;padding:8px 10px 12px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;line-height:18px;outline:none}
.dsh-ws-run-line{white-space:pre-wrap;word-break:break-word}
.dsh-ws-run-line[data-error]{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-run-tail-error{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-run-exit{margin-top:3px;color:var(--dsw-alias-label-tertiary);font-style:italic}
.dsh-ws-run-exit[data-error]{color:var(--dsw-alias-state-error-primary);font-style:normal}
.dsh-ws-run-omitted{margin-top:3px;color:var(--dsw-alias-label-tertiary);font-style:italic}
.dsh-ws-run-cursor{display:inline-block;width:7px;height:14px;margin-left:2px;vertical-align:-3px;background:var(--dsw-alias-label-secondary);animation:dsh-ws-run-blink 1s step-end infinite}
@keyframes dsh-ws-run-blink{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){.dsh-ws-run-cursor{animation:none}}
.dsh-ws-run-empty{margin:2px 0 8px;padding:10px 12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:12px;line-height:18px}
.dsh-ws-run-empty-cmd{margin-top:5px;color:var(--dsw-alias-state-business-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px;word-break:break-all}
.dsh-ws-run-empty-hint{margin-top:4px}
.dsh-ws-run-unavailable{margin:2px 0 8px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-label) 32%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 8%,transparent);color:var(--dsw-alias-state-warn-label);font-family:inherit;font-size:12px;line-height:18px}
.dsh-ws-run-unavailable b{display:block;margin-bottom:3px}
.dsh-ws-run-unavailable[data-tone=error]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-ws-run-unavailable-actions{display:flex;gap:6px;margin-top:9px}
.dsh-ws-run-unavailable-tried{margin-top:4px;opacity:.8}
.dsh-ws-run-field{margin-top:8px}
.dsh-ws-run-field i{display:block;margin-bottom:3px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-style:normal}
.dsh-ws-run-field>div{padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px;word-break:break-all}
.dsh-ws-run-warning{margin-top:10px;padding:7px 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-label) 28%,transparent);border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 8%,transparent);color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:17px}
.dsh-ws-run-check{display:flex;align-items:center;gap:6px;margin-top:11px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dsh-ws-run-confirm-button{background:var(--dsw-alias-state-business-primary);color:#fff}
.dsh-ws-run-confirm-button:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 84%,#fff);color:#fff}
.dsh-ws-run-dialog{width:min(392px,100%)}
/* Interpreter button in the console's meta row (the old plain text became the only entry point for a
   per-file override). The source tag is what makes 「py -3」 unambiguous; the tone per source tells
   auto-detection from an override at a glance, and a disabled button means "nothing to point at". */
.dsh-ws-run-meta-label{flex:none}
.dsh-ws-run-interp{display:inline-flex;flex:0 1 auto;align-items:center;gap:5px;min-width:0;height:19px;padding:0 5px 0 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:17px;cursor:pointer}
.dsh-ws-run-interp:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary)}
.dsh-ws-run-interp:disabled{cursor:default;opacity:.6}
.dsh-ws-run-interp:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-ws-run-interp[data-source=file]{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-run-interp[data-source=extension]{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 34%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-run-interp[data-source=family]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-label) 34%,transparent);color:var(--dsw-alias-state-warn-label)}
.dsh-ws-run-interp[data-source=unknown]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-label) 50%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 12%,transparent);color:var(--dsw-alias-state-warn-label)}
.dsh-ws-run-interp-name{min-width:0;overflow:hidden;font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:10.5px;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-run-interp-source{flex:none;font-size:10px;opacity:.9}
.dsh-ws-run-interp-caret{flex:none;color:var(--dsw-alias-label-tertiary);font-size:9px;line-height:1}
/* A stored override whose interpreter vanished: said out loud, in the console, with the tier and path
   that failed — falling back silently is what this feature exists to remove. */
.dsh-ws-run-stale{flex:none;display:flex;align-items:flex-start;gap:6px;padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 9%,transparent);color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:16px}
.dsh-ws-run-stale-icon{flex:none}
/* Interpreter dialog (both scopes: this file / one suffix). */
.dsh-ws-interp-dialog{width:min(440px,100%)}
.dsh-ws-interp-inputrow{display:flex;align-items:center;gap:6px}
.dsh-ws-interp-inputrow .dsh-ws-dialog-input{flex:1;min-width:0}
.dsh-ws-interp-inputrow .dsh-ws-dialog-input[data-invalid]{border-color:var(--dsw-alias-state-error-primary)}
.dsh-ws-interp-test{flex:none;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dsh-ws-interp-test:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-interp-test:disabled{cursor:not-allowed;opacity:.5}
.dsh-ws-interp-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-ws-interp-line{padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font-size:11px;line-height:16px;word-break:break-word}
.dsh-ws-interp-line[data-tone=ok]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-ws-interp-line[data-tone=error]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace)}
.dsh-ws-interp-line[data-tone=warn]{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-label) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 8%,transparent);color:var(--dsw-alias-state-warn-label)}
.dsh-ws-interp-spacer{flex:1}
/* Settings page: one row per runnable suffix, showing what it resolves to right now. */
.dsh-ws-interp-table{width:100%;border-collapse:collapse;font-size:12px}
.dsh-ws-interp-table th{padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600;text-align:left}
.dsh-ws-interp-th-ext{width:64px}
.dsh-ws-interp-th-actions{width:150px;text-align:right}
.dsh-ws-interp-table td{padding:3px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle}
.dsh-ws-interp-table tr[data-stale] .dsh-ws-interp-eff-name{color:var(--dsw-alias-state-warn-label)}
.dsh-ws-interp-ext{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px;white-space:nowrap}
.dsh-ws-interp-eff{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-ws-interp-eff-name{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-interp-tag{flex:none;display:inline-flex;align-items:center;height:16px;padding:0 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:10px;white-space:nowrap}
.dsh-ws-interp-tag[data-kind=extension]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-interp-tag[data-kind=family],.dsh-ws-interp-tag[data-kind=stale]{background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 14%,transparent);color:var(--dsw-alias-state-warn-label)}
.dsh-ws-interp-probe{flex:0 1 auto;min-width:0;overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-interp-probe[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}
.dsh-ws-interp-probe[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-interp-actions{text-align:right;white-space:nowrap}
.dsh-ws-interp-actions .dsh-ws-text-button{height:22px;padding:0 6px;font-size:11px}
.dsh-ws-interp-note{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-ws-interp-files{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}
.dsh-ws-interp-file{display:flex;align-items:center;gap:8px;padding:5px 9px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px}
.dsh-ws-interp-file:last-child{border-bottom:0}
.dsh-ws-interp-file[hidden]{display:none}
.dsh-ws-interp-file-name{flex:none;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace)}
.dsh-ws-interp-file-dir{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-interp-file-path{flex:none;max-width:260px;overflow:hidden;color:var(--dsw-alias-state-success-primary);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-interp-file .dsh-ws-text-button{height:22px;padding:0 6px;font-size:11px}
/* Running badge on the preview tab: a process outlives the tab it was started in. */
.dsh-ws-preview-tab-run{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary);animation:dsh-ws-run-pulse 1.4s ease-out infinite}
@keyframes dsh-ws-run-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.dsh-ws-preview-tab-run{animation:none}}
/* ================= Workspace collections (dev-notes §47) =================
   Dropdown replacing the Harness section title, its member dialog, the workspace-row membership
   menu and the sidebar chips. The chips' CONTENT comes from the filter stylesheet; these rules only
   style the box it draws. */
.dsh-ws-sidebar-collections{flex:none;display:flex;align-items:center;min-width:0}
/* The Harness section label steps aside only while this seat exists (it is removed with the seat). */
.dsh-ws-sidebar-collections ~ [class*="sectionLabel"]{display:none}
.dsh-ws-collection-button{flex:none;display:inline-flex;align-items:center;gap:5px;max-width:100%;min-width:0;height:24px;padding:0 5px 0 4px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dsh-ws-collection-button:hover,.dsh-ws-collection-button[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-collection-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.dsh-ws-collection-glyph{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsh-ws-collection-button[aria-expanded=true] .dsh-ws-collection-glyph{color:var(--dsw-alias-state-business-primary)}
.dsh-ws-collection-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-collection-caret{flex:none;font-size:9px;color:var(--dsw-alias-label-tertiary)}
.dsh-ws-collection-menu{position:fixed;z-index:60;width:250px;padding:6px;overflow-y:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}
.dsh-ws-collection-menu-title{padding:4px 10px 6px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;user-select:none}
.dsh-ws-collection-row{display:flex;align-items:center;gap:6px;width:100%;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:28px;text-align:left;cursor:pointer}
.dsh-ws-collection-row:hover,.dsh-ws-collection-row[data-current]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-collection-row[data-dragging]{opacity:.6;box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24))}
.dsh-ws-collection-grip{flex:none;width:10px;color:var(--dsw-alias-label-tertiary);font-size:11px;opacity:0;cursor:grab}
.dsh-ws-collection-row:hover .dsh-ws-collection-grip,.dsh-ws-collection-row[data-dragging] .dsh-ws-collection-grip{opacity:1}
.dsh-ws-collection-check{flex:none;width:12px;color:var(--dsw-alias-state-business-primary);font-size:11px;font-weight:700}
.dsh-ws-collection-rowname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-collection-count{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-ws-collection-dots{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1;opacity:0}
.dsh-ws-collection-row:hover .dsh-ws-collection-dots{opacity:1}
.dsh-ws-collection-dots:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsh-ws-collection-insert{height:2px;margin:2px 6px;border-radius:1px;background:var(--dsw-alias-state-business-primary)}
.dsh-ws-collection-separator{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2)}
.dsh-ws-collection-edit{display:flex;align-items:center;gap:6px;padding:2px 6px}
.dsh-ws-collection-subedit{margin-top:4px}
.dsh-ws-collection-input{flex:1;min-width:0;height:26px;padding:0 7px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none;box-sizing:border-box}
.dsh-ws-collection-input[data-invalid]{border-color:var(--dsw-alias-state-error-primary)}
.dsh-ws-collection-error{padding:2px 10px 4px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}
.dsh-ws-collection-hint{padding:4px 10px 2px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.dsh-ws-collection-rowmenu{margin:2px 0 2px 18px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dsh-ws-collection-rowitem{display:block;width:100%;height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.dsh-ws-collection-rowitem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-collection-rowitem:disabled{cursor:not-allowed;opacity:.5}
.dsh-ws-collection-rowitem-danger{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-collection-submenu{position:absolute;left:calc(100% - 6px);top:30px;min-width:170px}
.dsh-ws-collection-submark{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:10px}
.dsh-ws-collection-dialog{width:min(420px,100%)}
.dsh-ws-collection-members{display:flex;flex-direction:column;gap:2px;max-height:240px;padding:2px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.dsh-ws-collection-member{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer}
.dsh-ws-collection-member:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-collection-member input{flex:none;width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
.dsh-ws-collection-membertext{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-ws-collection-membername{color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-collection-memberpath{color:var(--dsw-alias-label-caption);font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:11px;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-collection-membercount{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-ws-collection-ok{border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dsh-ws-collection-ok:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent)}
.dsh-ws-collection-ok:disabled{cursor:not-allowed;opacity:.55}
.dsh-ws-collection-cancel{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dsh-ws-collection-new{display:flex;align-items:center;gap:6px;width:100%;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dsh-ws-collection-new:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-collection-new:disabled{cursor:not-allowed;opacity:.5}
.dsh-ws-collection-new:disabled:hover{background:transparent}
/* Per-workspace chips on the Harness group rows (content comes from the filter stylesheet). */
[data-slot="sidebar.workspaces"] [data-row-key^="workspace:"]::after{flex:none;align-self:center;margin-left:6px;padding:0 5px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px;white-space:nowrap;pointer-events:none}
/* The permanent per-row collection control: a real node injected as a direct child of the group row
   (the Harness's own .rowActions is display:none until hover, so it cannot host a permanent button).
   Always visible by request; dimmed when the workspace is in no collection, accented when it is. */
[data-slot="sidebar.workspaces"] .dsh-ws-collection-rowicon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:20px;margin-left:4px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:1;cursor:pointer;opacity:.5}
[data-slot="sidebar.workspaces"] .dsh-ws-collection-rowicon[data-owned="true"]{color:var(--dsw-alias-state-business-primary);opacity:1}
[data-slot="sidebar.workspaces"] .dsh-ws-collection-rowicon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);opacity:1}
[data-slot="sidebar.workspaces"] .dsh-ws-collection-rowicon:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;opacity:1}
.dsh-ws-frame[data-sidebar-collapsed] .dsh-ws-collection-rowicon{display:none}
/* The empty-view message: the filter stylesheet sets only its content property, so this box only ever
   appears in a view that filtered everything away (an unset content generates no pseudo-element). */
[data-slot="sidebar.workspaces"]::after{display:block;padding:10px 10px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;pointer-events:none}
.dsh-ws-frame[data-sidebar-collapsed] [data-slot="sidebar.workspaces"]::after{display:none}
`
