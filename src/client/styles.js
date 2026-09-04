export const styles = `
.dsh-ws-viewport{position:relative;height:100%;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsh-ws-frame{--dsh-ws-sidebar:280px;--dsh-ws-preview:420px;position:relative;display:grid;grid-template-columns:var(--dsh-ws-sidebar) var(--dsh-ws-preview) minmax(0,1fr);grid-template-rows:100%;width:100%;min-width:0;height:100%;overflow:hidden;background:var(--dsw-alias-bg-base);transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out)}
.dsh-ws-frame[data-resizing]{transition:none;user-select:none}.dsh-ws-sidebar,.dsh-ws-tree,.dsh-ws-preview,.dsh-ws-chat{min-width:0;height:100%;overflow:hidden}.dsh-ws-sidebar{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1)}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right]{grid-template-columns:var(--dsh-ws-sidebar) minmax(0,1fr) var(--dsh-ws-preview)}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right] .dsh-ws-sidebar{grid-column:1;grid-row:1}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right] .dsh-ws-chat{grid-column:2;grid-row:1}html:not(.dsh-ws-mobile-on) .dsh-ws-frame[data-preview-right] .dsh-ws-preview{grid-column:3;grid-row:1;border-right:0;border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-ws-tree,.dsh-ws-preview{display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l2)}.dsh-ws-frame[data-explorer-closed] .dsh-ws-tree,.dsh-ws-frame[data-explorer-closed] .dsh-ws-preview{visibility:hidden;pointer-events:none;border-right:0}.dsh-ws-chat{display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-base)}
.dsh-ws-panel-header{display:flex;align-items:center;gap:8px;min-height:52px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}.dsh-ws-panel-title{min-width:0;display:flex;flex:1;flex-direction:column;gap:2px}.dsh-ws-panel-title strong{overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-panel-title>span{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}
/* Preview page top rows (file tabs + active-file name) share the sidebar fill
   so the file browsing page reads as one band with the sidebar. */
.dsh-ws-preview .dsh-ws-panel-header{background:var(--dsw-specific-sidebar-fill)}.dsh-ws-preview .dsh-ws-preview-file-header{min-height:26px;gap:4px;padding:0 8px}.dsh-ws-preview-file-path{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-preview-file-header .dsh-ws-icon-button{width:22px;height:22px}.dsh-ws-preview-file-header .dsh-ws-icon-button svg{width:14px;height:14px}.dsh-ws-preview-file-header .dsh-ws-text-button{height:22px;padding:0 6px;font-size:11px}
.dsh-ws-panel-actions{display:flex;flex:none;align-items:center;gap:2px}.dsh-ws-icon-button,.dsh-ws-text-button{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}.dsh-ws-icon-button{width:30px;padding:0;font-size:18px}.dsh-ws-icon-button svg{display:block;width:16px;height:16px}.dsh-ws-icon-button:hover,.dsh-ws-text-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-icon-button:disabled,.dsh-ws-text-button:disabled{cursor:not-allowed;opacity:.55}
.dsh-ws-icon-button:focus-visible,.dsh-ws-text-button:focus-visible,.dsh-ws-tree-row:focus-visible,.dsh-ws-preview-tab-button:focus-visible,.dsh-ws-preview-tab-close:focus-visible,.dsh-ws-splitter:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-ws-tree-scroll{flex:1;min-height:0;overflow:auto;padding:8px 6px 16px}.dsh-ws-tree-row{display:flex;align-items:center;gap:5px;width:100%;height:var(--dsh-ws-row-height,28px);padding:0 7px 0 calc(7px + var(--dsh-ws-depth,0) * 15px);border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;box-sizing:border-box}.dsh-ws-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-tree-row[data-selected]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}.dsh-ws-tree-row:disabled{cursor:not-allowed;opacity:.55}.dsh-ws-tree-row[data-cut]{opacity:.55}
.dsh-ws-chevron{display:inline-flex;align-items:center;justify-content:center;flex:0 0 12px;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-ws-file-mark{display:inline-flex;align-items:center;justify-content:center;flex:0 0 16px;width:16px;height:16px;border-radius:4px;background:color-mix(in srgb,var(--dsh-ws-file-accent,var(--dsw-alias-label-tertiary)) 16%,transparent);color:var(--dsh-ws-file-accent,var(--dsw-alias-label-tertiary));font-size:8px;font-weight:600;text-transform:uppercase}.dsh-ws-file-mark[data-group='directory']{--dsh-ws-file-accent:var(--dsh-ws-file-directory,#3b82f6)}.dsh-ws-file-mark[data-group='typescript']{--dsh-ws-file-accent:var(--dsh-ws-file-typescript,#3178c6)}.dsh-ws-file-mark[data-group='javascript']{--dsh-ws-file-accent:var(--dsh-ws-file-javascript,#e5c158)}.dsh-ws-file-mark[data-group='json']{--dsh-ws-file-accent:var(--dsh-ws-file-json,#e07a3c)}.dsh-ws-file-mark[data-group='markup']{--dsh-ws-file-accent:var(--dsh-ws-file-markup,#e04a3c)}.dsh-ws-file-mark[data-group='style']{--dsh-ws-file-accent:var(--dsh-ws-file-style,#a855f7)}.dsh-ws-file-mark[data-group='markdown']{--dsh-ws-file-accent:var(--dsh-ws-file-markdown,#12a5a0)}.dsh-ws-file-mark[data-group='log']{--dsh-ws-file-accent:var(--dsh-ws-file-log,#d99a2b)}.dsh-ws-file-mark[data-group='python']{--dsh-ws-file-accent:var(--dsh-ws-file-python,#4b8bb8)}.dsh-ws-file-mark[data-group='shell']{--dsh-ws-file-accent:var(--dsh-ws-file-shell,#22a06b)}.dsh-ws-file-mark[data-group='config']{--dsh-ws-file-accent:var(--dsh-ws-file-config,#8a95a5)}.dsh-ws-file-mark[data-group='c-family']{--dsh-ws-file-accent:var(--dsh-ws-file-c-family,#5a7ba6)}.dsh-ws-file-mark[data-group='csharp']{--dsh-ws-file-accent:var(--dsh-ws-file-csharp,#a25fd0)}.dsh-ws-file-mark[data-group='other']{--dsh-ws-file-accent:var(--dsh-ws-file-other,#9aa3ad)}.dsh-ws-file-mark[data-group='blocked']{--dsh-ws-file-accent:var(--dsh-ws-file-blocked,#e5484d)}.dsh-ws-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-symlink{margin-left:auto;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-ws-tree-status{padding:8px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dsh-ws-tree-status[data-error]{color:var(--dsw-alias-state-error-primary)}.dsh-ws-empty{display:flex;flex:1;min-height:0;align-items:center;justify-content:center;padding:24px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;text-align:center}
.dsh-ws-preview-header-meta{display:flex;align-items:center;gap:6px;min-width:0}.dsh-ws-preview-header-meta>span:not(.dsh-ws-language):not(.dsh-ws-encoding){overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-language{flex:0 0 auto;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px;text-transform:uppercase}.dsh-ws-encoding{flex:0 0 auto;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-markdown-tag);color:var(--dsw-alias-label-secondary);font-size:9px;font-weight:600;line-height:14px;text-transform:uppercase}.dsh-ws-dirty{color:var(--dsw-alias-state-warn-label);font-size:12px}.dsh-ws-preview-tabs{display:flex;align-items:stretch;gap:0;min-width:0;height:29px;padding:0;box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill);overflow-x:auto;overflow-y:hidden}.dsh-ws-preview-tab{flex:none;display:flex;align-items:center;gap:5px;min-width:0;max-width:220px;padding:0 5px 0 9px;border-radius:0;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:grab;box-sizing:border-box;white-space:nowrap}.dsh-ws-preview-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-preview-tab[data-active]{border-bottom:2px solid var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,transparent);color:var(--dsw-alias-state-business-primary)}.dsh-ws-preview-tab[data-dragging]{opacity:.7}.dsh-ws-preview-tab-mindmap{flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;color:var(--dsw-alias-state-business-primary)}.dsh-ws-preview-tab-mindmap svg{width:12px;height:12px}.dsh-ws-preview-tabs::-webkit-scrollbar{height:0;background:transparent}@supports not selector(::-webkit-scrollbar){.dsh-ws-preview-tabs{scrollbar-width:none}}.dsh-ws-preview-scrollbar{position:absolute;top:29px;left:0;right:0;height:4px;border-radius:2px;opacity:0;pointer-events:none;transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);touch-action:none;z-index:3}.dsh-ws-preview-scrollbar[data-visible='true']{opacity:1;pointer-events:auto}.dsh-ws-preview-scrollbar-thumb{height:100%;min-width:24px;border-radius:2px;background:var(--dsw-alias-scrollbar-bg-l1)}.dsh-ws-preview-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l1)}.dsh-ws-preview-drop-indicator{flex:none;width:3px;height:20px;border-radius:2px;background:var(--dsw-alias-state-business-primary);align-self:center;pointer-events:none}.dsh-ws-preview-tab-button{display:flex;flex:1;align-items:center;gap:5px;min-width:0;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.dsh-ws-preview-tab-name{min-width:0;overflow:hidden;text-overflow:ellipsis}.dsh-ws-preview-tab-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:2px;background:transparent;color:inherit;font-size:14px;line-height:1;cursor:pointer}.dsh-ws-preview-tab-close svg{display:block;flex:none;width:16px;height:16px}.dsh-ws-preview-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.dsh-ws-preview-tab-close:disabled{cursor:not-allowed;opacity:.45}.dsh-ws-preview-body{position:relative;flex:1;min-height:0;overflow:hidden;background:var(--dsw-alias-markdown-code-block)}.dsh-ws-editor-host{height:100%;min-width:0}.dsh-ws-editor-host .cm-editor{height:100%;background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary)}.dsh-ws-editor-host .cm-scroller{font-family:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;line-height:19px;overflow:auto}.dsh-ws-editor-host .cm-gutters{background:var(--dsw-alias-markdown-code-block-banner);color:var(--dsw-alias-label-caption);border-right:1px solid var(--dsw-alias-border-l2)}.dsh-ws-editor-host .cm-activeLine,.dsh-ws-editor-host .cm-activeLineGutter{background:var(--dsw-alias-interactive-bg-hover)}.dsh-ws-editor-host .cm-selectionBackground,.dsh-ws-editor-host .cm-content ::selection{background:var(--dsw-alias-interactive-bg-active)!important}.dsh-ws-editor-host .cm-cursor{border-left-color:var(--dsw-alias-label-primary)}.dsh-ws-editor-host .cm-foldPlaceholder{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}.dsh-ws-editor-host .cm-panels{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.dsh-ws-editor-host .cm-panel input{background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dsh-ws-context-row{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:none;width:min(var(--dsh-composer-card-max-width),max(0px,calc(100% - (var(--dsh-composer-side-clearance) * 2))));margin:0 auto;padding:0}.dsh-ws-context-prefix{display:flex;flex:1;align-items:center;gap:6px;min-width:0;min-height:28px;padding:5px 8px 5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:22px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;text-align:left;cursor:pointer}.dsh-ws-context-prefix:hover{color:var(--dsw-alias-label-primary)}.dsh-ws-context-prefix:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.dsh-ws-context-prefix[data-inactive]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);filter:grayscale(1)}.dsh-ws-context-prefix-mark{flex:none;font-size:12px}.dsh-ws-context-prefix-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-message-context-summary{box-sizing:border-box;display:flex;align-items:center;align-self:flex-end;gap:6px;max-width:100%;min-height:24px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:22px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}.dsh-ws-message-context-summary-mark{flex:none;font-size:12px}.dsh-ws-message-context-summary-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-message-context-summary-range{flex:none;color:var(--dsw-alias-label-caption)}.dsh-ws-message-context-bubble[data-dsh-ws-empty-prompt]{display:none}
.dsh-ws-banner{padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:16px}.dsh-ws-banner-actions{display:flex;gap:6px;margin-top:5px}.dsh-ws-status{flex:none;display:flex;align-items:center;gap:8px;min-width:0;box-sizing:border-box;width:100%;padding:3px 12px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-ws-preview-status-actions{flex:none;display:flex;align-items:center;gap:2px;min-width:0}.dsh-ws-preview-status-actions .dsh-ws-text-button{height:22px;padding:0 6px;font-size:11px}.dsh-ws-preview-status-meta{flex:none;display:flex;align-items:center;gap:6px;min-width:0}.dsh-ws-preview-status-meta>span:not(.dsh-ws-language):not(.dsh-ws-encoding){overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-preview-status-msg{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-align:right;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-preview-status-msg[data-error]{color:var(--dsw-alias-state-error-primary)}.dsh-ws-error-card{max-width:300px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:19px;text-align:left}.dsh-ws-dialog-backdrop{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.38));box-sizing:border-box}.dsh-ws-dialog{width:min(360px,100%);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}.dsh-ws-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-ws-dialog-title{min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-dialog-body{display:flex;flex-direction:column;gap:8px;padding:14px}.dsh-ws-dialog-input{width:100%;height:32px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;box-sizing:border-box}.dsh-ws-dialog-input:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.dsh-ws-dialog-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.dsh-ws-dialog-message{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}.dsh-ws-dialog-warning{color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}.dsh-ws-danger-button{color:var(--dsw-alias-state-error-primary)}.dsh-ws-dialog-footer{display:flex;justify-content:flex-end;gap:8px;padding:0 14px 14px}.dsh-ws-conflict-region{display:flex;flex-direction:column;gap:8px;min-height:0}.dsh-ws-conflict-region-title{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-state-warn-label);font-size:12px;line-height:18px}.dsh-ws-conflict-cols{display:grid;grid-template-columns:1fr 1fr;gap:8px;min-height:0;flex:1}.dsh-ws-conflict-cols-final{border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}.dsh-ws-conflict-col{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:6px}.dsh-ws-conflict-col-label{padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-ws-conflict-mine .dsh-ws-conflict-col-label{color:var(--dsw-alias-state-warn-label)}.dsh-ws-conflict-theirs .dsh-ws-conflict-col-label{color:var(--dsw-alias-state-business-primary)}.dsh-ws-conflict-code{margin:0;min-height:0;flex:1;overflow:auto;padding:10px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:var(--dsh-ws-conflict-font-size,12px);line-height:20px;white-space:pre;box-sizing:border-box}.dsh-ws-inline-add{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-ws-inline-del{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;text-decoration-thickness:1.5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-radius:3px;opacity:.9;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-ws-conflict-code-row{display:inline;border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone}.dsh-ws-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 16%,transparent)}.dsh-ws-conflict-mine .dsh-ws-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 20%,transparent);color:var(--dsw-alias-state-warn-label)}.dsh-ws-conflict-theirs .dsh-ws-conflict-code-row[data-kind='add']{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent);color:var(--dsw-alias-state-business-primary)}.dsh-ws-conflict-code-row[data-kind='del']{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;text-decoration-thickness:1.5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);opacity:.85}.dsh-ws-conflict-dialog{width:66vw;max-width:66vw;max-height:min(90vh,1000px);display:flex;flex-direction:column}.dsh-ws-conflict-dialog .dsh-ws-dialog-body{flex:1;min-height:0;overflow:auto}.dsh-ws-conflict-progress{margin-left:8px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:18px;white-space:nowrap}
.dsh-ws-frame [data-slot='sidebar.footer.action']{display:flex!important;flex-direction:column;align-items:stretch;width:100%;min-width:0}
.dsh-ws-splitter{position:absolute;top:0;bottom:0;z-index:8;width:8px;margin-left:-4px;border:0;background:transparent;cursor:col-resize;touch-action:none}.dsh-ws-splitter::after{content:'';position:absolute;top:0;bottom:0;left:3px;width:2px;background:transparent;transition:background var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dsh-ws-splitter:hover::after,.dsh-ws-splitter[data-dragging]::after,.dsh-ws-splitter:focus-visible::after{background:var(--dsw-alias-state-business-primary)}.dsh-ws-details{position:absolute;z-index:16;top:0;right:0;bottom:0;width:min(440px,45vw);overflow:hidden;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px var(--dsw-alias-bg-mask-1));transform:translateX(0);opacity:1;transition:transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out)}.dsh-ws-details[data-closed]{pointer-events:none;visibility:hidden;transform:translateX(100%);opacity:0}.dsh-ws-overlay{position:absolute;inset:0;z-index:20;pointer-events:none}.dsh-ws-overlay>*{pointer-events:auto}.dsh-ws-tree{position:relative}.dsh-ws-context-menu{position:fixed;z-index:40;min-width:168px;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 12px 36px rgba(0,0,0,.24));box-sizing:border-box}.dsh-ws-context-menu-wide{min-width:220px;max-width:280px;max-height:min(420px,70vh);overflow-y:auto}.dsh-ws-context-label{padding:4px 10px 6px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;user-select:none}.dsh-ws-context-item-check{display:flex;align-items:center;gap:8px}.dsh-ws-context-item-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ws-context-item-check-mark{flex:none;color:var(--dsw-alias-state-business-primary);font-weight:700}.dsh-ws-context-item.dsh-ws-context-item-check{color:var(--dsw-alias-state-business-primary)}.dsh-ws-context-item{display:block;width:100%;height:30px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:30px;text-align:left;cursor:pointer;box-sizing:border-box}.dsh-ws-context-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-context-item-danger{color:var(--dsw-alias-state-error-primary)}.dsh-ws-context-item-danger:hover{color:var(--dsw-alias-state-error-primary)}.dsh-ws-context-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}.dsh-ws-context-item:disabled{cursor:not-allowed;opacity:.5}.dsh-ws-context-item:disabled:hover{background:transparent;color:var(--dsw-alias-label-primary)}.dsh-ws-context-separator{height:1px;margin:4px 0;border:0;background:var(--dsw-alias-border-l2)}.dsh-ws-copy-notice{position:absolute;right:10px;bottom:10px;z-index:12;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:11px;line-height:16px;box-shadow:var(--dsw-shadow-elevated,0 4px 12px rgba(0,0,0,.18))}@media(prefers-reduced-motion:reduce){.dsh-ws-frame,.dsh-ws-details,.dsh-ws-splitter::after{transition:none}}
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
.dsh-ws-settings-row{display:flex;align-items:center;gap:10px}.dsh-ws-settings-label{flex:none;min-width:64px;color:var(--dsw-alias-label-primary);font-size:13px}.dsh-ws-settings-slider{flex:1;min-width:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}.dsh-ws-settings-checkbox{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}.dsh-ws-settings-select{flex:1;min-width:0;max-width:320px;height:28px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}.dsh-ws-settings-select:disabled{opacity:.55;cursor:not-allowed}.dsh-ws-settings-value{flex:none;min-width:48px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:right;font-variant-numeric:tabular-nums}.dsh-ws-settings-hint{padding:0 14px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.dsh-ws-explorer-settings{display:flex;flex-direction:column;gap:12px;width:100%;max-width:560px}.dsh-ws-explorer-settings .dsh-ws-settings-label{min-width:88px}.dsh-ws-explorer-settings .dsh-ws-settings-slider{max-width:320px}.dsh-ws-explorer-settings .dsh-ws-settings-hint{padding:0}.dsh-ws-settings-group{display:flex;flex-direction:column;gap:10px}.dsh-ws-settings-group-title{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:22px}.dsh-ws-settings-group-title::before{content:'';flex:none;width:3px;height:14px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}.dsh-ws-explorer-divider{height:1px;margin:0;border:0;background:var(--dsw-alias-border-l2)}.dsh-ws-file-colors{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 14px}.dsh-ws-file-colors-title{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary)}.dsh-ws-file-color-row{display:flex;align-items:center;gap:10px;min-height:26px}.dsh-ws-file-color-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dsh-ws-file-color-input{flex:none;width:32px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:transparent;cursor:pointer;box-sizing:border-box}.dsh-ws-file-color-input::-webkit-color-swatch-wrapper{padding:2px}.dsh-ws-file-color-input::-webkit-color-swatch{border:0;border-radius:2px}.dsh-ws-file-color-reset{flex:none;height:24px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:24px;cursor:pointer}.dsh-ws-file-color-reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dsh-ws-file-color-reset:disabled{cursor:not-allowed;opacity:.55}.dsh-ws-file-colors-actions{display:flex;align-items:center;justify-content:flex-start;gap:8px;padding-top:2px}
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
/* VS Code default theme (Light+/Dark+) XML palette: tag names ride the
   function token, attribute names the parameter token, values/entities the
   string token; two extra vars cover angle brackets and entity characters. */
.dsh-ws-editor-host[data-highlight-preset='vscode-xml']{--shiki-token-comment:#008000;--shiki-token-function:#800000;--shiki-token-parameter:#e50000;--shiki-token-string:#a31515;--shiki-token-string-expression:#0000ff;--dsh-ws-token-xml-punctuation:#800000;--dsh-ws-token-xml-entity:#0000ff}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-xml']{--shiki-token-comment:#6A9955;--shiki-token-function:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-string:#ce9178;--shiki-token-string-expression:#569cd6;--dsh-ws-token-xml-punctuation:#808080;--dsh-ws-token-xml-entity:#569cd6}
/* VS Code default theme (Light+/Dark+) shared token palette: one rule serves
   every non-XML vscode-* preset. */
.dsh-ws-editor-host[data-highlight-preset='vscode-python'],.dsh-ws-editor-host[data-highlight-preset='vscode-json'],.dsh-ws-editor-host[data-highlight-preset='vscode-typescript'],.dsh-ws-editor-host[data-highlight-preset='vscode-javascript'],.dsh-ws-editor-host[data-highlight-preset='vscode-css'],.dsh-ws-editor-host[data-highlight-preset='vscode-markdown'],.dsh-ws-editor-host[data-highlight-preset='vscode-shell'],.dsh-ws-editor-host[data-highlight-preset='vscode-config'],.dsh-ws-editor-host[data-highlight-preset='vscode-cpp'],.dsh-ws-editor-host[data-highlight-preset='vscode-csharp']{--shiki-token-constant:#098658;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#001080;--shiki-token-function:#795e26;--shiki-token-string-expression:#795e26;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff;--shiki-token-module:#267f99}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-python'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-json'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-typescript'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-javascript'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-css'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-markdown'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-shell'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-config'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-cpp'],body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vscode-csharp']{--shiki-token-constant:#b5cea8;--shiki-token-string:#ce9178;--shiki-token-comment:#6a9955;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#9cdcfe;--shiki-token-function:#dcdcaa;--shiki-token-string-expression:#dcdcaa;--shiki-token-punctuation:#d4d4d4;--shiki-token-link:#569cd6;--shiki-token-module:#4ec9b0}
.dsh-ws-editor-host[data-highlight-preset='vs2022']{--shiki-token-constant:#098658;--shiki-token-string:#a31515;--shiki-token-comment:#008000;--shiki-token-keyword:#0000ff;--shiki-token-parameter:#000000;--shiki-token-function:#2b91af;--shiki-token-string-expression:#a31515;--shiki-token-punctuation:#000000;--shiki-token-link:#0000ff;--shiki-token-module:#267f99}
body[data-ds-dark-theme] .dsh-ws-editor-host[data-highlight-preset='vs2022']{--shiki-token-constant:#b5cea8;--shiki-token-string:#d69d85;--shiki-token-comment:#57a64a;--shiki-token-keyword:#569cd6;--shiki-token-parameter:#dcdcdc;--shiki-token-function:#4ec9b0;--shiki-token-string-expression:#d69d85;--shiki-token-punctuation:#b4b4b4;--shiki-token-link:#569cd6;--shiki-token-module:#4ec9b0}
/* Python import-module names (dsh-ws-token-module decoration): per-preset
   --shiki-token-module, falling back to the function color. The 3-class
   selector outranks any single-class HighlightStyle rule on the same span. */
.dsh-ws-editor-host .cm-line .dsh-ws-token-module{color:var(--shiki-token-module,var(--shiki-token-function))}
/* Preprocessor directive color (C# #if/#region, ...): purple, lighter in dark
   for contrast; overridable per preset. */
.dsh-ws-editor-host{--dsh-ws-token-directive:#8e44ad}
body[data-ds-dark-theme] .dsh-ws-editor-host{--dsh-ws-token-directive:#c586c0}
/* Sidebar top actions: hide the harness New Session button (the root div's
   only direct button); the plugin draws its own two-button row — New Session /
   workspace files — in the same flow position. */
.dsh-ws-frame [data-slot="sidebar"] > div > button{display:none}
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
/* Collapsed rail: hide the harness workspace browser's rail controls (search
   + add); the plugin's two nav tabs are the only region icons. */
.dsh-ws-frame[data-sidebar-collapsed] [data-slot="sidebar.workspaces"] > *{display:none}
/* Files region: the harness workspace browser is hidden while the plugin's
   file tree fills the region seat (fused into the sidebar). */
.dsh-ws-sidebar-files{display:none}
.dsh-ws-frame[data-sidebar-files] [data-slot="sidebar.workspaces"] > :not(.dsh-ws-sidebar-files){display:none}
/* The sidebar shell hides nested scrollbars until hover (quietBars); the file
   list is scroll-heavy, so its scrollbar stays visible. The files panel is
   inset 12px both sides so it reads as a symmetric card. */
.dsh-ws-frame[data-sidebar-files] .dsh-ws-sidebar-files{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;margin-right:12px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dsh-ws-frame[data-sidebar-files] .dsh-ws-sidebar-files .dsh-ws-tree{flex:1;min-height:0;height:auto;border-right:0}
/* CodeMirror search panel (Ctrl+F) renders into .dsh-ws-preview-search
   (between the status bar and the preview body), so the panel rules stay
   scoped to that container; !important keeps the controls legible under the
   harness's global control styles. Match marks live in the editor content,
   so they stay scoped to the editor host. */
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
/* The search field is wrapped (see CodeEditor) with a col-resize grip on its
   right edge so the user can drag it wider/narrower. */
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
/* Hide the harness's full-viewport chat drop mask (DropOverlay: a
   body-portaled role="status" whose wrap contains the upload illustration
   svg); the layout draws its own chat-confined mask so it covers the chat
   pane instead of the whole page. Scoped with :has(svg) so a future
   body-level role="status" toast or live region is NOT hidden. */
body > [role="status"]:has(svg){display:none!important}
.dsh-ws-chat-drop-mask{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-drop,rgba(0,0,0,.32));backdrop-filter:blur(6px);pointer-events:none}
.dsh-ws-chat-drop-card{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px dashed var(--dsw-alias-state-business-primary);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;box-shadow:var(--dsw-shadow-elevated,0 10px 28px rgba(0,0,0,.2))}
.dsh-ws-chat-drop-close{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box;pointer-events:auto}
.dsh-ws-chat-drop-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Close button on the preview drop hint, matching the chat drop mask. */
.dsh-ws-drop-close{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0 0 2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:16px;line-height:1;cursor:pointer;box-sizing:border-box;pointer-events:auto}
.dsh-ws-drop-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* Transient toast matching the harness conversation Toast look (contrast fill,
   slide-in, hold-and-fade) for failed external-file opens; positioned inside
   the preview pane so the notice stays panel-scoped. */
.dsh-ws-toast{position:absolute;top:12px;left:50%;z-index:60;pointer-events:none;display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100% - 48px));padding:12px 16px;border-radius:14px;background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);font-size:14px;line-height:22px;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,.28));transform:translateX(-50%);animation:dsh-ws-toast-in 160ms ease-out,dsh-ws-toast-fade 1000ms ease 3000ms forwards}
.dsh-ws-toast-icon{display:grid;place-items:center;flex:none;color:var(--dsw-alias-state-warn-label)}
.dsh-ws-toast-text{min-width:0}
@keyframes dsh-ws-toast-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes dsh-ws-toast-fade{to{opacity:0}}
@media (prefers-reduced-motion: reduce){.dsh-ws-toast{animation:dsh-ws-toast-fade 1000ms ease 3000ms forwards}}
/* ── Session switcher (header title → quick-switch dropdown) ────────────
   The conversation header's current-title crumb (the last crumb segment) is
   hidden so the switcher trigger — rendered in
   conversation.session.header.actions at order -400 — becomes the visible
   session title; subagent parent breadcrumbs stay (only the self crumb is
   hidden). When the crumb is the nav's ONLY segment, the whole nav is hidden
   too: a display:none crumb still occupies its flex slot, so the
   titleCluster's 10px gap would otherwise leave a phantom gap before the
   switcher trigger. The panel is portalled to body with fixed positioning,
   so the chat column's overflow never clips it. */
/* KNOWN FRAGILITY: these four-plus-level structural selectors couple to the
   harness conversation-header DOM. A harness header restructure silently
   breaks them (the crumb reappears and overlaps the switcher trigger) — the
   harness owns that DOM, so there is no stable data attribute to anchor on.
   Re-check on every harness upgrade. */
[data-slot="conversation.session.header"] > header > div:first-child > div:first-child > nav > span:last-child{display:none}
[data-slot="conversation.session.header"] > header > div:first-child > div:first-child > nav:has(> span:last-child:only-child){display:none}
.dsh-ws-session-switcher{display:inline-flex;align-items:center;min-width:0;flex:0 0 auto}
.dsh-ws-session-switcher-trigger{display:inline-flex;align-items:center;gap:4px;max-width:min(320px,60vw);min-width:0;padding:2px 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;font-weight:500;line-height:22px;cursor:pointer;box-sizing:border-box}
.dsh-ws-session-switcher-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-session-switcher-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-ws-session-switcher-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-session-switcher .dsh-ws-chevron{flex:none;font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary)}
.dsh-ws-session-switcher-panel{position:fixed;z-index:60;max-height:min(60vh,420px);overflow-y:auto;padding:4px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-elevated,0 10px 28px rgba(0,0,0,.2))}
.dsh-ws-session-switcher-row{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;box-sizing:border-box;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.dsh-ws-session-switcher-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-ws-session-switcher-row.dsh-ws-session-switcher-current{color:var(--dsw-alias-brand-primary);font-weight:600}
.dsh-ws-session-switcher-row-main{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-session-switcher-badge{flex:none;margin-left:4px;padding:0 5px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;font-weight:400}
.dsh-ws-session-switcher-row-ws{flex:none;max-width:40%;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption);font-size:12px;line-height:20px}
.dsh-ws-session-switcher-empty{padding:8px 10px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
/* ── Mobile (phone-column) mode ─────────────────────────────────────────
   Mirror of dsh-mobile-preview: the document-class gate (dsh-ws-mobile-on)
   drives every override; the floating sidebar drawer and the file-fullscreen
   view ride sibling classes. Desktop layout is untouched when the gate is
   absent. In-flow frame order is aside(1) preview(2) chat(3); the aside
   becomes an absolute drawer, so explicit grid-column keeps each section in
   the phone track. */
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
/* File browsing fills the phone column below the pinned conversation header
   (height measured into --dsh-ws-mobile-header-h); the chat's scroll area
   (messages + composer) is hidden so only the header stays reachable. */
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-frame{grid-template-columns:0 minmax(0,430px) 0!important}
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-preview{display:flex;grid-column:2;visibility:visible;pointer-events:auto;box-sizing:border-box;padding-top:var(--dsh-ws-mobile-header-h,52px)}
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-chat{position:fixed;top:0;left:50%;width:min(430px,100%);margin-left:calc(min(430px,100%) / -2);z-index:3;height:var(--dsh-ws-mobile-header-h,52px);overflow:hidden}
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on .dsh-ws-chat [data-slot="conversation"] [data-conversation-scroll]{display:none}
/* In file-fullscreen the conversation's view tabs (chat/trajectory) are pinned
   with the title row; they belong to the chat, not the file page, so hiding
   them lets the file content start flush under the title row (which is also
   what --dsh-ws-mobile-header-h measures after this rule applies). */
html.dsh-ws-mobile-on.dsh-ws-mobile-files-on [data-slot="conversation.session.header"] > header > div[role="tablist"]{display:none}
/* Session-header controls: hidden outside mobile, inline at the phone column's
   top-left in mobile (whale first, file button right after it). */
.dsh-ws-mobile-controls{display:none;align-items:center;gap:2px}
html.dsh-ws-mobile-on .dsh-ws-mobile-controls{display:flex;order:-1}
.dsh-ws-mobile-whale,.dsh-ws-mobile-files{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-ws-mobile-whale:hover,.dsh-ws-mobile-files:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-ws-mobile-active{color:var(--dsw-alias-brand-primary)}
.dsh-ws-mobile-files-icon{width:16px;height:16px}
html.dsh-ws-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > div:first-child,html.dsh-ws-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > div:first-child > div:nth-child(2){display:contents}
html.dsh-ws-mobile-on [data-slot="conversation.session.header"] > header > div:first-child > nav{flex:1}
html.dsh-ws-mobile-on [data-slot="conversation.session.header.utilities"]{display:none!important}
/* Hero whale + file button: a frame-level overlay visible only on the
   blank-session hero (the :has gate mirrors ConversationRoot's own hero
   decision). */
.dsh-ws-mobile-hero{display:none;position:absolute;top:10px;left:calc(max(0px,50% - 215px) + 8px)}
html.dsh-ws-mobile-on:has([data-slot="conversation"] [data-phase="hero"]) .dsh-ws-mobile-hero{display:flex;align-items:center;gap:2px}
/* Settings dialog (the harness Settings panel from the sidebar.settings seat):
   in mobile the centered 800px modal becomes a fullscreen phone panel with the
   section nav as a horizontal bottom bar. The drawer keeps a transform even
   when open (translateX(0)), which would make the dialog's position:fixed
   overlay resolve against the 280px drawer instead of the viewport; dropping
   the transform while the dialog is open frees the modal to cover the phone
   column. */
html.dsh-ws-mobile-on .dsh-ws-sidebar:has([data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]){transform:none;transition:none}
html.dsh-ws-mobile-on [data-slot="sidebar.settings"] [role="dialog"][aria-modal="true"]:has(> nav){width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;border-radius:0;flex-direction:column;overflow:hidden}
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
/* Plugin-self-update group state text (settings → 插件更新): tinted by the
   outcome so a restart notice or a failed check cannot be scrolled past.
   The row wraps (flex-wrap) and the state uses flex-basis auto so a long
   notice drops to its own full-width line instead of being squeezed into a
   one-character-per-line column when the settings panel is narrow. */
.dsh-ws-settings-row:has(.dsh-ws-update-state){flex-wrap:wrap}
.dsh-ws-update-state{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;text-align:left;overflow-wrap:anywhere}
.dsh-ws-update-state[data-ok]{color:var(--dsw-alias-state-success-primary)}
.dsh-ws-update-state[data-error]{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-update-state[data-new]{color:var(--dsw-alias-state-business-primary)}
/* Mind-map conversation branching view ("导图") and the sidebar branch-row
   hider (fork children are hidden from the harness session list; branches
   live in the mind map). */
.dsh-ws-mindmap{height:100%;position:relative;box-sizing:border-box;padding:14px 16px;display:flex;flex-direction:column;overflow:hidden}
.dsh-ws-mindmap-toolbar{flex:none;display:flex;align-items:center;gap:8px;margin-bottom:8px}
.dsh-ws-mindmap-toolbar-button{flex:none;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;transition:background .12s ease,border-color .12s ease,color .12s ease}
.dsh-ws-mindmap-toolbar-button:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
/* Danger variant for the "archive entire mind map" button: red border + red
   text (warning), hover gets a faint red fill. Rules sit AFTER the base hover
   rule so the red wins at equal specificity. */
.dsh-ws-mindmap-toolbar-button-danger{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent);color:var(--dsw-alias-state-error-primary)}
.dsh-ws-mindmap-toolbar-button-danger:hover{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
/* Highlighted "new session" action: a light-blue pill echoing the virtual
   root node's style — blue circular plus badge (same symmetric SVG path),
   blue-tinted gradient fill, blue border and a soft glow. Hover lifts the
   button 1px, scales the badge and rotates the plus 90°, mirroring the root
   node's hover animation. */
.dsh-ws-mindmap-toolbar-button-new{flex:none;display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 6px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);border-radius:999px;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,var(--dsw-alias-bg-layer-1)),color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,var(--dsw-alias-bg-layer-1)));color:var(--dsw-alias-state-business-primary);font:inherit;font-size:11px;line-height:16px;cursor:pointer;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);transition:transform .12s ease,box-shadow .12s ease;white-space:nowrap}
.dsh-ws-mindmap-toolbar-button-new:hover{transform:translateY(-1px);box-shadow:0 0 0 5px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.dsh-ws-mindmap-toolbar-button-new-plus{flex:none;width:15px;height:15px;border-radius:50%;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);display:flex;align-items:center;justify-content:center;transition:transform .15s ease}
.dsh-ws-mindmap-toolbar-button-new-plus svg{display:block;width:9px;height:9px;transition:transform .15s ease}
.dsh-ws-mindmap-toolbar-button-new:hover .dsh-ws-mindmap-toolbar-button-new-plus{transform:scale(1.08)}
.dsh-ws-mindmap-toolbar-button-new:hover .dsh-ws-mindmap-toolbar-button-new-plus svg{transform:rotate(90deg)}
/* Badge-family icons (approved scheme D): every toolbar button carries a
   small circular icon badge echoing the new-session plus badge — neutral
   gray at rest, turning solid blue on hover; the danger (archive) badge
   stays solid red regardless. These rules sit AFTER the generic hover rules
   so the red badge wins at equal specificity. */
.dsh-ws-mindmap-toolbar-badge{flex:none;width:15px;height:15px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 28%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary);transition:background .15s ease,color .15s ease}
.dsh-ws-mindmap-toolbar-badge svg{display:block;width:9px;height:9px}
.dsh-ws-mindmap-toolbar-button:hover .dsh-ws-mindmap-toolbar-badge{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted)}
.dsh-ws-mindmap-toolbar-button-danger .dsh-ws-mindmap-toolbar-badge,.dsh-ws-mindmap-toolbar-button-danger:hover .dsh-ws-mindmap-toolbar-badge{background:var(--dsw-alias-state-error-primary);color:#fff}
/* Archive button: right-aligned within the toolbar. */
.dsh-ws-mindmap-toolbar-archive{margin-left:auto}
.dsh-ws-mindmap-viewport{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none}
.dsh-ws-mindmap-viewport[data-dragging]{cursor:grabbing;user-select:none}
/* A mind map docked as a preview tab fills the preview column below the tab
   strip: the body wrapper becomes a flex column and the map takes the rest. */
.dsh-ws-preview-body.dsh-ws-mindmap-dock{display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1)}
.dsh-ws-preview-body.dsh-ws-mindmap-dock .dsh-ws-mindmap{flex:1;min-height:0;height:auto}
/* Convert-to-mind-map confirm dialog: a roomier modal than the default
   (larger width, more padding) with pill buttons — cancel gets a neutral
   border, confirm a primary-colored border. */
.dsh-ws-mindmap-confirm-dialog{width:min(440px,100%)}
.dsh-ws-mindmap-confirm-dialog .dsh-ws-dialog-body{padding:18px 20px}
.dsh-ws-mindmap-confirm-dialog .dsh-ws-dialog-message{font-size:14px;line-height:22px}
.dsh-ws-mindmap-confirm-dialog .dsh-ws-dialog-footer{padding:0 20px 18px;gap:10px}
.dsh-ws-mindmap-confirm-button{height:34px;padding:0 18px;border-radius:999px;font-size:13px}
.dsh-ws-mindmap-confirm-cancel{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dsh-ws-mindmap-confirm-cancel:hover{border-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-primary)}
.dsh-ws-mindmap-confirm-ok{border:1px solid var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dsh-ws-mindmap-confirm-ok:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);border-color:var(--dsw-alias-state-business-primary)}
/* Archive-entire-mind-map confirm dialog (approved scheme A): an enlarged
   480px warning dialog — red border + red glow, a red→amber gradient band
   across the top, an amber ⚠ badge, the message in a faint-red card, and a
   solid red-gradient confirm pill. All colors are theme vars (error/warn),
   so both themes adapt automatically. */
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
/* Type-"yes" confirm gate for archiving the whole map: centered label +
   centered input + status capsule (red until "yes" matches, then green). */
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
.dsh-ws-mindmap-edge:not(.dsh-ws-mindmap-edge-flow){fill:none;stroke:var(--dsw-alias-border-l2,#8a8f98);stroke-width:1.5;opacity:.85}
/* V3 mount edges (root → top-level session head, parent card → nested session
   head): primary dashed, weaker than the ancestor-trace classes above it. */
.dsh-ws-mindmap-edge-mount{stroke:var(--dsw-alias-state-business-primary);stroke-width:1.6;opacity:.55;stroke-dasharray:4 4}
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
.dsh-ws-mindmap-node-done{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dsh-ws-mindmap-node-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.dsh-ws-mindmap-branch{flex:none;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.dsh-ws-mindmap-branch:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.dsh-ws-mindmap-branch:disabled{opacity:.55;cursor:not-allowed}
.dsh-ws-mindmap-node-current-badge{position:absolute;top:3px;right:8px;padding:1px 7px;border-radius:999px;background:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));color:var(--dsw-alias-label-primary-inverted);font-size:10px;line-height:14px}
/* Branch cards: fork children that cannot overlap the shared chain window
   render as their own card (always visible), with a head row (tag + branch
   title) and, when the branch has visible rounds, a per-round preview list. */
.dsh-ws-mindmap-pending{border-style:dashed;cursor:pointer;justify-content:flex-start;align-items:stretch}
.dsh-ws-mindmap-branchcard{border-style:dashed;cursor:pointer;justify-content:flex-start;align-items:stretch;gap:6px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,var(--dsw-alias-state-business-primary) 6%)}
/* End-of-branch card ("末端"): the WHOLE card wears the accent tint — border,
   background wash and the "末端" capsule all resolve the --dsh-ws-mindmap-end
   custom property (default success green), so a terminal-point card reads
   green as a card, not just in its chip. The selected / hover ancestor rules
   (later in source, equal-or-higher specificity) still override the border,
   so the trace highlight stays visible over the tint. Streaming cards keep
   only the chip (their flowing ring is already the strong signal). */
.dsh-ws-mindmap-node.dsh-ws-mindmap-endcard{border-color:var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary));background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 86%,var(--dsh-ws-mindmap-end,var(--dsw-alias-state-success-primary)) 14%)}
/* V3 nodes: the VIRTUAL root node (the map's top hub — click it to create a
   new top-level session) and each session's HEAD node (its identity card at
   the left of the question chain; the "当前" badge sits here). */
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
.dsh-ws-mindmap-head.dsh-ws-mindmap-node-ring{border:2px solid transparent;padding:8px 9px;border-radius:12px;background:linear-gradient(var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-layer-1)) padding-box,conic-gradient(from var(--dsw-ws-mm-angle),var(--dsw-ws-mm-c1),var(--dsw-ws-mm-c2),var(--dsw-ws-mm-c3),var(--dsw-ws-mm-c1)) border-box;animation:dsh-ws-mindmap-ring-spin 2.4s linear infinite}
/* Live streaming cards (turns in flight, ephemeral UI — replaced by normal
   cards once their turns complete): instead of an enclosing frame, each
   streaming card AND its parent card get a colorful flowing gradient ring
   (conic gradient clipped to the border box, rotating through the registered
   --dsw-ws-mm-angle), and the edge between them flows with the same palette.
   Palette colors arrive as inline --dsw-ws-mm-c1..c3; the 2px transparent
   border plus compensated padding keep content from shifting when the ring
   appears. The compound selectors beat the ancestor / branch border rules. */
@property --dsw-ws-mm-angle{syntax:'<angle>';initial-value:0deg;inherits:false}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ring{border:2px solid transparent;padding:7px 9px;border-radius:12px;background:linear-gradient(var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-layer-1)) padding-box,conic-gradient(from var(--dsw-ws-mm-angle),var(--dsw-ws-mm-c1),var(--dsw-ws-mm-c2),var(--dsw-ws-mm-c3),var(--dsw-ws-mm-c1)) border-box;animation:dsh-ws-mindmap-ring-spin 2.4s linear infinite}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ring.dsh-ws-mindmap-node-streaming{box-shadow:0 0 14px color-mix(in srgb,var(--dsw-ws-mm-c1) 22%,transparent);background:linear-gradient(color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent)) padding-box,conic-gradient(from var(--dsw-ws-mm-angle),var(--dsw-ws-mm-c1),var(--dsw-ws-mm-c2),var(--dsw-ws-mm-c3),var(--dsw-ws-mm-c1)) padding-box,conic-gradient(from var(--dsw-ws-mm-angle),var(--dsw-ws-mm-c1),var(--dsw-ws-mm-c2),var(--dsw-ws-mm-c3),var(--dsw-ws-mm-c1)) border-box}
.dsh-ws-mindmap-node-streaming-status{display:flex;align-items:center;gap:6px;color:var(--dsw-ws-mm-c1,var(--dsw-alias-state-business-primary))}
.dsh-ws-mindmap-node-streaming-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-ws-mm-c1,var(--dsw-alias-state-business-primary));animation:dsh-ws-mindmap-dot-pulse 1s ease-in-out infinite}
/* AI-summary-in-progress status row (方案 B): replaces "已完成" while a summary
   is being generated; primary blue (no ring var on a normal card), same pulse
   dot as streaming. */
.dsh-ws-mindmap-node-summarizing{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-state-business-primary)}
@keyframes dsh-ws-mindmap-ring-spin{to{--dsw-ws-mm-angle:360deg}}
@keyframes dsh-ws-mindmap-dot-pulse{0%,100%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion: reduce){.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ring{animation:none}.dsh-ws-mindmap-edge-flow{animation:none}.dsh-ws-mindmap-node-streaming-dot{animation:none}}
.dsh-ws-mindmap-pending-head{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-ws-mindmap-pending-label{flex:none;display:inline-flex;align-items:center;gap:2px;padding:1px 6px 1px 5px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent);border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);font-size:10px;line-height:14px}
/* End-of-branch capsule ("末端"): the same chip shape, but tinted with the
   success green so the terminal-point chip is instantly distinguishable from
   a fork point (which stays primary-blue). */
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
.dsh-ws-mindmap-error{color:var(--dsw-alias-state-error-primary)}
.dsh-ws-mindmap-fork-error{position:sticky;top:0;z-index:2;margin-bottom:10px;padding:6px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:17px}
.dsh-ws-mindmap-notice{margin-bottom:10px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;line-height:17px}
.dsh-ws-mindmap-notice-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dsh-ws-mindmap-node[data-branch]{border-style:solid}
/* Folded card: one compact card standing in for a maximal run of consecutive
   folded turns — dashed border + muted wash (the branchcard tint is
   overridden), fold icon + count badge in the title row, first-turn text (or
   its AI summary) in the body. Placed AFTER the [data-branch] solid rule
   (equal specificity, later wins) and BEFORE the ancestor/hover rules so the
   selection / hover traces keep their border-color overrides. */
.dsh-ws-mindmap-node.dsh-ws-mindmap-folded{border-style:dashed;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 90%,var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary)) 10%)}
.dsh-ws-mindmap-fold-count{flex:none;padding:0 6px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);font-size:10px;line-height:15px;font-weight:600}
.dsh-ws-mindmap-node-q-folded{color:var(--dsw-alias-label-secondary);font-style:italic;font-weight:500}
.dsh-ws-mindmap-node-folded-status{color:var(--dsw-alias-state-business-primary)}
/* Peeked card status: a folded-marked turn temporarily expanded (click on the
   folded card) — the folded attribute is untouched, so the status row says
   已折叠 in amber (the run's dashed outline is the grouping cue). */
.dsh-ws-mindmap-node-peeked-status{color:var(--dsw-alias-state-warn-primary)}
/* Temporary-expand (peek) outline around the run: amber dashed box, never
   intercepts pointer events. */
.dsh-ws-mindmap-peek-box{position:absolute;border:1.5px dashed var(--dsw-alias-state-warn-primary);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 4%,transparent);pointer-events:none;box-sizing:border-box}
/* Selected-card ancestor trace: the current card's chain back to the root —
   edges turn dashed primary-blue, parent nodes get a dashed primary-blue
   border. The compound selector beats the base rules (equal specificity,
   later in source), so the trace keeps its stroke. */
.dsh-ws-mindmap-edge.dsh-ws-mindmap-edge-active{stroke:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));stroke-dasharray:6 5;stroke-width:2;opacity:1}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-ancestor{border-style:dashed;border-color:var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-selected,var(--dsw-alias-state-business-primary)) 18%,transparent)}
/* Hover ancestor trace: the card under the pointer gets a solid amber border
   + soft glow, its ancestors and path edges go amber dashed — visually
   distinct from the selected card's primary-blue chain (blue = persistent
   selection, amber = transient hover preview). Each hover class sits AFTER
   its blue counterpart (equal specificity, later wins), so when a card or
   edge is on BOTH the selection and the hover path, the hover (the pointer's
   current focus) wins. Ring (streaming) cards are excluded: their flowing
   ring is already the stronger signal and a border-color override would
   erase it. */
.dsh-ws-mindmap-edge.dsh-ws-mindmap-edge-hover-active{stroke:var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary));stroke-dasharray:6 5;stroke-width:2;opacity:1}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-hover-ancestor{border-style:dashed;border-color:var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary)) 22%,transparent)}
.dsh-ws-mindmap-node.dsh-ws-mindmap-node-hover:not(.dsh-ws-mindmap-node-ring){border-style:solid;border-color:var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary));box-shadow:0 0 0 1px color-mix(in srgb,var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary)) 35%,transparent),0 0 14px color-mix(in srgb,var(--dsh-ws-mindmap-hover,var(--dsw-alias-state-warn-primary)) 22%,transparent)}
/* Settings color swatch for the mind-map highlight pickers. */
.dsh-ws-mindmap-node-hint{position:absolute;right:5px;bottom:5px;z-index:1;max-width:calc(100% - 10px);padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-business-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent);font-size:10px;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;box-sizing:border-box}
.dsh-ws-settings-color{flex:none;width:40px;height:26px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);cursor:pointer;box-sizing:border-box}
.dsh-ws-settings-color::-webkit-color-swatch-wrapper{padding:0}
.dsh-ws-settings-color::-webkit-color-swatch{border:0;border-radius:3px}
.dsh-ws-settings-color::-moz-color-swatch{border:0;border-radius:3px}
.dsh-ws-mindmap-hidden-row{display:none!important}
.dsh-ws-mindmap-no-overflow{display:none!important}
/* Sidebar mind-map session entries: rendered INSIDE each workspace group's
   session list (one container per group section), flat / search modes use a
   region-area fallback seat instead. Draggable to reorder (order persisted per
   group); right-click menu (rename / reveal). Empty containers collapse. */
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
/* While any session in a mind map family streams (summary.running flips at
   generation start, no sync wait), spin the left icon to mirror the hidden
   ordinary rows' live generation. */
@keyframes dsh-ws-mindmap-spin{to{transform:rotate(360deg)}}
.dsh-ws-sidebar-mindmaps-item[data-running] .dsh-ws-sidebar-mindmaps-icon{animation:dsh-ws-mindmap-spin var(--dsh-ws-mindmap-spin-duration,1.2s) linear infinite;transform-origin:center}
@media (prefers-reduced-motion: reduce){.dsh-ws-sidebar-mindmaps-item[data-running] .dsh-ws-sidebar-mindmaps-icon{animation:none}}
.dsh-ws-sidebar-mindmaps-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-ws-sidebar-mindmaps-count{flex:none;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px}
.dsh-ws-frame[data-sidebar-files] .dsh-ws-sidebar-mindmaps{display:none}
.dsh-ws-frame[data-sidebar-collapsed] .dsh-ws-sidebar-mindmaps{display:none}
/* A collapsed group renders no rows, but the injected mind-map seat is a
   foreign node React leaves in place. Harness wraps the group header in a
   HoverCard span and appends the seat to it, so both share one direct parent
   (span for real workspaces, section div for the ungrouped bucket); fold the
   seat with the folder by matching that parent — like the files / rail rules. */
[data-slot="sidebar.workspaces"] *:has(> [role="treeitem"][aria-expanded="false"]) > .dsh-ws-sidebar-mindmaps{display:none}
/* Rendered-Markdown overlay inside the preview body: absolute keeps the
   mounted CodeMirror alive underneath; scrollable for long documents. */
.dsh-ws-md-preview{position:absolute;inset:0;overflow:auto;box-sizing:border-box;padding:16px 20px;background:var(--dsw-alias-bg-base)}
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
/* ---- Edit/write tool cards share the Think-card pattern: the per-file diff
   body and the generic input/output sections are fixed-height viewports
   limited to the --dsh-ws-edit-lines line count (the 编辑显示行数 slider,
   independent of the Think-card count), with the same slim right-side
   scrollbar (the diff also keeps horizontal scrolling for long lines). The
   old per-card "expand rest" cap is gone: scrolling reaches the whole
   change. ---- */
.dsh-ws-diff-body,.dsh-ws-tool-io-section{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,transparent) transparent;overscroll-behavior:contain}
.dsh-ws-diff-body::-webkit-scrollbar,.dsh-ws-tool-io-section::-webkit-scrollbar{width:6px;height:6px}
.dsh-ws-diff-body::-webkit-scrollbar-thumb,.dsh-ws-tool-io-section::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,transparent);border:1px solid transparent;border-radius:6px;background-clip:padding-box}
.dsh-ws-diff-body::-webkit-scrollbar-thumb:hover,.dsh-ws-tool-io-section::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,transparent)}
.dsh-ws-diff-body::-webkit-scrollbar-track,.dsh-ws-tool-io-section::-webkit-scrollbar-track{background:transparent}
.dsh-ws-diff-body{max-height:calc(var(--dsh-ws-edit-lines,10) * 22px + 24px);overflow-y:auto}
.dsh-ws-tool-io-section{max-height:calc(var(--dsh-ws-edit-lines,10) * 20px + 24px)}
/* ---- Think card (chat thinking blocks): the block stays open as a card
   (the harness only renders the body while the disclosure row is open —
   hooks/think-card.js keeps rows open) whose body viewport shows only the
   latest --dsh-ws-think-lines rows, with the card's own slim scrollbar on the
   right for reaching earlier rows. The body class is a CSS-module name (may
   be hashed), so rules match the "thinkBody" substring. ---- */
.dsh-ws-chat [data-variant="think"]{box-sizing:border-box;margin:6px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
/* Scroll-gate armed cue: the card owns the wheel after a click inside. */
.dsh-ws-chat [data-variant="think"][data-scroll-armed]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}
.dsh-ws-chat [data-variant="think"] [class*="thinkBody"]{box-sizing:border-box;max-height:calc(var(--dsh-ws-think-lines,10) * (20px + var(--dsh-content-font-delta-secondary,0px)) + 11px);overflow-y:auto;padding:2px 10px 8px 22px;border-top:1px solid var(--dsw-alias-border-l1);overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,transparent) transparent}
.dsh-ws-chat [data-variant="think"] [class*="thinkBody"]::-webkit-scrollbar{width:6px}
.dsh-ws-chat [data-variant="think"] [class*="thinkBody"]::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,transparent);border:1px solid transparent;border-radius:6px;background-clip:padding-box}
.dsh-ws-chat [data-variant="think"] [class*="thinkBody"]::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,transparent)}
.dsh-ws-chat [data-variant="think"] [class*="thinkBody"]::-webkit-scrollbar-track{background:transparent}
/* Think-card header chevron: nudge the disclosure glyph right off the card's
   left border edge (the leading box is flush with the card edge). */
.dsh-ws-chat [data-variant="think"] [data-disclosure-row] > span:first-child{margin-left:6px}
`
