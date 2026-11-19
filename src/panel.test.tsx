import { assert, mockHost, mount, test } from 'orca/testing'
import { parseQuotaSnapshot } from './parser'
import * as panel from './panel'

test('renders remaining minutes and organization info from worker', async () => {
  const snapshot = parseQuotaSnapshot(
    {
      authenticated: true,
      contextId: 'acme-org',
      availableContexts: [
        { id: 'personal', label: 'octocat (Personligt)', kind: 'personal' },
        { id: 'acme-org', label: 'acme-org', kind: 'organization' }
      ],
      customer: { displayId: 'acme-org', name: 'Acme Org', plan: 'free_organization' },
      discounts: [{ currentAmount: 5.308, targetAmount: 12, targets: [{ id: 'actions_linux' }] }],
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
      fetchedAt: Date.now()
    },
    new Date('2026-11-19T12:00:00Z')
  )

  const host = mockHost({
    requests: {
      'quota.get': () => ({ snapshot, refreshing: false, selectedContextId: 'acme-org' }),
      'quota.refresh': () => ({ snapshot, refreshing: false, selectedContextId: 'acme-org' }),
      'quota.selectContext': () => ({ snapshot, refreshing: false, selectedContextId: 'acme-org' })
    }
  })

  const view = await mount(panel, { host })
  assert.ok(view.find({ text: /1\s?115 min/ }))
  assert.ok(view.find({ text: /GitHub Free \(Org\)/ }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
