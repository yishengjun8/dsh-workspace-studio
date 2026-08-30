/** Chat drop mask: track file drags over the chat pane (capture phase,
 *  without stopping propagation, so the harness composer still receives the
 *  drop and attaches images as usual). The mask covers only the chat pane;
 *  the harness's full-viewport mask is hidden by CSS. Closing the mask
 *  suppresses it for the current drag until it ends or is dropped. */
import { useEffect, useRef, useState } from 'react'
import { hasDraggedFiles } from '../utils.js'

export function useChatDropMask({ chatSectionRef }) {
  const [chatDropActive, setChatDropActive] = useState(false)
  const chatDropSuppressed = useRef(false)
  useEffect(() => {
    const section = chatSectionRef.current
    if (section === null) return undefined
    let depth = 0
    const hide = () => {
      depth = 0
      chatDropSuppressed.current = false
      setChatDropActive(false)
    }
    const onDragEnter = (event) => {
      if (!hasDraggedFiles(event)) return
      if (chatDropSuppressed.current) return
      depth += 1
      setChatDropActive(true)
    }
    const onDragOver = (event) => {
      if (!hasDraggedFiles(event)) return
      if (chatDropSuppressed.current) return
      setChatDropActive(true)
    }
    const onDragLeave = (event) => {
      if (!hasDraggedFiles(event)) return
      if (chatDropSuppressed.current) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) hide()
    }
    const onDrop = () => { hide() }
    const onDragEnd = () => { hide() }
    section.addEventListener('dragenter', onDragEnter, true)
    section.addEventListener('dragover', onDragOver, true)
    section.addEventListener('dragleave', onDragLeave, true)
    section.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      section.removeEventListener('dragenter', onDragEnter, true)
      section.removeEventListener('dragover', onDragOver, true)
      section.removeEventListener('dragleave', onDragLeave, true)
      section.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [])
  return { chatDropActive, chatDropSuppressed, setChatDropActive }
}
