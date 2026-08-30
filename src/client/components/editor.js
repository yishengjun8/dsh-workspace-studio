import { createElement as h, useRef, useState, useEffect } from 'react'
import { closeSearchPanel, findNext, findPrevious, gotoLine, highlightSelectionMatches, openSearchPanel, search, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { bracketMatching, defaultHighlightStyle, foldable, foldEffect, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, unfoldAll } from '@codemirror/language'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, panels } from '@codemirror/view'
import { localeIsZh, translate, useLocaleText } from '../locale/index.js'
import { languageFor, tokenHighlight } from '../languages.js'
import { HIGHLIGHT_PRESET_DEFAULT, lineSeparator } from '../format.js'

/* CodeMirror search/goto-line panel phrases (EditorState.phrases keys; keep the $ placeholders). English is CodeMirror's default, so the override is only installed for the Chinese surface. */
export const CM_PHRASES_ZH = Object.freeze({
  'Find': '查找',
  'Replace': '替换为',
  'next': '下一个',
  'previous': '上一个',
  'all': '全部',
  'match case': '区分大小写',
  'regexp': '正则',
  'by word': '全字匹配',
  'replace': '替换',
  'replace all': '全部替换',
  'close': '关闭',
  'Go to line': '跳转到行',
  'go': '跳转',
  'current match': '当前匹配',
  'on line': '行',
  'replaced match on line $': '已在第 $ 行替换匹配',
  'replaced $ matches': '已替换 $ 个匹配项',
})

export function revealPosition(view, reveal) {
  /* NaN/non-numeric line data (corrupt search results, stale caches) must not
     reach Text.line: Math.min/max propagate NaN and the line() guard treats
     NaN as in-bounds, so the binary search would land on a wrong line. */
  const rawLine = Number(reveal?.line)
  const lineNumber = Number.isFinite(rawLine)
    ? Math.min(Math.max(1, Math.round(rawLine)), view.state.doc.lines)
    : 1
  const line = view.state.doc.line(lineNumber)
  const rawColumn = Number(reveal?.column)
  const startColumn = Number.isFinite(rawColumn)
    ? Math.min(Math.max(1, Math.round(rawColumn)), line.length + 1)
    : 1
  const rawEndColumn = Number(reveal?.endColumn)
  const endColumn = Number.isFinite(rawEndColumn)
    ? Math.min(Math.max(startColumn, Math.round(rawEndColumn)), line.length + 1)
    : startColumn
  const from = line.from + startColumn - 1
  const to = line.from + endColumn - 1
  view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
}

/* Code-folding helpers backing Ctrl+K+J / Ctrl+K+<n>. Nesting depth is
   1-based: a top-level region is level 1, one directly inside another is 2. */
export function collectFoldableRanges(view) {
  const state = view.state
  const seen = new Set()
  const ranges = []
  for (let pos = 0; pos < state.doc.length;) {
    const line = view.lineBlockAt(pos)
    const range = foldable(state, line.from, line.to)
    if (range) {
      const key = `${range.from}:${range.to}`
      if (!seen.has(key)) {
        seen.add(key)
        ranges.push(range)
      }
    }
    pos = line.to + 1
  }
  return ranges
}
/* Nesting depth per foldable range: 1 for top-level, +1 per enclosing region.
   Fold regions are disjoint-or-nested in document order, so one stack sweep
   computes all depths in linear time (the old per-range scan was quadratic). */
export function foldLevelsOf(ranges) {
  const ordered = [...ranges].sort((a, b) => a.from - b.from || b.to - a.to)
  const levels = new Array(ordered.length)
  const stack = []
  for (let index = 0; index < ordered.length; index += 1) {
    const range = ordered[index]
    while (stack.length > 0 && stack[stack.length - 1].to <= range.from) stack.pop()
    levels[index] = stack.length + 1
    stack.push(range)
  }
  return { ordered, levels }
}
/* Fold every foldable region whose nesting depth is exactly `level`. */
export function foldLevel(view, level) {
  const ranges = collectFoldableRanges(view)
  const { ordered, levels } = foldLevelsOf(ranges)
  const effects = []
  for (let index = 0; index < ordered.length; index += 1) {
    if (levels[index] === level) effects.push(foldEffect.of(ordered[index]))
  }
  if (effects.length) {
    view.dispatch({ effects })
    return true
  }
  return false
}

