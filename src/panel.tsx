import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  EmptyState,
  Grid,
  Heading,
  IconButton,
  KeyValue,
  plugin,
  Progress,
  read,
  RelativeTime,
  Row,
  Select,
  Separator,
  set,
  shell,
  Spinner,
  Stack,
  Tab,
  Table,
  Tabs,
  Text,
  type PanelContext,
  type Tone
} from 'orca'
import type { ActionsQuotaSnapshot } from './protocol'

const snapshotAtom = atom<ActionsQuotaSnapshot | null>(null)
const selectedContextAtom = atom<string>('personal')
const refreshingAtom = atom<boolean>(false)
const activeTabAtom = atom<'overview' | 'history'>('overview', 'overview', { persist: 'plugin' })

function formatNumber(n: number): string {
  return n.toLocaleString('sv-SE')
}

function formatDollars(n: number): string {
  if (n > 0 && n < 0.01) return `<$0.01`
  return `$${n.toFixed(2)}`
}

function quotaTone(percentUsed: number): Tone {
  if (percentUsed >= 90) return 'danger'
  if (percentUsed >= 75) return 'warning'
  return 'success'
}

async function handleRefresh(): Promise<void> {
  if (read(refreshingAtom)) return
  set(refreshingAtom, true)
  try {
    const res = await plugin.request('quota.refresh', { contextId: read(selectedContextAtom) })
    set(snapshotAtom, res.snapshot)
    set(selectedContextAtom, res.selectedContextId)
    set(refreshingAtom, res.refreshing)
  } catch {
    set(refreshingAtom, false)
  }
}

async function handleSelectContext(contextId: string): Promise<void> {
  set(selectedContextAtom, contextId)
  const res = await plugin.request('quota.selectContext', { contextId })
  set(snapshotAtom, res.snapshot)
  set(selectedContextAtom, res.selectedContextId)
  set(refreshingAtom, res.refreshing)
}

async function handleOpenLogin(): Promise<void> {
  await plugin.request('quota.openLogin')
}

async function handleOpenBilling(): Promise<void> {
  const ctx = read(selectedContextAtom)
  const url =
    ctx === 'personal'
      ? 'https://github.com/settings/billing'
      : `https://github.com/organizations/${encodeURIComponent(ctx)}/settings/billing`
  await shell.openExternal(url)
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('quota.updated', (payload) => {
      if (payload.selectedContextId === read(selectedContextAtom)) {
        set(snapshotAtom, payload.snapshot)
        set(refreshingAtom, payload.refreshing)
      }
    })
  )

  void plugin.request('quota.get').then((res) => {
    set(selectedContextAtom, res.selectedContextId)
    set(snapshotAtom, res.snapshot)
    set(refreshingAtom, res.refreshing)
  })
}

function HeaderBar({ snapshot, refreshing }: { snapshot: ActionsQuotaSnapshot | null; refreshing: boolean }) {
  return (
    <Row justify="between" align="center" gap="sm">
      <Stack gap="none">
        <Row gap="xs" align="center">
          <Heading level={2}>GitHub Actions</Heading>
          {snapshot?.account ? <Badge tone="neutral">{snapshot.account.plan}</Badge> : null}
        </Row>
        {snapshot?.account ? (
          <Text muted size="xs">
            {snapshot.account.name} (@{snapshot.account.login})
          </Text>
        ) : (
          <Text muted size="xs">
            Orca GitHub-session
          </Text>
        )}
      </Stack>
      <Row gap="xs" align="center">
        {refreshing ? <Spinner label="Hämtar..." labelHidden /> : null}
        <IconButton
          icon="refresh"
          label="Uppdatera"
          tooltip="Hämta aktuell förbrukning från GitHub"
          variant="ghost"
          size="sm"
          disabled={refreshing}
          onPress={handleRefresh}
        />
        <IconButton
          icon="open-external"
          label="Öppna GitHub Billing"
          tooltip="Öppna GitHub Billing i webbläsaren"
          variant="ghost"
          size="sm"
          onPress={handleOpenBilling}
        />
      </Row>
    </Row>
  )
}

