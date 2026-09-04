import { createElement as h } from 'react'
import { FISH } from '../constants.js'
import { translate } from '../locale/index.js'
import { setDrawerOpen, setMobile, setMobileFiles, useMobile } from '../mobile.js'

export function MobileModeToggle(props) {
  const { on } = useMobile()
  const label = translate('mobile.toggle')
  return h('button', {
    'aria-label': label,
    'aria-pressed': on,
    className: 'dsh-ws-mobile-toggle',
    'data-open': on || undefined,
    'data-rail': !props.wide || undefined,
    onClick: () => { setMobile(!on) },
    title: label,
    type: 'button',
  },
    h('svg', { 'aria-hidden': true, className: 'dsh-ws-mobile-toggle-icon', fill: 'none', viewBox: '0 0 24 24' },
      h('rect', { x: 7, y: 2.5, width: 10, height: 19, rx: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
      h('path', { d: 'M11 18.5h2', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 1.6 })),
    props.wide ? h('span', { className: 'dsh-ws-mobile-toggle-label' }, label) : null,
  )
}
/* The whale button toggling the mobile floating sidebar drawer (shared by
   the session header and the hero overlay). */
export function MobileWhaleButton({ open, onToggle }) {
  const label = open ? translate('mobile.sidebarClose') : translate('mobile.sidebarOpen')
  return h('button', {
    'aria-expanded': open,
    'aria-label': label,
    className: open ? 'dsh-ws-mobile-whale dsh-ws-mobile-active' : 'dsh-ws-mobile-whale',
    onClick: onToggle,
    title: label,
    type: 'button',
  },
    h('svg', { 'aria-hidden': true, fill: 'none', height: 18 * 19.04 / 25.16, stroke: 'currentColor', strokeWidth: 1.4, viewBox: '-1 -1 25.16 19.04', width: 18 },
      h('path', { d: FISH })))
}
/* The file-content-browsing button shared by the session header and the hero
   overlay: toggles file-fullscreen (setMobileFiles), showing active state via
   dsh-ws-mobile-active. */
export function MobileFilesButton() {
  const { files } = useMobile()
  return h('button', {
    'aria-label': translate('mobile.files'),
    'aria-pressed': files,
    className: files ? 'dsh-ws-mobile-files dsh-ws-mobile-active' : 'dsh-ws-mobile-files',
    onClick: () => setMobileFiles(!files),
    title: translate('mobile.files'),
    type: 'button',
  },
    h('svg', { 'aria-hidden': true, className: 'dsh-ws-mobile-files-icon', fill: 'none', viewBox: '0 0 24 24' },
      h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', stroke: 'currentColor', strokeLinejoin: 'round', strokeWidth: 1.6 }),
      h('path', { d: 'M14 2v6h6', stroke: 'currentColor', strokeLinejoin: 'round', strokeWidth: 1.6 })))
}
/* Session-header mobile controls: the whale (drawer toggle) + file button at
   the phone column's top-left; CSS hides them outside mobile. The drawer
   scrim is drawn by AppFrame (its sibling) so it stacks between page and
   drawer. */
export function MobileHeaderControls() {
  const { drawerOpen } = useMobile()
  return h('div', { className: 'dsh-ws-mobile-controls' },
    h(MobileWhaleButton, { onToggle: () => setDrawerOpen(!drawerOpen), open: drawerOpen }),
    h(MobileFilesButton))
}
/* The hero-page whale + file button, rendered in the shell.overlay seat for
   the blank-session hero (no session header there). Visible only under the
   mobile gate + hero page (CSS :has gate). */
export function MobileHeroControls() {
  const { drawerOpen } = useMobile()
  return h('div', { className: 'dsh-ws-mobile-hero' },
    h(MobileWhaleButton, { onToggle: () => setDrawerOpen(!drawerOpen), open: drawerOpen }),
    h(MobileFilesButton))
}