export function CodeEditor({ file, editing, wrap, onContext, onDirty, onSaveShortcut, onScroll, reveal, scrollTop, editorRef, highlightPreset, searchPanelContainer, readEpoch, onRevealApplied }) {
  const host = useRef(null)
  /* Lazy compartments: useRef(new Compartment()) would construct a discarded
     object on every render (only the first is kept). */
  const [editableCompartment] = useState(() => new Compartment())
  const [wrapCompartment] = useState(() => new Compartment())
  const [phrasesCompartment] = useState(() => new Compartment())
  const localeTick = useLocaleText()
  const contextRef = useRef(onContext)
  const dirtyRef = useRef(onDirty)
  const saveRef = useRef(onSaveShortcut)
  const scrollRef = useRef(onScroll)
  const revealRef = useRef(null)
  const onRevealAppliedRef = useRef(onRevealApplied)
  const revealAppliedRef = useRef(null)
  contextRef.current = onContext
  dirtyRef.current = onDirty
  saveRef.current = onSaveShortcut
  scrollRef.current = onScroll
  revealRef.current = reveal
  onRevealAppliedRef.current = onRevealApplied
  // A reveal is consumed the first time it is applied, so returning to the tab
  // later restores the persisted scroll instead of re-jumping to a stale match.
  const markRevealApplied = (target) => {
    if (target === null || revealAppliedRef.current === target) return
    revealAppliedRef.current = target
    onRevealAppliedRef.current?.()
  }

  useEffect(() => {
    const descriptor = languageFor(file.name)
    const separator = lineSeparator(file.lineEnding)
    const separatorExtension = file.lineEnding === 'mixed'
      ? []
      : EditorState.lineSeparator.of(separator)
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: file.content,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), history(), foldGutter(), drawSelection(), dropCursor(),
          EditorState.allowMultipleSelections.of(true), indentOnInput(), bracketMatching(), closeBrackets(),
          highlightSelectionMatches(), highlightActiveLine(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          /* The search panel renders into a container div between the status
             bar and the preview body: top:true puts it in the top panel group
             (the @codemirror/search default is bottom); panels({ topContainer })
             places that group in the plugin-owned container, not in the editor. */
          search({ top: true }),
          panels(searchPanelContainer?.current ? { topContainer: searchPanelContainer.current } : undefined),
          /* Search/goto-line panel labels render through EditorState.phrase();
             without this map they show English. Keys mirror @codemirror/search's
             phrases; keep the $ placeholders. The compartment follows the
             active locale (English keeps the built-in defaults). */
          phrasesCompartment.of(localeIsZh() ? EditorState.phrases.of(CM_PHRASES_ZH) : []),
          syntaxHighlighting(tokenHighlight),
          keymap.of([
            /* Mod-s is deliberately NOT bound here: the window-level capture
               handler owns it so saving works from every focus state (same
               single-path rule as Ctrl+K and the find workflow). */
            indentWithTab, ...closeBracketsKeymap, ...defaultKeymap,
            /* Editor-only search keys stay in the keymap: Escape closes the
               panel; Ctrl+D / Ctrl+Shift+L / Ctrl+Alt+G select occurrences,
               matches, or jump to a line. The find workflow (Ctrl/Cmd+F,
               Ctrl/Cmd+G, F3) is deliberately NOT bound here — the window
               capture handler owns it so it works from every focus state
               (single path, same as Ctrl+K). */
            { key: 'Escape', run: closeSearchPanel, scope: 'editor search-panel' },
            { key: 'Mod-Shift-l', run: selectSelectionMatches },
            { key: 'Mod-Alt-g', run: gotoLine },
            { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
            ...historyKeymap, ...foldKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              /* One sliceDoc per change, shared by the autosave and the context
                 publish (a second full copy per keystroke is pure cost on large
                 files); the docChanged flag lets the context publish rebuild
                 its CRLF prefix table only when the text actually changed. */
              const text = update.state.sliceDoc()
              dirtyRef.current(text)
              contextRef.current(update.state, true, text)
            } else if (update.selectionSet) {
              contextRef.current(update.state, false)
            }
          }),
          editableCompartment.of([
            EditorView.editable.of(editing),
            EditorState.readOnly.of(!editing),
          ]),
          wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
          descriptor.extension,
          separatorExtension,
          EditorView.theme({
            '&': { backgroundColor: 'var(--dsw-alias-markdown-code-block)', color: 'var(--dsw-alias-label-primary)' },
            '.cm-content': { caretColor: 'var(--dsw-alias-label-primary)' },
            '&.cm-focused': { outline: 'none' },
          }, { dark: false }),
        ],
      }),
    })
    const reportScroll = () => {
      scrollRef.current?.(file.path, view.scrollDOM.scrollTop)
    }
    view.scrollDOM.addEventListener('scroll', reportScroll)
    editorRef.current = view
    // A reveal consumes itself (parent clears the request), so the second pass
    // must not fall through to the persisted scrollTop; the closure flag scopes that.
    let revealHandled = false
    const restoreScroll = () => {
      const target = revealRef.current
      if (target !== null && target.path === file.path) {
        revealPosition(view, target)
        markRevealApplied(target)
        revealHandled = true
        return
      }
      if (revealHandled) return
      if (Number.isFinite(scrollTop) && scrollTop > 0) view.scrollDOM.scrollTop = scrollTop
    }
    restoreScroll()
    // Second pass after layout: the first assignment can be clamped before the
    // browser sizes the fresh editor content; next frame the real height exists.
    // Known limitation: rAF is paused while the tab is backgrounded, so a file
    // opened in a hidden tab restores its scroll on the next visible frame —
    // acceptable (the value is re-read from the tab on the next open anyway).
    const animation = requestAnimationFrame(restoreScroll)
    contextRef.current(view.state)
    return () => {
      cancelAnimationFrame(animation)
      // React removes the editor DOM before passive cleanups, so a detached
      // scroller reads scrollTop as 0; reporting that would poison the live
      // scroll map and wipe the next remount's restore target. Only report
      // while still connected.
      if (view.scrollDOM.isConnected) scrollRef.current?.(file.path, view.scrollDOM.scrollTop)
      view.scrollDOM.removeEventListener('scroll', reportScroll)
      if (editorRef.current === view) editorRef.current = undefined
      view.destroy()
    }
    // Rebuild only on a real re-read (path/encoding/read epoch), never on save:
    // rebuilding after a save would wipe the undo history and caret position.
  }, [file.path, file.encoding, readEpoch])

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: editableCompartment.reconfigure([
        EditorView.editable.of(editing),
        EditorState.readOnly.of(!editing),
      ]),
    })
  }, [editing])

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
    })
  }, [wrap])

  useEffect(() => {
    editorRef.current?.dispatch({
      effects: phrasesCompartment.reconfigure(localeIsZh() ? EditorState.phrases.of(CM_PHRASES_ZH) : []),
    })
  }, [localeTick])

  useEffect(() => {
    const view = editorRef.current
    if (view === undefined || reveal === null) return
    /* Same path guard as the mount-time restoreScroll: in a fast file switch
       the effect can fire with a stale reveal while editorRef already points
       at the NEW file's editor — jumping to the old file's line would be wrong
       (and would consume the reveal). */
    if (reveal.path !== file.path) return
    revealPosition(view, reveal)
    markRevealApplied(reveal)
  }, [reveal])

  // Ctrl+K+J / Ctrl+K+<n> are handled at the window level (capture phase) so
  // they work in every focus state; the editor keymap path proved unreliable,
  // so it deliberately does not bind these keys (one handling path avoids
  // folding twice). Keys are consumed only for the Ctrl+K prefix and its
  // completion J / 1..9.
  useEffect(() => {
    let armed = false
    let timer
    const cancel = () => { armed = false; clearTimeout(timer) }
    const onKeyDown = (event) => {
      const view = editorRef.current
      if (view === undefined) return
      // IME composition must never arm or complete the fold sequence (same as
      // other shortcut paths): composing keystrokes pass through untouched.
      if (event.isComposing) { cancel(); return }
      const target = event.target
      // Outside text fields (chat, rename, search, dialogs) keep their keys; the editor's contenteditable is inside host.
      const insideEditor = host.current !== null && target instanceof Node && host.current.contains(target)
      /* Element (not HTMLElement) so SVG targets are covered too; closest()
         handles nested inputs inside custom controls. */
      const inTextField = target instanceof Element
        && (target.isContentEditable || target.closest('input, textarea, select') !== null)
      if (!insideEditor && inTextField) {
        cancel()
        return
      }
      const key = String(event.key).toLowerCase()
      const isCtrlK = key === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      /* The prefix is consumed only while the editor is focused or the focus
         sits on the explorer's own chrome (tree rows, tabs, panel headers) —
         the fold workflow's natural focus states. Anywhere else (buttons,
         body, harness chrome) Ctrl+K passes through to the harness instead of
         being swallowed by the capture listener. */
      const foldChrome = target instanceof Element
        && target.closest('.dsh-ws-tree-row, .dsh-ws-preview-tab, .dsh-ws-panel-header') !== null
      if (isCtrlK && (insideEditor || foldChrome)) {
        // (Re-)arm the prefix; a repeated Ctrl+K keeps the sequence alive.
        event.preventDefault()
        event.stopPropagation()
        armed = true
        clearTimeout(timer)
        timer = setTimeout(cancel, 1000)
        return
      }
      if (!armed) return
      cancel()
      /* The arm window may have outlived the focus: if the user moved focus to
         an external input (chat, rename, search, dialogs) after arming, the
         completion key belongs to that field — pass it through instead of
         folding. (The pre-arm guard above already cancels on such targets;
         this is the same fence at the completion site so a future reorder of
         the guards cannot swallow a keystroke.) */
      if (!insideEditor && target instanceof Element
        && (target.isContentEditable || target.closest('input, textarea, select') !== null)) {
        return
      }
      /* Completion keys must carry NO modifiers: within the 1 s arm window a
         plain J / 1..9 completes the sequence, but Ctrl+J, Ctrl+1, Shift+J etc.
         are the user's own shortcuts and must pass through untouched instead of
         being hijacked as a fold command. */
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      if (!hasModifier && key === 'j') {
        event.preventDefault()
        event.stopPropagation()
        unfoldAll(view)
        return
      }
      if (!hasModifier && key.length === 1 && key >= '1' && key <= '9') {
        event.preventDefault()
        event.stopPropagation()
        foldLevel(view, Number(key))
        return
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      cancel()
    }
  }, [])

  // Find shortcuts (Ctrl/Cmd+F, Ctrl/Cmd+G, Ctrl/Cmd+Shift+G, F3, Shift+F3)
  // are handled at the window level (capture phase) so they work in every
  // focus state, like Ctrl+K above; the editor keymap deliberately does not
  // bind them (one handling path). With no editor mounted, keys pass through
  // so the browser's own find still works.
  useEffect(() => {
    const onKeyDown = (event) => {
      const view = editorRef.current
      if (view === undefined) return
      // IME composition must never trigger find shortcuts (same guard as the
      // Ctrl+K handler and the explorer clipboard handler): composing
      // keystrokes pass through untouched.
      if (event.isComposing) return
      /* A modal dialog (new/rename/delete, save-conflict) is open: the search
         panel would render behind its backdrop (z-index below the dialog) and
         the keys belong to the dialog — pass through. */
      if (typeof document !== 'undefined' && document.querySelector('.dsh-ws-dialog-backdrop') !== null) return
      const target = event.target
      // Outside text fields (chat, rename, dialogs) keep their keys; the
      // editor's contenteditable and the search panel input (in the search
      // container) are editor-internal and still reach this handler.
      const panelContainer = searchPanelContainer?.current
      const insideEditor = (host.current !== null && target instanceof Node && host.current.contains(target))
        || (panelContainer !== null && target instanceof Node && panelContainer.contains(target))
      if (!insideEditor && target instanceof Element
        && (target.isContentEditable || target.closest('input, textarea, select') !== null)) return
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey
      const key = String(event.key).toLowerCase()
      const plainF3 = event.key === 'F3' && !event.ctrlKey && !event.metaKey && !event.altKey
      let handled = false
      if (key === 'f' && mod && !event.shiftKey) {
        openSearchPanel(view)
        handled = true
      } else if (key === 'g' && mod && !event.shiftKey) {
        findNext(view)
        handled = true
      } else if (key === 'g' && mod && event.shiftKey) {
        findPrevious(view)
        handled = true
      } else if (plainF3 && !event.shiftKey) {
        findNext(view)
        handled = true
      } else if (plainF3 && event.shiftKey) {
        findPrevious(view)
        handled = true
      }
      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Save shortcut (Ctrl/Cmd+S) at the window level (capture phase) so it works
  // from every focus state — the editor keymap path only fired while the
  // editor itself was focused, leaving Ctrl+S to the browser's save dialog
  // whenever the user had moved focus to the chat or a button. The save
  // callback itself no-ops when the tab is clean or saving.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.isComposing) return
      const key = String(event.key).toLowerCase()
      const isSave = key === 's' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      if (!isSave) return
      const view = editorRef.current
      if (view === undefined) return
      event.preventDefault()
      event.stopPropagation()
      saveRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Search field drag-to-resize grip: CodeMirror builds the panel DOM itself
  // and SearchPanel is not exported, so watch the panel container for
  // .cm-panel.cm-search and wrap its [main-field] input in an inline-flex
  // wrapper with a col-resize handle (once per input; the panel creates a
  // fresh input each time it opens).
  useEffect(() => {
    const container = searchPanelContainer?.current
    if (container === null || container === undefined) return undefined
    let detach = undefined
    const enhance = () => {
      /* The panel can close while a drag is in flight (Escape, blur): the
         pointer listeners are on window and would otherwise linger until the
         next drag or the editor unmount. Detach them as soon as the panel
         leaves the DOM. */
      if (container.querySelector('.cm-panel.cm-search') === null) {
        detach?.()
        return
      }
      const input = container.querySelector('.cm-panel.cm-search [main-field]')
      if (input === null || input.dataset.dshWelResize === '1') return
      input.dataset.dshWelResize = '1'
      const wrap = document.createElement('span')
      wrap.className = 'dsh-ws-search-field-wrap'
      const handle = document.createElement('span')
      handle.className = 'dsh-ws-search-resize'
      handle.title = translate('editor.searchResize')
      input.before(wrap)
      wrap.append(input, handle)
      let startX = 0
      let startWidth = 0
      let moveListener = undefined
      let upListener = undefined
      const detachPointer = () => {
        if (moveListener !== undefined) window.removeEventListener('pointermove', moveListener)
        if (upListener !== undefined) window.removeEventListener('pointerup', upListener)
        moveListener = undefined
        upListener = undefined
      }
      detach = detachPointer
      const onPointerDown = (event) => {
        event.preventDefault()
        startX = event.clientX
        startWidth = input.getBoundingClientRect().width
        const onPointerMove = (moveEvent) => {
          input.style.width = `${Math.max(60, Math.min(480, startWidth + (moveEvent.clientX - startX)))}px`
        }
        const onPointerUp = () => { detachPointer() }
        // Replace any prior drag state so a second drag cannot leak a stale
        // pair; the cleanup also detaches, so an unmount mid-drag never leaves
        // window listeners bound to a detached input.
        detachPointer()
        moveListener = onPointerMove
        upListener = onPointerUp
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
      }
      handle.addEventListener('pointerdown', onPointerDown)
    }
    enhance()
    const observer = new MutationObserver(enhance)
    observer.observe(container, { childList: true, subtree: true })
    return () => { observer.disconnect(); detach?.() }
  }, [searchPanelContainer])

  return h('div', { className: 'dsh-ws-editor-host', 'data-highlight-preset': highlightPreset ?? HIGHLIGHT_PRESET_DEFAULT, ref: host })
}
