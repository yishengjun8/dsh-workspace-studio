/** Search panel state, request lifecycle and debounce. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { SEARCH_MATCH_EXPAND_DEFAULT } from '../../../constants.js'
import { translate } from '../../../locale/index.js'
import { requestSearch } from '../../../api.js'

export function useSearchState({ workspaceId, settings }) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false)
  const [searchNameOnly, setSearchNameOnly] = useState(false)
  const [searchState, setSearchState] = useState({ state: 'idle' })
  const [searchExpanded, setSearchExpanded] = useState(() => new Set())
  const searchController = useRef()
  /* The last query + option combo actually submitted (Enter or the debounce):
     the debounce timer scheduled by the final keystroke must not fire a
     SECOND request for the same combo right after an Enter-submitted one.
     The options join the key so toggling case-sensitivity / name-only after a
     submit RE-RUNS the search instead of being swallowed as "already
     submitted" (the old query-only key skipped the new option silently).
     closeSearch resets the key so reopening the panel and re-typing the same
     query searches again instead of staying on the hint state. */
  const lastSubmittedQueryRef = useRef('')
  const searchComboKey = (query, caseSensitive, nameOnly) => `${query}|${caseSensitive ? 'cs' : ''}|${nameOnly ? 'no' : ''}`
    const runSearch=useCallback(async(query)=>{searchController.current?.abort();if(query.trim()===''){setSearchState({state:'idle'});setSearchExpanded(new Set());return}lastSubmittedQueryRef.current=searchComboKey(query,searchCaseSensitive,searchNameOnly);const controller=new AbortController();searchController.current=controller;setSearchState({state:'searching'});try{const result=await requestSearch(workspaceId,query,searchCaseSensitive,searchNameOnly,controller.signal);if(searchController.current===controller){setSearchState({state:'done',result});setSearchExpanded(new Set((settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT)?result.files.map(file=>file.path):[]))}}catch(error){if(error?.name==='AbortError')return;if(searchController.current===controller)setSearchState({state:'error',message:error instanceof Error?error.message:String(error)})}},[searchCaseSensitive,searchNameOnly,settings.expandSearchMatches,workspaceId])
  const closeSearch=useCallback(()=>{searchController.current?.abort();searchController.current=undefined;setSearchExpanded(new Set());setSearchOpen(false);setSearchQuery('');setSearchState({state:'idle'});lastSubmittedQueryRef.current=''},[])
    const toggleSearchFile=useCallback((path)=>{setSearchExpanded(prev=>{const next=new Set(prev);if(next.has(path))next.delete(path);else next.add(path);return next})},[])
  /* Debounced search while the panel is open. */
  useEffect(() => {
    if (!searchOpen) return undefined
    const timer = setTimeout(() => {
      /* Skip a query+option combo the user already submitted (Enter fires
         runSearch immediately; the keystroke's debounce timer would otherwise
         duplicate the request 300 ms later). Toggling case-sensitivity or
         name-only changes the combo, so the skip only applies to an EXACT
         repeat of the same search. */
      if (lastSubmittedQueryRef.current !== searchComboKey(searchQuery, searchCaseSensitive, searchNameOnly)) void runSearch(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [runSearch, searchOpen, searchQuery])
  useEffect(() => () => {
    searchController.current?.abort()
    searchController.current = undefined
  }, [])
  return {
    searchOpen, setSearchOpen, searchQuery, setSearchQuery,
    searchCaseSensitive, setSearchCaseSensitive, searchNameOnly, setSearchNameOnly,
    searchState, searchExpanded, runSearch, closeSearch, toggleSearchFile,
  }
}
