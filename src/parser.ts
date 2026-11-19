import type { ActionsQuotaSnapshot, BillingContext, DailyUsageItem, SkuBreakdown } from './protocol'

export type RawDiscount = {
  currentAmount?: number
  targetAmount?: number
  percentage?: number
  targets?: { id?: string; type?: string }[]
}

export type RawUsageEntry = {
  grossAmount?: number
  discountAmount?: number
  netAmount?: number
  quantity?: number
  appliedCostPerQuantity?: number
  sku?: string
  friendlySkuName?: string
  usageAt?: string
  unitType?: string
}

export type RawBillingPayload = {
  authenticated: boolean
  contextId?: string
  availableContexts?: BillingContext[]
  customer?: {
    displayId?: string
    name?: string
    plan?: string
  } | null
  discounts?: RawDiscount[]
  usage?: RawUsageEntry[]
  fetchedAt?: number
  error?: string
}

const PLAN_LABELS: Record<string, string> = {
  free_user: 'GitHub Free',
  free_organization: 'GitHub Free (Org)',
  pro: 'GitHub Pro',
  team: 'GitHub Team',
  business: 'GitHub Team',
  enterprise: 'GitHub Enterprise'
}

const DEFAULT_LINUX_RATE = 0.006
const STORAGE_DOLLARS_PER_GB = 0.25