function ContextSelector({
  snapshot,
  selectedContextId
}: {
  snapshot: ActionsQuotaSnapshot | null
  selectedContextId: string
}) {
  const contexts = snapshot?.availableContexts ?? []
  if (contexts.length <= 1) return null

  return (
    <Select
      label="Konto / Organisation"
      labelHidden
      value={selectedContextId}
      options={contexts.map((c) => ({
        value: c.id,
        label: c.kind === 'organization' ? `Org: ${c.label}` : c.label
      }))}
      onChange={handleSelectContext}
    />
  )
}

function HeroQuotaCard({ snapshot }: { snapshot: ActionsQuotaSnapshot }) {
  const { compute, daysUntilReset } = snapshot
  const tone = quotaTone(compute.percentUsed)
  const resetText = daysUntilReset === 1 ? 'Återställs i morgon' : `Återställs om ${daysUntilReset} dagar`

  return (
    <Box border={tone} background={tone} padding="md" radius="lg" gap="sm">
      <Row justify="between" align="center">
        <Text size="xs" weight="medium" muted>
          Återstående beräkningstid
        </Text>
        <Badge tone={tone}>{compute.percentRemaining}% kvar</Badge>
      </Row>

      <Row justify="between" align="end" gap="sm">
        <Row gap="xs" align="end">
          <Heading level={1}>{formatNumber(compute.remainingMinutes)} min</Heading>
          <Text muted size="sm">
            / {formatNumber(compute.includedMinutes)} min
          </Text>
        </Row>
      </Row>

      <Progress label="Använd Actions-kvot" labelHidden value={compute.percentUsed} />

      <Row justify="between" align="center">
        <Text size="xs" muted>
          {formatDollars(compute.usedDollars)} av {formatDollars(compute.includedDollars)} använt
        </Text>
        <Text size="xs" muted>
          {resetText}
        </Text>
      </Row>
    </Box>
  )
}

function QuickStats({ snapshot }: { snapshot: ActionsQuotaSnapshot }) {
  const { compute, storage } = snapshot
  return (
    <Grid columns={2} gap="sm">
      <Box border background="card" padding="sm" radius="md" gap="xs">
        <Text size="xs" muted>
          Använd tid
        </Text>
        <Text size="md" weight="semibold">
          {formatNumber(compute.usedMinutes)} min
        </Text>
        <Text size="xs" muted>
          {compute.percentUsed}% av månadskvot
        </Text>
      </Box>

      <Box border background="card" padding="sm" radius="md" gap="xs">
        <Text size="xs" muted>
          Actions-lagring
        </Text>
        <Text size="md" weight="semibold">
          {storage.usedGb} / {storage.includedGb} GB
        </Text>
        <Text size="xs" muted>
          {storage.percentUsed}% använt
        </Text>
      </Box>
    </Grid>
  )
}

function OverviewTab({ snapshot }: { snapshot: ActionsQuotaSnapshot }) {
  const { compute, bySku, account } = snapshot
  return (
    <Stack gap="md">
      <Card title="Sammanfattning denna månad">
        <KeyValue
          label="Faktureringsöversikt"
          items={[
            { label: 'Konto', value: account ? `${account.name} (@${account.login})` : '—' },
            { label: 'Plan', value: account?.plan ?? '—' },
            { label: 'Bruttoförbrukning', value: formatDollars(compute.grossDollars) },
            { label: 'Inkluderad rabatt', value: `-${formatDollars(compute.discountDollars)}`, tone: 'success' },
            {
              label: 'Att betala',
              value: formatDollars(compute.billableDollars),
              tone: compute.billableDollars > 0 ? 'warning' : 'neutral'
            }
          ]}
        />
      </Card>

      {bySku.length > 0 ? (
        <Card title="Per runner-typ">
          <Table
            label="Förbrukning per runner"
            columns={[
              { key: 'label', label: 'Runner', width: 'auto' },
              { key: 'minutes', label: 'Minuter', align: 'end', width: 'xs' },
              { key: 'gross', label: 'Kostnad', align: 'end', width: 'xs' }
            ]}
            rows={bySku.map((item) => ({
              key: item.sku,
              cells: {
                label: item.label,
                minutes: `${formatNumber(item.minutes)} m`,
                gross: formatDollars(item.grossAmount)
              }
            }))}
          />
        </Card>
      ) : (
        <Callout tone="neutral" icon="info" title="Inga minuter loggade än">
          <Text size="xs" muted>
            Inga inkluderade Actions-minuter har förbrukats ännu den här månaden.
          </Text>
        </Callout>
      )}
    </Stack>
  )
}

