/**
 * Automations API ("whenever a bookmark is added, if …, do …").
 * Smart boards show up here too, with `boardId` set.
 */
export type AutomationCondition = {
  field: 'url' | 'domain' | 'title' | 'type' | 'tag' | 'ai_topic'
  op: 'contains' | 'not_contains' | 'is' | 'is_not'
  value?: string
  topics?: string[]
  threshold?: number
}

export type AutomationAction = {
  type: 'add_tag' | 'add_to_board' | 'read_later' | 'webhook'
  tag?: string
  boardId?: string
  url?: string
  body?: string
}

export type Automation = {
  id?: string
  name: string
  enabled: boolean
  match: 'all' | 'any'
  conditions: AutomationCondition[]
  actions: AutomationAction[]
  boardId?: string | null
  secret?: string
  runCount?: number
  lastRunAt?: string | null
}

export const useAutomations = () => {
  const { backendFetch } = useBackendFetch()

  const fetchAutomations = () =>
    backendFetch<{ success: boolean; automations: Automation[] }>('automations')

  const saveAutomation = (automation: Automation) => {
    const { id, name, enabled, match, conditions, actions } = automation
    const body = { name, enabled, match, conditions, actions }
    return id
      ? backendFetch<{ success: boolean; automation: Automation }>(`automations/${id}`, { method: 'PATCH', body })
      : backendFetch<{ success: boolean; automation: Automation }>('automations', { method: 'POST', body })
  }

  const setAutomationEnabled = (id: string, enabled: boolean) =>
    backendFetch<{ success: boolean; automation: Automation }>(`automations/${id}`, { method: 'PATCH', body: { enabled } })

  const deleteAutomation = (id: string) =>
    backendFetch(`automations/${id}`, { method: 'DELETE' })

  return { fetchAutomations, saveAutomation, setAutomationEnabled, deleteAutomation }
}
