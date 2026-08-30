/** Session rename dialog state and submission. */
import { useCallback, useState } from 'react'

export function useSessionRename({ sessionId, sessionTitle, renameSession, mounted }) {
  const [sessionRenameOpen, setSessionRenameOpen] = useState(false)
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [sessionRenameBusy, setSessionRenameBusy] = useState(false)
  const [sessionRenameError, setSessionRenameError] = useState()
  const beginSessionRename = useCallback(() => {
    setSessionRenameDraft(sessionTitle ?? '')
    setSessionRenameError(undefined)
    setSessionRenameOpen(true)
  }, [sessionTitle])
    const closeSessionRename=useCallback(()=>{if(sessionRenameBusy)return;setSessionRenameOpen(false);setSessionRenameDraft('');setSessionRenameError(undefined)},[sessionRenameBusy])
    const confirmSessionRename=useCallback(()=>{if(sessionRenameBusy||sessionId===undefined)return;const trimmed=sessionRenameDraft.trim();if(trimmed==='')return;setSessionRenameBusy(true);setSessionRenameError(undefined);renameSession(String(sessionId),trimmed).then(()=>{if(!mounted.current)return;setSessionRenameBusy(false);setSessionRenameOpen(false);setSessionRenameDraft('')}).catch(error=>{if(!mounted.current)return;setSessionRenameBusy(false);setSessionRenameError(error instanceof Error?error.message:String(error))})},[renameSession,sessionId,sessionRenameBusy,sessionRenameDraft])
  return { sessionRenameOpen, setSessionRenameOpen, sessionRenameDraft, setSessionRenameDraft, sessionRenameBusy, sessionRenameError, setSessionRenameError, beginSessionRename, closeSessionRename, confirmSessionRename }
}
