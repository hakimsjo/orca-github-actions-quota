import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { OrcaWorkerApi } from 'orca/worker'
import { parseQuotaSnapshot, type RawBillingPayload } from './parser'
import type { ActionsQuotaSnapshot, QuotaResponse } from './protocol'

const execFileAsync = promisify(execFile)

const SELECTED_CONTEXT_KEY = 'quota:selectedContext'
const CACHE_PREFIX = 'quota:latest:'
const AUTO_REFRESH_AGE_MS = 60 * 60 * 1000 // 1 hour

const ORCA_CLI_CANDIDATES = [
  process.env.ORCA_CLI_PATH,
  '/Applications/Orca.app/Contents/Resources/bin/orca',
  'orca'
].filter((p): p is string => Boolean(p))

function resolveOrcaCli(): string {
  for (const candidate of ORCA_CLI_CANDIDATES) {
    if (candidate === 'orca' || existsSync(candidate)) {
      return candidate
    }
  }
  return 'orca'
}

async function runOrcaCli(args: string[], timeoutMs = 20_000): Promise<unknown> {
  const cli = resolveOrcaCli()
  try {
    const { stdout } = await execFileAsync(cli, [...args, '--json'], {
      cwd: tmpdir(),
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024
    })
    const parsed = JSON.parse(stdout) as { ok?: boolean; result?: unknown; error?: { message?: string } }
    if (parsed && parsed.ok === false) {
      throw new Error(parsed.error?.message ?? 'Orca CLI returned an error')
    }
    return parsed?.result ?? parsed
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    if (e.stdout) {
      try {
        const parsed = JSON.parse(e.stdout) as { error?: { message?: string } }
        if (parsed?.error?.message) throw new Error(parsed.error.message)
      } catch (inner) {
        if (inner instanceof Error && inner.message !== e.message && !inner.message.includes('JSON')) {
          throw inner
        }
      }
    }
    if (e.stderr?.trim()) {
      throw new Error(e.stderr.trim().split('\n')[0])
    }
    throw new Error(`Orca CLI (${args.slice(0, 2).join(' ')}) misslyckades.`)
  }
}

function billingUrlForContext(contextId: string): string {
  return contextId === 'personal'
    ? 'https://github.com/settings/billing'
    : `https://github.com/organizations/${encodeURIComponent(contextId)}/settings/billing`
}

function buildBrowserEvalScript(contextId: string, month: number, year: number): string {
  const billingPath =
    contextId === 'personal' ? '/settings/billing' : `/organizations/${encodeURIComponent(contextId)}/settings/billing`

  return `(async () => {
    if (location.pathname.startsWith('/login') || location.pathname.startsWith('/sessions')) {
      return JSON.stringify({ authenticated: false, contextId: ${JSON.stringify(contextId)} });
    }

    const extractCustomer = (html) => {
      const re = /<script[^>]*type="application\\/json"[^>]*>([\\s\\S]*?)<\\/script>/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        if (m[1].includes('"customer"') && m[1].includes('"displayId"')) {
          try {
            const data = JSON.parse(m[1]);
            if (data && data.payload && data.payload.customer) {
              return data.payload.customer;
            }
          } catch {}
        }
      }
      return null;
    };

    let customer = null;
    if (location.pathname === ${JSON.stringify(billingPath)}) {
      for (const script of document.querySelectorAll('script[type="application/json"]')) {
        const txt = script.textContent || '';
        if (txt.includes('"customer"') && txt.includes('"displayId"')) {
          try {
            const data = JSON.parse(txt);
            if (data && data.payload && data.payload.customer) {
              customer = data.payload.customer;
              break;
            }
          } catch {}
        }
      }
    }

    const [targetRes, orgsRes, personalRes] = await Promise.all([
      customer ? Promise.resolve(null) : fetch('https://github.com' + ${JSON.stringify(billingPath)}, { credentials: 'include' }),
      fetch('https://github.com/settings/organizations', { credentials: 'include' }),
      ${contextId === 'personal' ? 'Promise.resolve(null)' : "fetch('https://github.com/settings/billing', { credentials: 'include' })"}
    ]);

    if (targetRes) {
      if (!targetRes.ok || targetRes.url.includes('/login') || targetRes.url.includes('/sessions')) {
        return JSON.stringify({ authenticated: false, contextId: ${JSON.stringify(contextId)} });
      }
      customer = extractCustomer(await targetRes.text());
    }

    if (!customer) {
      return JSON.stringify({ authenticated: false, contextId: ${JSON.stringify(contextId)} });
    }

    let personalLogin = ${contextId === 'personal' ? 'customer.displayId' : 'null'};
    if (personalRes && personalRes.ok) {
      const personalCustomer = extractCustomer(await personalRes.text());
      if (personalCustomer && personalCustomer.displayId) {
        personalLogin = personalCustomer.displayId;
      }
    }

    const availableContexts = [
      {
        id: 'personal',
        label: personalLogin ? personalLogin + ' (Personligt)' : 'Personligt konto',
        kind: 'personal'
      }
    ];

    if (orgsRes && orgsRes.ok) {
      const orgsHtml = await orgsRes.text();
      const seen = new Set();
      const orgRe = /href="\\/organizations\\/([^/"?#]+)\\/settings\\/profile"/g;
      let om;
      while ((om = orgRe.exec(orgsHtml)) !== null) {
        const slug = decodeURIComponent(om[1]);
        if (!seen.has(slug)) {
          seen.add(slug);
          availableContexts.push({ id: slug, label: slug, kind: 'organization' });
        }
      }
    }

    const headers = { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    const [discRes, netRes] = await Promise.all([
      fetch(${JSON.stringify(billingPath)} + '/discounts?month=${month}&year=${year}&reloadKey=0&filter_included_usage=true', { credentials: 'include', headers }),
      fetch(${JSON.stringify(billingPath)} + '/net_usage?group=0&period=3&product=actions&sku=&query=', { credentials: 'include', headers })
    ]);
    const discJson = discRes.ok ? await discRes.json() : { discounts: [] };
    const netJson = netRes.ok ? await netRes.json() : { usage: [] };

    return JSON.stringify({
      authenticated: true,
      contextId: ${JSON.stringify(contextId)},
      availableContexts,
      customer: {
        displayId: customer.displayId,
        name: customer.name,
        plan: customer.plan
      },
      discounts: Array.isArray(discJson.discounts) ? discJson.discounts : [],
      usage: Array.isArray(netJson.usage) ? netJson.usage : [],
      fetchedAt: Date.now()
    });
  })()`
}

