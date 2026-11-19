export {}

export type BillingContext = {
  id: string
  label: string
  kind: 'personal' | 'organization'
}

export type SkuBreakdown = {
  sku: string
  label: string
  minutes: number
  grossAmount: number
  discountAmount: number
  netAmount: number
}

export type DailyUsageItem = {
  date: string
  sku: string
  label: string
  quantity: number
  unitType: string
  grossAmount: number
  discountAmount: number
  netAmount: number
}

export type ActionsQuotaSnapshot = {
  authenticated: boolean
  contextId: string
  availableContexts: BillingContext[]
  account: {
    login: string
    name: string
    plan: string
  } | null
  compute: {
    usedMinutes: number
    includedMinutes: number
    remainingMinutes: number
    percentUsed: number
    percentRemaining: number
    usedDollars: number
    includedDollars: number
    remainingDollars: number
    grossDollars: number
    discountDollars: number
    billableDollars: number
  }
  storage: {
    usedGb: number
    includedGb: number
    percentUsed: number
  }
  daysUntilReset: number
  bySku: SkuBreakdown[]
  dailyUsage: DailyUsageItem[]
  fetchedAt: number
  error?: string
}

export type QuotaResponse = {
  snapshot: ActionsQuotaSnapshot | null
  refreshing: boolean
  selectedContextId: string
}

declare module 'orca' {
  interface PluginRequests {
    /** Returns the cached GitHub Actions quota snapshot for the selected context. */
    'quota.get': { input?: { contextId?: string }; output: QuotaResponse }
    /** Fetches fresh GitHub Actions quota from Orca's GitHub browser session. */
    'quota.refresh': { input?: { contextId?: string }; output: QuotaResponse }
    /** Switches the active billing context (personal account or organization). */
    'quota.selectContext': { input: { contextId: string }; output: QuotaResponse }
    /** Opens GitHub sign-in in Orca's browser. */
    'quota.openLogin': { output: { opened: boolean } }
  }

  interface PluginPanelEvents {
    /** Posted whenever the quota snapshot, selected context, or refreshing state changes. */
    'quota.updated': QuotaResponse
  }
}
