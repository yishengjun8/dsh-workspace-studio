import { createElement as h, Fragment } from 'react'
import { translate } from '../../locale/index.js'
import { IconFolder } from '../../icons.js'
import { TreeStatus } from '../menus.js'

/* Search-result list (grouped by file, expandable match rows). Pure render of
   the explorer's search state; all interactions are callbacks. */
export function SearchResults({ state, expanded, onToggleFile, onOpenEntry, onOpenMatch }) {
  if (state.state === 'idle') {
    return h('div', { className: 'dsh-ws-empty' }, translate('search.hint'))
  }
  if (state.state === 'searching') {
    return h(TreeStatus, null, translate('search.searching'))
  }
  if (state.state === 'error') {
    return h('div', { className: 'dsh-ws-empty' },
      h('div', { className: 'dsh-ws-error-card' }, state.message))
  }
  if (state.result.files.length === 0) {
    return h(Fragment, null,
      h('div', { className: 'dsh-ws-search-summary' }, translate('search.noResults')),
      h('div', { className: 'dsh-ws-empty' }, translate('search.noResultsFor', { query: state.result.query })),
    )
  }
  if (state.result.nameOnly === true) {
    return h(Fragment, null,
      h('div', { className: 'dsh-ws-search-summary' },
        `${translate('search.summaryNameOnly', { files: state.result.fileCount })}${state.result.truncated ? translate('search.summaryTruncated') : ''}`),
      state.result.files.map(file =>
        h('button', {
          className: 'dsh-ws-search-file-header',
          key: file.path,
          onClick: () => onOpenEntry(file),
          title: file.path,
          type: 'button',
        },
          file.kind === 'directory' ? h('span', { 'aria-hidden': true, className: 'dsh-ws-search-kind' }, h(IconFolder)) : null,
          h('span', { className: 'dsh-ws-row-name' }, file.path),
        ),
      ),
    )
  }
  return h(Fragment, null,
    h('div', { className: 'dsh-ws-search-summary' },
      `${translate('search.summary', { matches: state.result.matchCount, files: state.result.fileCount })}${state.result.truncated ? translate('search.summaryTruncated') : ''}`),
    state.result.files.map(file => {
      const isExpanded = expanded.has(file.path)
      return h('div', { className: 'dsh-ws-search-file', key: file.path },
        h('button', {
          'aria-expanded': isExpanded,
          className: 'dsh-ws-search-file-header',
          onClick: () => onToggleFile(file.path),
          title: file.path,
          type: 'button',
        },
          h('span', { className: 'dsh-ws-chevron' }, isExpanded ? '▼' : '▶'),
          h('span', { className: 'dsh-ws-row-name' }, file.path),
          file.truncated ? h('span', { className: 'dsh-ws-search-truncated', title: translate('search.partial.title') }, translate('search.partial')) : null,
          h('span', { className: 'dsh-ws-search-file-count' }, `${file.matches.length}`),
        ),
        isExpanded ? file.matches.map(match => h('button', {
          className: 'dsh-ws-search-row',
          key: `${match.line}:${match.startColumn}`,
          onClick: () => onOpenMatch(file, match),
          title: translate('search.row.title', { path: file.path, line: match.line }),
          type: 'button',
        },
          h('span', { className: 'dsh-ws-search-line' }, String(match.line)),
          h('span', { className: 'dsh-ws-search-text' },
            match.text.slice(0, match.startColumn - 1),
            h('span', { className: 'dsh-ws-search-hit' }, match.text.slice(match.startColumn - 1, match.endColumn - 1)),
            match.text.slice(match.endColumn - 1),
          ),
        )) : null,
      )
    }),
  )
}
