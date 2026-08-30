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
    const runSearch=useCallback(async(query)=>{searchController.current?.abort();if(query.trim()===''){setSearchState({state:'idle'});setSearchExpanded(new Set());return}const controller=new AbortController();searchController.current=controller;setSearchState({state:'searching'});try{const result=await requestSearch(workspaceId,query,searchCaseSensitive,searchNameOnly,controller.signal);if(searchController.current===controller){setSearchState({state:'done',result});setSearchExpanded(new Set((settings.expandSearchMatches ?? SEARCH_MATCH_EXPAND_DEFAULT)?result.files.map(file=>file.path):[]))}}catch(error){if(error?.name==='AbortError')return;if(searchController.current===controller)setSearchState({state:'error',message:error instanceof Error?error.message:String(error)})}},[searchCaseSensitive,searchNameOnly,settings.expandSearchMatches,workspaceId])
  const closeSearch=useCallback(()=>{searchController.current?.abort();searchController.current=undefined;setSearchExpanded(new Set());setSearchOpen(false)},[])
    const toggleSearchFile=useCallback((path)=>{setSearchExpanded(prev=>{const next=new Set(prev);if(next.has(path))next.delete(path);else next.add(path);return next})},[])
  /* Debounced search while the panel is open. */
  useEffect(() => {
    if (!searchOpen) return undefined
    const timer = setTimeout(() => { void runSearch(searchQuery) }, 300)
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
