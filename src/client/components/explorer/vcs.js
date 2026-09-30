import { createElement as h } from 'react'
import { translate } from '../../locale/index.js'
import { IconVcsBranch, IconVcsWarning } from '../../icons.js'

/**
 * Version-control strip above the file tree: what repository the workspace belongs to,
 * how many changes it has, and the two display filters. The whole strip is absent when
 * the workspace has no repository, so a non-VCS workspace looks exactly as before.
 *
 * Every piece of change information lives in the tree itself (badges, directory roll-ups,
 * deleted ghost rows); this strip only names the repository and drives the two filters.
 */
export function VcsBar({ model, changesOnly, showIgnored, ignored, onToggleChangesOnly, onToggleIgnored, onRefresh }) {
  if (model === undefined || model.visible !== true) return null
  const degraded = model.state === 'warn' || model.state === 'error'
  return h('div', { className: 'dsh-ws-vcs-bar' },
    h('button', {
      'aria-label': translate('vcs.bar.aria'),
      className: 'dsh-ws-vcs-chip',
      'data-state': model.state,
      onClick: onRefresh,
      title: model.title,
      type: 'button',
    },
    h('span', { 'aria-hidden': true, className: 'dsh-ws-vcs-icon' }, degraded ? h(IconVcsWarning) : h(IconVcsBranch)),
    h('span', { className: 'dsh-ws-vcs-kind' }, model.kind),
    h('span', { className: 'dsh-ws-vcs-label' }, model.label),
    model.count > 0 ? h('span', { className: 'dsh-ws-vcs-count' }, model.truncated ? `${model.count}+` : String(model.count)) : null),
    h('button', {
      'aria-pressed': changesOnly === true,
      className: 'dsh-ws-vcs-toggle',
      disabled: degraded || undefined,
      onClick: onToggleChangesOnly,
      title: translate('vcs.filter.changesOnly.title'),
      type: 'button',
    }, translate('vcs.filter.changesOnly')),
    showIgnored === true
      ? h('button', {
        'aria-pressed': ignored === true,
        className: 'dsh-ws-vcs-toggle',
        /* Ignored entries are not changes: the dimming only has a meaning in the full tree. */
        disabled: degraded || changesOnly === true || undefined,
        onClick: onToggleIgnored,
        title: changesOnly === true ? translate('vcs.filter.ignored.titleChangesOnly') : translate('vcs.filter.ignored.title'),
        type: 'button',
      }, translate('vcs.filter.ignored'))
      : null,
  )
}
