# PlotStack Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a load-unpacked Chrome extension that turns newsletter metrics from the authenticated browser session into a concentrated, polished analytics dashboard.

**Architecture:** A Manifest V3 service worker opens the extension dashboard, validates the existing Substack session cookie through the read-only profile endpoint, discovers publications, and fetches their internal analytics endpoints with `credentials: include`. The dashboard renders only connected API data, while `chrome.storage.local` keeps normalized metrics and connection metadata without ever copying cookie values into extension storage.

**Tech Stack:** Chrome Extensions Manifest V3, semantic HTML, modern CSS, browser-native JavaScript, Node's built-in test runner.

## Global Constraints

- The extension must never request or store passwords, session cookies, or authentication tokens.
- Initial provider support is Substack; other newsletter providers remain isolated behind the same snapshot shape.
- The unpacked extension must run directly from the repository without a build step.
- First launch must show connection onboarding; there is no demo-data state.

---

### Task 1: Snapshot model and deterministic analytics

**Files:**
- Create: `src/shared/analytics.js`
- Create: `tests/analytics.test.js`

**Interfaces:**
- Produces: `normalizeSnapshot(input)`, `formatCompactNumber(value)`, `formatPercent(value)`, `getTrendSeries(snapshot, metric)`, and `getDerivedMetrics(snapshot)`.

- [x] **Step 1: Write failing tests** for normalization, percentage formatting, compact counts, trend extraction, and derived growth.
- [x] **Step 2: Run `node --test tests/*.test.js`** and verify missing-module failure.
- [x] **Step 3: Implement the exported pure functions** with finite-number guards and stable defaults.
- [x] **Step 4: Run `node --test tests/*.test.js`** and expect all tests to pass.

### Task 2: Manifest, service worker, and authenticated API adapter

**Files:**
- Create: `manifest.json`
- Create: `src/background.js`
- Create: `src/providers/substack-api.js`

**Interfaces:**
- Consumes: snapshot schema from Task 1.
- Produces: `PLOTSTACK_CONNECT`, `PLOTSTACK_SELECT_PUBLICATION`, `PLOTSTACK_SYNC`, and `plotstack.snapshot` local-storage record.

- [x] **Step 1: Define MV3 permissions** (`storage`, `tabs`, `cookies`) and Substack host access.
- [x] **Step 2: Implement toolbar behavior** that opens or focuses `dashboard/index.html`.
- [x] **Step 3: Implement the authenticated API adapter** for `/user/profile/self`, `/publish-dashboard/summary`, `/summary-v2`, and `/publication/stats/email_stats` using the browser cookie jar.
- [x] **Step 4: Add message handling** for login validation, publication selection, synchronization, and actionable auth errors.

### Task 3: Editorial dashboard interface

**Files:**
- Create: `dashboard/index.html`
- Create: `dashboard/styles.css`
- Create: `dashboard/app.js`
- Create: `assets/icon.svg`

**Interfaces:**
- Consumes: `plotstack.snapshot`, authenticated connection messages, and analytics helpers from Task 1.
- Produces: first-run onboarding, publication selection, accessible KPI cards, SVG trend chart, growth breakdown, recent Notes engagement, recent-campaign table, refresh controls, theme persistence, and connection state.

- [x] **Step 1: Build semantic onboarding and dashboard markup** with login, publication-selection, loading, error, and success states.
- [x] **Step 2: Implement the editorial visual system** with responsive layout, restrained motion, keyboard focus, and reduced-motion support.
- [x] **Step 3: Render connected snapshots and detailed per-Note analytics** from `/note_stats/{comment_id}` using safe DOM APIs and a responsive inline SVG chart.
- [x] **Step 4: Wire authentication, synchronization, disconnect, date-range switching, theme switching, and CSV export** to browser-native APIs.

### Task 4: Documentation and release verification

**Files:**
- Create: `README.md`
- Create: `package.json`
- Create: `scripts/validate-extension.mjs`

**Interfaces:**
- Consumes: all extension artifacts.
- Produces: repeatable `npm test` and `npm run validate` checks plus load-unpacked instructions.

- [x] **Step 1: Document installation and the Substack capture workflow**, including the privacy model and current limitations.
- [x] **Step 2: Add a validation script** that checks manifest references and required assets.
- [x] **Step 3: Run `npm test` and `npm run validate`** and expect zero failures.
- [x] **Step 4: Inspect the dashboard in a browser-sized viewport** and correct any visual overflow or console errors.