async function resolveWorkspaceSelector(): Promise<string> {
  const ps = (await runOrcaCli(['worktree', 'ps'])) as {
    worktrees?: { worktreeId?: string; identity?: { key?: string } }[]
  }
  const first = ps?.worktrees?.[0]
  if (first?.identity?.key) return `identity:${first.identity.key}`
  if (first?.worktreeId) return `id:${first.worktreeId}`
  return 'active'
}

async function fetchRawFromOrcaBrowser(orca: OrcaWorkerApi, contextId: string): Promise<RawBillingPayload> {
  const selector = await resolveWorkspaceSelector()
  const tabListResult = (await runOrcaCli(['tab', 'list', '--worktree', selector])) as {
    tabs?: { browserPageId?: string; url?: string }[]
  }
  const existingGitHubTab = tabListResult?.tabs?.find(
    (t) =>
      typeof t.url === 'string' &&
      t.url.startsWith('https://github.com/') &&
      !t.url.includes('/login') &&
      !t.url.includes('/sessions')
  )

  let pageId = existingGitHubTab?.browserPageId
  let createdTempTab = false

  if (!pageId) {
    const targetUrl = billingUrlForContext(contextId)
    orca.log(`Opening temporary GitHub tab (${targetUrl}) with selector=${selector}`)
    const created = (await runOrcaCli(
      ['tab', 'create', '--worktree', selector, '--url', targetUrl],
      25_000
    )) as {
      browserPageId?: string
    }
    pageId = created?.browserPageId
    createdTempTab = true
  }

  if (!pageId) {
    throw new Error('Kunde inte öppna en GitHub-flik i Orcas webbläsare.')
  }

  try {
    const now = new Date()
    const script = buildBrowserEvalScript(contextId, now.getUTCMonth() + 1, now.getUTCFullYear())
    const evalResult = (await runOrcaCli(['eval', '--page', pageId, '--expression', script], 20_000)) as {
      result?: string
    }
    if (!evalResult?.result) {
      throw new Error('Fick inget svar från GitHub-sessionen i Orca.')
    }
    return JSON.parse(evalResult.result) as RawBillingPayload
  } finally {
    if (createdTempTab) {
      await runOrcaCli(['tab', 'close', '--page', pageId]).catch((err) => {
        orca.log(`Failed to close temporary tab ${pageId}: ${String(err)}`)
      })
    }
  }
}

async function updateStatusBar(orca: OrcaWorkerApi, snapshot: ActionsQuotaSnapshot | null): Promise<void> {
  if (!orca.host.has('statusBar.update')) return

  if (!snapshot) {
    await orca.host.call('statusBar.update', {
      id: 'quota',
      text: 'Actions: —',
      icon: 'zap',
      tone: 'neutral',
      tooltip: 'GitHub Actions: klicka för att hämta'
    })
    return
  }

  if (!snapshot.authenticated) {
    await orca.host.call('statusBar.update', {
      id: 'quota',
      text: 'Actions: Ej inloggad',
      icon: 'warning',
      tone: 'warning',
      tooltip: 'Logga in på GitHub i Orcas webbläsare för att se Actions-tid'
    })
    return
  }

  const { remainingMinutes, includedMinutes, percentUsed, percentRemaining } = snapshot.compute
  const tone = percentUsed >= 90 ? 'danger' : percentUsed >= 75 ? 'warning' : 'success'
  const label = snapshot.account?.login ?? 'GitHub'
  await orca.host.call('statusBar.update', {
    id: 'quota',
    text: `${label}: ${remainingMinutes.toLocaleString('sv-SE')}m kvar`,
    icon: 'zap',
    tone,
    tooltip: `GitHub Actions (${label}): ${remainingMinutes} av ${includedMinutes} min kvar (${percentRemaining}%)`
  })
}

