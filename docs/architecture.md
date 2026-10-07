# Lepidox architecture

Lepidox has three parts: a service worker that owns the rotation, and two pages (popup and options) that display state and send commands. They share plain ES modules; there is no build step.

```text
 popup ─┐  commands (runtime messages)   ┌─ scheduler   setTimeout <30s, chrome.alarms otherwise
        ├──────────────────────────────▶ │
options ┘                                ├─ rotation-manager   runtime record, tab pool
   ▲                                     │
   │  storage.onChanged                  └─ preflight   one-off access check
   └──────────────── chrome.storage ◀────── every state change
```

## Storage

| Key | Area | Written by | Holds |
| --- | --- | --- | --- |
| `lepidoxLists` | local | options page, popup | What the user configured: lists, screens, durations |
| `lepidoxScreenMeta` | local | service worker | What Lepidox observed per screen: page title, last status |
| `lepidoxRuntime` | session | service worker | The running session: current screen, tab pool, deadline |
| `lepidoxRecovery` | local | service worker | Which list to resume at browser start |

Configuration and observation are separate keys on purpose. The options page saves on every edit, and the service worker records titles and status continuously; if both wrote the same record, one would regularly overwrite the other.

Pages never poll. They render from `storage.onChanged`, so the popup follows a rotation without asking.

## The runtime record and the lock

The service worker can be suspended at any moment, so its state lives in `chrome.storage.session`, not in memory. Every handler (tab events, alarms, shortcuts, messages) reads that record, changes it and writes it back.

Those handlers interleave: a burst of `tabs.onUpdated` events can arrive in the middle of a rotation. `lock.js` therefore runs them one at a time. Everything exported by `rotation-manager.js` takes the lock; its internal helpers assume it is held.

Waiting for a page to load can take up to 45 seconds, and holding the lock that long would make pause and stop feel dead. A jump is split in two locked steps with the wait in between:

1. prepare the target tab and record a `pendingJump` with a fresh id;
2. *(unlocked)* wait for the tab to finish loading;
3. re-read the record and complete the jump only if `pendingJump` still carries that id.

A stop, or a newer jump, simply makes step 3 a no-op.

## Tab pool

Screens are shown in ordinary browser tabs. While rotating, the pool holds three: current, next and previous. While paused it grows to 3, 5 or 7 around the current screen, so neighbours can be browsed without waiting.

Pool entries are keyed by **screen id**, not by position. When the list changes, `handleListsChanged` re-maps each entry to its screen's new position, closes tabs whose screen was removed or re-pointed, and moves on if the screen on display is gone. That is what makes editing a running list safe.

A screen leaving the pool gives its tab to a screen entering it; tabs are only created when the pool grows and only closed when it shrinks.

## Scheduler

`chrome.alarms` cannot fire sooner than 30 seconds, so:

- deadlines under 30 seconds use an in-memory timer, with an alarm as a watchdog in case the worker is suspended;
- longer deadlines use an alarm directly;
- the absolute deadline is stored in the runtime record and re-armed whenever the worker starts.

## Screen status

Lepidox has no host permissions and no content scripts, so it only sees a tab's address, title and loading state.

- **Sign-in required**: the tab ended up on a different page from the configured address, and that page looks like a sign-in page (a path segment such as `/login` or `/oauth2/authorize`, or a host such as `login.…`). A dashboard that merely has "login" in its name is not flagged.
- **Error**: the address or title carries a browser error marker, or the page did not finish loading within the timeout. HTTP errors rendered as normal pages are not detected.

## Localisation

All text lives in `_locales`. `src/shared/i18n.js` is used by the worker and the pages; static markup is filled from `data-i18n` attributes. `scripts/validate.mjs` fails when a locale is missing a key or the code uses an undefined one.
