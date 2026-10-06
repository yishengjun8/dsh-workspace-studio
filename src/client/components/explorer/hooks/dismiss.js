/** Dismiss a floating menu on outside press/context, Escape, resize or scroll. */
import { useEffect } from 'react'
import { dismissesMenuOnScroll } from '../../../menu-dismiss.js'

/* Shared by every context menu and the encoding menu. `anchorRef` names the
   element (or scrolling region) the menu points at: only a scroll that owns it
   dismisses the menu — the conversation's streaming tail follow must not close a
   menu opened on the sidebar or the preview pane (menu-dismiss.js). */
export function useDismissMenu(menuRef, isOpen, onClose, anchorRef) {
  useEffect(() => {
    if (!isOpen) return undefined
    const inside = event => {
      const node = menuRef.current
      return node !== null && event.target instanceof Node && node.contains(event.target)
    }
    const close = () => onClose()
    const onPointerDown = event => { if (!inside(event)) close() }
    const onContextMenu = event => { if (!inside(event)) close() }
    const onKeyDown = event => { if (event.key === 'Escape') close() }
    const onScroll = event => { if (dismissesMenuOnScroll(event, anchorRef?.current ?? null)) close() }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('contextmenu', onContextMenu, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [anchorRef, isOpen, menuRef, onClose])
}