async function readSelectedContext(orca: OrcaWorkerApi): Promise<string> {
  const stored = await orca.storage.get(SELECTED_CONTEXT_KEY)
  return typeof stored === 'string' && stored.length > 0 ? stored : 'personal'
}

async function readCachedSnapshot(orca: OrcaWorkerApi, contextId: string): Promise<ActionsQuotaSnapshot | null> {
  const stored = await orca.storage.get(`${CACHE_PREFIX}${contextId}`)
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return stored as unknown as ActionsQuotaSnapshot
  }
  return null
}

export default function activate(orca: OrcaWorkerApi): void {
  const inFlightByContext = new Map<string, Promise<QuotaResponse>>()

  async function refreshQuota(contextId: string): Promise<QuotaResponse> {
    const existing = inFlightByContext.get(contextId)
    if (existing) return existing

    const task = (async () => {
      const cached = await readCachedSnapshot(orca, contextId)
      orca.panels.post('quota.updated', {
        snapshot: cached,
        refreshing: true,
        selectedContextId: contextId
      })

      try {
        const raw = await fetchRawFromOrcaBrowser(orca, contextId)
        const snapshot = parseQuotaSnapshot(raw)
        await orca.storage.set(`${CACHE_PREFIX}${contextId}`, snapshot as unknown as import('orca/worker').JsonValue)
        const activeContext = await readSelectedContext(orca)
        if (activeContext === contextId) {
          await updateStatusBar(orca, snapshot)
        }
        const response: QuotaResponse = {
          snapshot,
          refreshing: false,
          selectedContextId: contextId
        }
        orca.panels.post('quota.updated', response)
        return response
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        orca.log(`Refresh failed (${contextId}): ${message}`)
        const fallback: ActionsQuotaSnapshot = cached
          ? { ...cached, error: message }
          : {
              ...parseQuotaSnapshot({ authenticated: false, contextId, error: message }),
              error: message
            }
        const response: QuotaResponse = {
          snapshot: fallback,
          refreshing: false,
          selectedContextId: contextId
        }
        orca.panels.post('quota.updated', response)
        return response
      } finally {
        inFlightByContext.delete(contextId)
      }
    })()

    inFlightByContext.set(contextId, task)
    return task
  }

  orca.panels.handle('quota.get', async (input) => {
    const contextId = input?.contextId ?? (await readSelectedContext(orca))
    const cached = await readCachedSnapshot(orca, contextId)
    const isStale = !cached || Date.now() - cached.fetchedAt > AUTO_REFRESH_AGE_MS
    if (isStale && !inFlightByContext.has(contextId)) {
      void refreshQuota(contextId)
    }
    return {
      snapshot: cached,
      refreshing: inFlightByContext.has(contextId) || isStale,
      selectedContextId: contextId
    }
  })

  orca.panels.handle('quota.refresh', async (input) => {
    const contextId = input?.contextId ?? (await readSelectedContext(orca))
    return refreshQuota(contextId)
  })

  orca.panels.handle('quota.selectContext', async ({ contextId }) => {
    await orca.storage.set(SELECTED_CONTEXT_KEY, contextId)
    const cached = await readCachedSnapshot(orca, contextId)
    await updateStatusBar(orca, cached)
    const isStale = !cached || Date.now() - cached.fetchedAt > AUTO_REFRESH_AGE_MS
    if (isStale && !inFlightByContext.has(contextId)) {
      void refreshQuota(contextId)
    }
    const response: QuotaResponse = {
      snapshot: cached,
      refreshing: inFlightByContext.has(contextId) || isStale,
      selectedContextId: contextId
    }
    orca.panels.post('quota.updated', response)
    return response
  })

  orca.panels.handle('quota.openLogin', async () => {
    const selector = await resolveWorkspaceSelector()
    const tabList = (await runOrcaCli(['tab', 'list', '--worktree', selector])) as {
      tabs?: { browserPageId?: string; url?: string }[]
    }
    let pageId = tabList?.tabs?.find((t) => typeof t.url === 'string' && t.url.includes('github.com/login'))
      ?.browserPageId

    if (!pageId) {
      const created = (await runOrcaCli(
        ['tab', 'create', '--worktree', selector, '--url', 'https://github.com/login'],
        25_000
      )) as { browserPageId?: string }
      pageId = created?.browserPageId
    }

    if (pageId) {
      await runOrcaCli(['tab', 'switch', '--worktree', selector, '--page', pageId]).catch(() => {})
    }
    return { opened: Boolean(pageId) }
  })

  void (async () => {
    const contextId = await readSelectedContext(orca)
    const cached = await readCachedSnapshot(orca, contextId)
    await updateStatusBar(orca, cached)
  })()
}