function HistoryTab({ snapshot }: { snapshot: ActionsQuotaSnapshot }) {
  if (snapshot.dailyUsage.length === 0) {
    return (
      <EmptyState
        icon="calendar"
        title="Ingen minutlogg denna månad"
        description="När GitHub Actions körs i dina repos visas daglig förbrukning här."
      />
    )
  }

  return (
    <Table
      label="Daglig Actions-förbrukning"
      maxHeight="md"
      columns={[
        { key: 'date', label: 'Datum', width: 'sm' },
        { key: 'label', label: 'Runner', width: 'auto' },
        { key: 'minutes', label: 'Minuter', align: 'end', width: 'xs' },
        { key: 'gross', label: 'Brutto', align: 'end', width: 'xs', hideBelow: 'sm' }
      ]}
      rows={snapshot.dailyUsage.map((item, index) => ({
        key: `${item.date}-${item.sku}-${index}`,
        cells: {
          date: item.date,
          label: item.label,
          minutes: `${formatNumber(item.quantity)} m`,
          gross: formatDollars(item.grossAmount)
        }
      }))}
    />
  )
}

export default function Panel() {
  const snapshot = read(snapshotAtom)
  const selectedContextId = read(selectedContextAtom)
  const refreshing = read(refreshingAtom)
  const activeTab = read(activeTabAtom)

  return (
    <Stack gap="md">
      <HeaderBar snapshot={snapshot} refreshing={refreshing} />
      <ContextSelector snapshot={snapshot} selectedContextId={selectedContextId} />

      {snapshot?.error ? (
        <Callout tone="warning" icon="warning" title="Kunde inte uppdatera från GitHub">
          <Stack gap="sm">
            <Text size="xs">{snapshot.error}</Text>
            {!snapshot.authenticated ? (
              <Row gap="xs">
                <Button size="sm" variant="ghost" icon="refresh" onPress={handleRefresh} disabled={refreshing}>
                  Försök igen
                </Button>
              </Row>
            ) : null}
          </Stack>
        </Callout>
      ) : null}

      {!snapshot ? (
        <Box border background="card" padding="lg" radius="lg" align="center" gap="sm">
          {refreshing ? (
            <>
              <Spinner label="Hämtar GitHub Actions-data..." />
              <Text muted size="xs">
                Läser kvot från Orcas GitHub-session...
              </Text>
            </>
          ) : (
            <EmptyState
              icon="zap"
              title="Ingen data hämtad än"
              description="Klicka på Hämta för att läsa din GitHub Actions-kvot från Orcas GitHub-session."
            >
              <Button icon="refresh" onPress={handleRefresh}>
                Hämta nu
              </Button>
            </EmptyState>
          )}
        </Box>
      ) : !snapshot.authenticated ? (
        snapshot.error ? null : (
          <Callout tone="warning" icon="warning" title="Inte inloggad på GitHub i Orca">
            <Stack gap="sm">
              <Text size="xs">
                Orcas inbyggda webbläsare saknar en aktiv GitHub-session. Logga in en gång så hämtas din Actions-kvot
                automatiskt.
              </Text>
              <Row gap="xs">
                <Button size="sm" icon="link" onPress={handleOpenLogin}>
                  Logga in på GitHub
                </Button>
                <Button size="sm" variant="ghost" icon="refresh" onPress={handleRefresh} disabled={refreshing}>
                  Försök igen
                </Button>
              </Row>
            </Stack>
          </Callout>
        )
      ) : (
        <>
          <HeroQuotaCard snapshot={snapshot} />
          <QuickStats snapshot={snapshot} />

          <Tabs
            label="Actions-detaljer"
            value={activeTab}
            onChange={(val) => set(activeTabAtom, val === 'history' ? 'history' : 'overview')}
          >
            <Tab value="overview" label="Översikt" icon="gauge">
              <OverviewTab snapshot={snapshot} />
            </Tab>
            <Tab value="history" label="Historik" icon="calendar">
              <HistoryTab snapshot={snapshot} />
            </Tab>
          </Tabs>

          <Separator />
          <Row justify="between" align="center">
            <Text muted size="xs">
              Uppdaterad <RelativeTime at={snapshot.fetchedAt} format="short" muted />
            </Text>
            <Text muted size="xs">
              12 USD ≈ 2 000 Linux-min
            </Text>
          </Row>
        </>
      )}
    </Stack>
  )
}
