/* The configured models behind the AI-summary picker.
 *
 * Shared by the settings card and the map view (the toolbar's model picker) — hence hooks/ rather than
 * components/settings.js: a renderer feature importing the settings PAGE module was a backwards
 * dependency (the page owns layout and DOM filtering, none of which a picker needs). The fetch itself
 * is de-duplicated and cached in api.js.
 *
 * Degrades to an empty list: a Host without the route, or an unavailable provider, must leave the
 * picker empty rather than break the surface that renders it.
 */
import { useEffect, useState } from 'react'
import { fetchMindmapModels } from '../api.js'

export function useMindmapSummaryModels() {
  const [summaryModels, setSummaryModels] = useState(null) // null = loading; { available, models } after
  useEffect(() => {
    let cancelled = false
    fetchMindmapModels()
      .then((payload) => { if (!cancelled) setSummaryModels(payload) })
      .catch(() => { if (!cancelled) setSummaryModels({ available: false, models: [] }) })
    return () => { cancelled = true }
  }, [])
  return summaryModels
}
