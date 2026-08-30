/** Dismiss a floating menu on outside press/context, Escape, resize or scroll. */
import { useEffect } from 'react'

/* Shared by every context menu and the encoding menu — replaces four
   near-identical effects that used to live inside WorkspaceExplorer. */
export function useDismissMenu(menuRef, isOpen, onClose) {
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
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('contextmenu', onContextMenu, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [isOpen, menuRef, onClose])
}
