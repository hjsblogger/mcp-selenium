# Web Testing Agent — Selenium MCP on TestMu AI (LambdaTest)

Cross-browser web equivalent of the Appium MCP mobile agent. Uses this repo's
Selenium MCP server pointed at TestMu AI's (formerly LambdaTest) remote grid,
running Chrome and Firefox in parallel.

> **Why this needs subagents:** this MCP server tracks exactly one active
> browser session per connection (`state.currentSession` is a single
> pointer, not a per-call session argument). `start_browser` returns a
> `session_id`, but no tool accepts one back in — every subsequent tool call
> on a connection always acts on whatever session that connection started
> most recently. One connection literally cannot drive two browsers at
> once. To get real parallelism, spin up one MCP server connection **per
> browser**, each in its own subagent, and dispatch them together — that's
> also how TestMu AI actually parallelizes work: N independent remote
> sessions on the grid, not N sessions multiplexed over one WebDriver
> connection.

## Prerequisites

Set these on every MCP server process before it starts (each subagent's
connection needs them independently):

| Variable | Description |
|----------|--------------|
| `SELENIUM_REMOTE_URL` | `https://hub.lambdatest.com/wd/hub` |
| `LT_USERNAME` | TestMu AI (LambdaTest) username |
| `LT_ACCESS_KEY` | TestMu AI (LambdaTest) access key |

## Setup (orchestrator)

1. Read `lt-web-capabilities.json` — an array of capability objects, one per
   browser/OS/version combination (see
   [`lt-web-capabilities.example.json`](../capabilities/lt-web-capabilities.example.json)
   for the shape: `browser`, `platform`, `browserVersion`, `build`, `name`).
   For this workflow it holds two entries: **Chrome** and **Firefox**.
2. Launch one subagent per capability entry, **all in the same dispatch** —
   do not launch one, wait for it, then launch the next. Each subagent gets
   its own Selenium MCP server connection (its own `state.currentSession`)
   and one capability entry from the array.
3. Each subagent independently runs the full **Steps** and **Teardown**
   sections below against its own session, then reports back to the
   orchestrator: capability entry, `session_id`, TestMu AI dashboard link,
   and pass/fail with a short reason.
4. The orchestrator waits for all subagents to complete before producing
   the final summary. A slow or failed browser must not block or cancel the
   others.

## Steps (run inside each subagent, against its own session)

1. `start_browser` with `browser` and `options: { platform, browserVersion,
   build, name }` from the subagent's capability entry.
2. `navigate` to `https://duckduckgo.com`.
3. `take_screenshot` of the home/search page.
4. `send_keys` into the search box (`by: name`, `value: q`, `text: "TestMu
   AI"`), then `press_key` with `key: Enter` to submit.
5. `interact` with `action: click`, `by: css`, `value: 'article[data-testid="result"]
   a[data-testid="result-title-a"]'` to open the first result.
6. `take_screenshot` of the resulting page.
7. `execute_script` with `script: "return window.location.href;"` and assert
   the returned URL is no longer `duckduckgo.com` — this is the web
   equivalent of the toast-visibility assertion (confirms navigation away
   from the search results actually happened).

## Teardown (run inside each subagent, immediately after its own step 7)

Run this while the subagent's session is still active:

- **If running on TestMu AI (i.e. `SELENIUM_REMOTE_URL`/`LT_USERNAME`/
  `LT_ACCESS_KEY` are set):** call `execute_script` with the LambdaTest hook
  to record the result, then close the session — do these two calls
  back-to-back with nothing in between, same as the Appium agent's REST
  PATCH-then-teardown pattern:
  ```
  execute_script:
    script: 'lambda-hook: {"action":"setTestStatus","arguments":{"status":"passed","remark":"<summary>"}}'
  ```
  (use `"status":"failed"` and a failure remark if step 7's assertion
  failed). Then immediately call `close_session`.
- **If running locally** (no `SELENIUM_REMOTE_URL`): just call
  `close_session`. There's no local-emulator/app-uninstall equivalent for a
  browser session — closing the session releases the browser process.

Each subagent's connection ends here — do not reuse it for another
capability entry.

## Summary (orchestrator)

Once every subagent has reported back, produce one combined summary listing
each browser's result: browser/platform, session ID, TestMu AI dashboard
link, and pass/fail with reason. Report all entries together — don't emit
a summary per browser as it finishes.
