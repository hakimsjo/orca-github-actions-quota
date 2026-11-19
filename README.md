# GitHub Actions Quota — Orca Plugin

An [Orca](https://orca.stably.ai) sidebar plugin and status bar indicator that shows your remaining **GitHub Actions** included compute minutes and storage for the current billing period — using your existing GitHub session in Orca's built-in browser (no personal access tokens or extra credentials required).

## Features

- **Remaining Compute Time**: Displays remaining included minutes (e.g. `1,998 min / 2,000 min`), percentage bar, dollar credit usage (`$12.00` included pool), and days until the monthly quota resets.
- **Organization & Account Switcher**: Automatically discovers GitHub organizations where you have billing/settings access and lets you switch between your personal account and any organization.
- **Actions Storage**: Tracks included Actions storage (`GB` used vs. `0.5 GB` included).
- **Runner & Daily Breakdown**:
  - **Översikt** tab: Monthly billing summary (gross, included discount, billable amount) and breakdown by runner SKU (`Actions Linux`, macOS, Windows, etc.).
  - **Historik** tab: Daily Actions minute usage table for the current month.
- **Status Bar Indicator**: Shows remaining minutes for the selected account/organization right in Orca's bottom status bar, color-coded by usage (`success` / `warning` / `danger`).
- **One-Click Sign-In**: If Orca's built-in browser isn't signed in to GitHub yet, offers a button that opens `https://github.com/login` directly in Orca.

## Installation

Install directly from GitHub using the Orca CLI:

```bash
orca plugin install hakimsjo/orca-github-actions-quota
```

Because this plugin runs a `trusted-worker` to communicate with Orca's browser CLI and stores cached snapshots in `orca.storage`, Orca will print an approval fingerprint (`ap1-...`) on the first run. Re-run the command with `--approve <fingerprint>` to enable it:

```bash
orca plugin install hakimsjo/orca-github-actions-quota --approve <fingerprint>
```

Open the panel in Orca's right sidebar:

```bash
orca plugin open local.github-actions-quota
```

*(Note: When installed from GitHub, the plugin key uses the repository owner as publisher, e.g. `hakimsjo.github-actions-quota`.)*

## How It Works

GitHub's Enhanced Billing Platform exposes monthly included compute and storage discounts on `github.com/settings/billing` (and `/organizations/<org>/settings/billing`). Rather than asking you to create and store a separate GitHub PAT with `user` or `admin:org` scopes:

1. The worker checks `orca tab list` for an already-open `github.com` tab (or temporarily opens `/settings/billing` and closes it immediately after reading).
2. It fetches the same-origin billing JSON endpoints (`/discounts` and `/net_usage`) using your active Orca browser session.
3. Snapshots are cached per account/organization in `orca.storage` so the panel loads instantaneously and refreshes on demand or when stale (> 1 hour).

No tokens, cookies, or credentials are read from disk or stored by the plugin.

## Development & Testing

```bash
# Validate manifest and render panel checks
orca plugin check .

# Run unit tests (parser, worker, and panel)
orca plugin test .

# Load locally in development mode
orca plugin dev load .
```

## Project Structure

- `orca-plugin.json` — Plugin manifest (sidebar panel, status bar item, `storage:own` capability).
- `src/protocol.ts` — Typed request/event contract between panel and worker.
- `src/parser.ts` — Pure parser computing remaining minutes, storage, reset countdown, and SKU/daily breakdowns.
- `src/worker.ts` — Node.js worker fetching GitHub billing data via Orca CLI browser session and updating the status bar.
- `src/panel.tsx` — Declarative Orca components UI.
- `src/worker.test.ts` & `src/panel.test.tsx` — Unit tests using `orca/testing`.