export function computeDaysUntilReset(now: Date = new Date()): number {
  const nextMonthUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.max(1, Math.round((nextMonthUtc - todayUtc) / 86_400_000))
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function findDiscountBySku(discounts: RawDiscount[], skuId: string): RawDiscount | undefined {
  return discounts.find((d) => d.targets?.some((t) => t.id === skuId))
}

export function parseQuotaSnapshot(raw: RawBillingPayload, now: Date = new Date()): ActionsQuotaSnapshot {
  const fetchedAt = raw.fetchedAt ?? now.getTime()
  const contextId = raw.contextId ?? 'personal'
  const availableContexts = raw.availableContexts ?? []

  if (!raw.authenticated) {
    return {
      authenticated: false,
      contextId,
      availableContexts,
      account: null,
      compute: {
        usedMinutes: 0,
        includedMinutes: 2000,
        remainingMinutes: 2000,
        percentUsed: 0,
        percentRemaining: 100,
        usedDollars: 0,
        includedDollars: 12,
        remainingDollars: 12,
        grossDollars: 0,
        discountDollars: 0,
        billableDollars: 0
      },
      storage: {
        usedGb: 0,
        includedGb: 0.5,
        percentUsed: 0
      },
      daysUntilReset: computeDaysUntilReset(now),
      bySku: [],
      dailyUsage: [],
      fetchedAt,
      ...(raw.error ? { error: raw.error } : {})
    }
  }

  const discounts = raw.discounts ?? []
  const usage = raw.usage ?? []

  const computeDiscount = findDiscountBySku(discounts, 'actions_linux')
  const storageDiscount = findDiscountBySku(discounts, 'actions_storage')

  const linuxSample = usage.find(
    (u) => u.sku === 'actions_linux' && typeof u.appliedCostPerQuantity === 'number' && u.appliedCostPerQuantity > 0
  )
  const linuxRate = linuxSample?.appliedCostPerQuantity ?? DEFAULT_LINUX_RATE

  const includedDollars = computeDiscount?.targetAmount ?? 12
  const usedDollars = computeDiscount?.currentAmount ?? 0
  const remainingDollars = Math.max(0, includedDollars - usedDollars)

  const minuteEntries = usage.filter((u) => u.unitType === 'Minutes')
  const exactMinutesUsed = minuteEntries.reduce((sum, u) => sum + (u.quantity ?? 0), 0)
  const equivalentMinutesUsed = usedDollars / linuxRate

  const includedMinutes = Math.round(includedDollars / linuxRate)
  const usedMinutes = roundTo(Math.max(exactMinutesUsed, equivalentMinutesUsed), 1)
  const remainingMinutes = Math.max(0, Math.round(remainingDollars / linuxRate))

  const percentUsed = includedDollars > 0 ? Math.min(100, roundTo((usedDollars / includedDollars) * 100, 1)) : 0
  const percentRemaining = Math.max(0, roundTo(100 - percentUsed, 1))

  const grossDollars = roundTo(
    usage.reduce((sum, u) => sum + (u.grossAmount ?? 0), 0),
    4
  )
  const discountDollars = roundTo(
    usage.reduce((sum, u) => sum + (u.discountAmount ?? 0), 0),
    4
  )
  const billableDollars = roundTo(
    usage.reduce((sum, u) => sum + (u.netAmount ?? 0), 0),
    4
  )

  const storageIncludedDollars = storageDiscount?.targetAmount ?? 0.125
  const storageUsedDollars = storageDiscount?.currentAmount ?? 0
  const storageIncludedGb = roundTo(storageIncludedDollars / STORAGE_DOLLARS_PER_GB, 2)
  const storageUsedGb = roundTo(storageUsedDollars / STORAGE_DOLLARS_PER_GB, 3)
  const storagePercentUsed =
    storageIncludedDollars > 0
      ? Math.min(100, roundTo((storageUsedDollars / storageIncludedDollars) * 100, 1))
      : 0

  const skuMap = new Map<string, SkuBreakdown>()
  for (const entry of minuteEntries) {
    const sku = entry.sku ?? 'unknown'
    const existing = skuMap.get(sku) ?? {
      sku,
      label: entry.friendlySkuName ?? sku,
      minutes: 0,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0
    }
    existing.minutes = roundTo(existing.minutes + (entry.quantity ?? 0), 2)
    existing.grossAmount = roundTo(existing.grossAmount + (entry.grossAmount ?? 0), 4)
    existing.discountAmount = roundTo(existing.discountAmount + (entry.discountAmount ?? 0), 4)
    existing.netAmount = roundTo(existing.netAmount + (entry.netAmount ?? 0), 4)
    skuMap.set(sku, existing)
  }

  const dailyUsage: DailyUsageItem[] = usage
    .filter((u) => (u.quantity ?? 0) > 0 && u.unitType === 'Minutes')
    .map((u) => ({
      date: (u.usageAt ?? '').slice(0, 10),
      sku: u.sku ?? 'unknown',
      label: u.friendlySkuName ?? u.sku ?? 'Actions',
      quantity: roundTo(u.quantity ?? 0, 2),
      unitType: u.unitType ?? 'Minutes',
      grossAmount: roundTo(u.grossAmount ?? 0, 4),
      discountAmount: roundTo(u.discountAmount ?? 0, 4),
      netAmount: roundTo(u.netAmount ?? 0, 4)
    }))
    .sort((a, b) => b.date.localeCompare(a.date))

  const rawPlan = raw.customer?.plan ?? ''
  const plan = PLAN_LABELS[rawPlan] ?? (rawPlan || 'GitHub')

  return {
    authenticated: true,
    contextId,
    availableContexts,
    account: raw.customer?.displayId
      ? {
          login: raw.customer.displayId,
          name: raw.customer.name ?? raw.customer.displayId,
          plan
        }
      : null,
    compute: {
      usedMinutes,
      includedMinutes,
      remainingMinutes,
      percentUsed,
      percentRemaining,
      usedDollars: roundTo(usedDollars, 4),
      includedDollars: roundTo(includedDollars, 2),
      remainingDollars: roundTo(remainingDollars, 4),
      grossDollars,
      discountDollars,
      billableDollars
    },
    storage: {
      usedGb: storageUsedGb,
      includedGb: storageIncludedGb,
      percentUsed: storagePercentUsed
    },
    daysUntilReset: computeDaysUntilReset(now),
    bySku: Array.from(skuMap.values()).sort((a, b) => b.minutes - a.minutes),
    dailyUsage,
    fetchedAt,
    ...(raw.error ? { error: raw.error } : {})
  }
}
