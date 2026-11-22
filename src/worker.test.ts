import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { parseQuotaSnapshot } from './parser'
import * as main from './worker'

test('parseQuotaSnapshot computes remaining minutes and storage from GitHub billing payload', () => {
  const now = new Date('2026-11-19T12:00:00Z')
  const snapshot = parseQuotaSnapshot(
    {
      authenticated: true,
      contextId: 'acme-org',
      availableContexts: [
        { id: 'personal', label: 'octocat (Personligt)', kind: 'personal' },
        { id: 'acme-org', label: 'acme-org', kind: 'organization' }
      ],
      customer: { displayId: 'acme-org', name: 'Acme Org', plan: 'free_organization' },
      discounts: [
        { currentAmount: 5.308, targetAmount: 12, targets: [{ id: 'actions_linux' }] },
        { currentAmount: 0, targetAmount: 0.125, targets: [{ id: 'actions_storage' }] }
      ],
      usage: [
        {
          sku: 'actions_linux',
          friendlySkuName: 'Actions Linux',
          unitType: 'Minutes',
          quantity: 100,
          grossAmount: 0.6,
          discountAmount: 0.6,
          netAmount: 0,
          appliedCostPerQuantity: 0.006,
          usageAt: '2026-11-19T03:44:28.247Z'
        }
      ],
      fetchedAt: now.getTime()
    },
    now
  )

  assert.equal(snapshot.authenticated, true)
  assert.equal(snapshot.contextId, 'acme-org')
  assert.equal(snapshot.account?.login, 'acme-org')
  assert.equal(snapshot.account?.plan, 'GitHub Free (Org)')
  assert.equal(snapshot.compute.includedMinutes, 2000)
  assert.equal(snapshot.compute.remainingMinutes, 1115)
  assert.equal(snapshot.storage.includedGb, 0.5)
  assert.equal(snapshot.daysUntilReset, 12)
  assert.equal(snapshot.bySku.length, 1)
})

test('worker returns fresh cached snapshot and switches context on quota.selectContext', async () => {
  const orgSnapshot = parseQuotaSnapshot(
    {
      authenticated: true,
      contextId: 'acme-org',
      availableContexts: [
        { id: 'personal', label: 'octocat (Personligt)', kind: 'personal' },
        { id: 'acme-org', label: 'acme-org', kind: 'organization' }
      ],
      customer: { displayId: 'acme-org', name: 'Acme Org', plan: 'free_organization' },
      discounts: [{ currentAmount: 5.308, targetAmount: 12, targets: [{ id: 'actions_linux' }] }],
      usage: [],
      fetchedAt: Date.now()
    },
    new Date()
  )

  const host = mockHost({
    storage: {
      'quota:selectedContext': 'personal',
      'quota:latest:acme-org': orgSnapshot
    }
  })
  const worker = await mountWorker(main, { host })
  const switched = await worker.request('quota.selectContext', { contextId: 'acme-org' })
  assert.equal(switched.selectedContextId, 'acme-org')
  assert.equal(switched.refreshing, false)
  assert.equal(switched.snapshot?.compute.remainingMinutes, 1115)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('pickPreferredWorktreeSelector prefers active worktree over inactive first entry', () => {
  assert.equal(
    main.pickPreferredWorktreeSelector([
      { worktreeId: 'repo::/Users/me', isActive: false },
      { worktreeId: 'repo::/Users/me::workspace:123', isActive: true }
    ]),
    'id:repo::/Users/me::workspace:123'
  )
  assert.equal(
    main.pickPreferredWorktreeSelector([
      { worktreeId: 'repo::/Users/me', isActive: false, identity: { key: 'k1' } }
    ]),
    'identity:k1'
  )
  assert.equal(main.pickPreferredWorktreeSelector([]), 'active')
})
