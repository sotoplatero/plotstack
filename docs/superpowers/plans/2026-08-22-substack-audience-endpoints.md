# Substack Audience Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incorporate the verified Substack audience endpoints into PlotStack so follower history, subscriber gains/losses, geography, and retention are displayed accurately without exposing paid data by default.

**Architecture:** Extend the existing `substack-extended` provider with small normalizers for each observed payload and keep every network source independently fallible through `Promise.allSettled`. Feed the normalized result into the existing dashboard state, add only decision-useful audience panels, and remove the incorrectly labelled email-volume visualization because that endpoint represents subscribers rather than sent mail.

**Tech Stack:** Chrome Extension Manifest V3, browser `fetch`, vanilla JavaScript/HTML/CSS, Node.js built-in test runner.

## Global Constraints

- Paid-subscriber and revenue figures remain hidden unless the existing privacy preference enables them.
- Missing cohort or location data is rendered as unavailable, never as a fabricated zero.
- Date ranges continue to filter dashboard visualizations without changing their available width.
- No new runtime dependency is introduced.
- The workspace has no Git metadata, so test checkpoints replace commit steps.

---

### Task 1: Normalize and retrieve the verified endpoints

**Files:**
- Modify: `src/providers/substack-extended.js`
- Test: `tests/extended-analytics.test.js`

**Interfaces:**
- Consumes: `requestJson(url, options)` and the publication `{subdomain}`.
- Produces: `normalizeTimeseries(payload)`, `normalizeAudienceLocation(payload)`, `normalizeSubscriberGrowth(payload)`, `normalizeRetention(payload)`, and an extended analytics result containing `audience.followers`, `audience.location`, `growth.subscribers`, and `retention`.

- [ ] **Step 1: Write failing normalizer tests**

```js
assert.deepEqual(normalizeTimeseries([["2026/08/21", 158]]), [{ date: "2026-08-21", value: 158 }]);
assert.deepEqual(normalizeSubscriberGrowth({ subscriberGrowth: [{ dt: "2026-08-21", new_free: 3, num_unsubs: 1 }] }).totals, { new: 3, losses: 1, net: 2 });
```

- [ ] **Step 2: Run the provider test and verify the new imports fail**

Run: `node --test tests/extended-analytics.test.js`

Expected: FAIL because the new exported normalizers do not exist.

- [ ] **Step 3: Implement the normalizers and source requests**

```js
const sources = [
  { key: "followerTimeseries", request: () => requestJson(`${base}/publication/stats/followers/timeseries?from=${fromIso}`), normalize: normalizeTimeseries },
  { key: "freeSubscriberGrowth", request: () => requestJson(`${base}/publication/stats/paid_subscriber_growth?${growthQuery}&is_subscribed=false`), normalize: normalizeSubscriberGrowth },
];
```

Add equivalent isolated sources for location totals, paid growth, and free/paid retention. Replace the old `emailTimeseries` source rather than retaining its incorrect “emails sent” meaning.

- [ ] **Step 4: Run the provider test**

Run: `node --test tests/extended-analytics.test.js`

Expected: PASS.

### Task 2: Render the necessary audience insights

**Files:**
- Modify: `dashboard/index.html`
- Modify: `dashboard/app.js`
- Modify: `dashboard/styles.css`
- Modify: `tests/fixtures/dashboard-browser-mock.js`
- Test: `tests/dashboard-render.test.js`

**Interfaces:**
- Consumes: `state.analytics.audience.followers.history`, `state.analytics.audience.location.rows`, `state.analytics.growth.subscribers.free`, and `state.analytics.retention.free`.
- Produces: follower-history chart, subscriber-flow chart, country ranking, and retention summary with honest empty states.

- [ ] **Step 1: Update browser fixture and write failing rendering assertions**

```js
assert.ok($("#followers-panel"));
assert.ok($$("#followers-chart .chart-bar").length > 0);
assert.match($("#audience-location-list").textContent, /España/);
assert.match($("#subscriber-flow-summary").textContent, /netas/);
```

- [ ] **Step 2: Run the dashboard test and verify it fails**

Run: `node --test tests/dashboard-render.test.js`

Expected: FAIL because the new panels are absent.

- [ ] **Step 3: Add semantic HTML and renderers**

```js
const followers = withinRange(analytics.audience.followers.history, (point) => point.date).kept;
renderBars("#followers-chart", followers, (point) => point.value);
```

The follower total prefers the endpoint's last value and falls back to the snapshot. Geography is a ranked list rather than a map; retention shows available month checkpoints and a text empty state when cohorts are absent. Paid variants use `data-sensitive="paid"`.

- [ ] **Step 4: Remove the misleading email-volume panel and renderer**

Delete `#email-volume-chart` from Publications and remove the call that labels `/emails/timeseries` as sent-email volume.

- [ ] **Step 5: Run dashboard tests**

Run: `node --test tests/dashboard-render.test.js`

Expected: PASS.

### Task 3: Verify the extension as a whole

**Files:**
- Modify: `docs/product/substack-payloads-observados.md`
- Test: `tests/*.test.js`

**Interfaces:**
- Consumes: all source and dashboard changes from Tasks 1–2.
- Produces: documented endpoint semantics and a validated extension package.

- [ ] **Step 1: Document the observed endpoint meanings**

Record that `emails/timeseries` is total subscribers, `subscribers/timeseries` is paid subscribers, and `followers/timeseries` is followers; include the growth, location, and retention paths and their observed shapes.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 3: Validate the extension manifest and files**

Run: `npm run validate`

Expected: validation completes without errors.

- [ ] **Step 4: Scan for stale email-volume language**

Run: `rg -n "Volumen de email|Correos enviados por día|email-volume" dashboard src tests`

Expected: no matches.
