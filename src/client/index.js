import { mountStudio } from './app.js'

export const inject = ['slots', 'theme', 'sessions', 'workspaces']
export function apply(ctx) {
  mountStudio(ctx)
}
