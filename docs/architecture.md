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
| `lepidoxRecovery` | local | service worker | Where a session was: list, screen, window, and the position and address of its tabs |

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

`startList` can also **adopt** existing tabs: they join the pool as they are, before the first rebalance. That is how a session survives an update or a restart.

## Updates and restarts

`chrome.storage.session` is emptied when the extension is updated and when the browser restarts, so the runtime record is lost in both cases. After every change of screen, `schedule` writes `lepidoxRecovery` (version 2) to local storage: list, screen, window, whether the window is Lepidox's own, whether the session is paused, and for each pool tab its id, position and address. It is `live` while the session runs. An explicit stop deletes it. A closed window marks it `live: false` for an auto-resume list and deletes it otherwise.

- **Update** (`runtime.onInstalled`, reason `update`): the browser kept running, so the recorded window and tab ids are still valid. If the record is live, every recorded tab still in that window with the same origin is adopted and the list starts again at its screen, paused if it was. This holds for every list, auto-resume or not. Records written by 1.1.0 carry no window or tabs and are not resumed.
- **Browser start** (`runtime.onStartup`, and `windows.onCreated` when the new window is the only normal one, which covers Edge reopening while it runs in the background): only for auto-resume lists. The resume waits up to 3 s for the browser to restore tabs, then adopts a tab only if it is at the recorded position **and** shows the recorded address. Tabs that do not match, including the user's own copies of a dashboard, are left alone.

## Wall options

- **Full screen** (`fullscreen`): the list starts in a window of its own (`windows.create`), whose first tab is adopted as the first screen. Opening a tab takes a window out of full screen (switching, loading, zooming and closing tabs do not), and Edge ignores a full-screen request made while a window is still opening. So full screen is requested once the pool's tabs exist, again until the window reports it, and again after any later rebalance that had to open a tab. Pausing leaves full screen (`maximized`), so the toolbar and the tabs are there to investigate with; resuming returns to it. On stop, the window is closed if it holds only rotation tabs and another window is open; otherwise it leaves full screen and keeps a blank tab.
- **Keep the display on** (`keepAwake`): `power.requestKeepAwake("display")` while the session exists, released when it ends. It follows edits to the running list.
- **Reload before showing** (`reloadBeforeShow`): after a screen is shown, the next one is reloaded in the background if it was already in the pool. In lists longer than the pool this rarely happens, because a screen entering the pool is loaded then anyway.
- **Zoom** (screen `zoom`, 25–300 or empty): `tabs.setZoomSettings` with `scope: "per-tab"`, then `tabs.setZoom`. Per-tab zoom resets on every navigation, so it is applied each time the tab finishes loading, and at once when the value is edited. Empty leaves the browser's zoom alone.

## Scheduler

`chrome.alarms` cannot fire sooner than 30 seconds, so:

- deadlines under 30 seconds use an in-memory timer, with an alarm as a watchdog in case the worker is suspended;
- longer deadlines use an alarm directly;
- the absolute deadline is stored in the runtime record and re-armed whenever the worker starts.

## Screen status

Lepidox has no host permissions and no content scripts, so it only sees a tab's address, title and loading state, plus the navigation errors the browser reports.

- **Sign-in required**: the tab ended up on a different page from the configured address, and that page looks like a sign-in page (a path segment such as `/login` or `/oauth2/authorize`, or a host such as `login.…`). A dashboard that merely has "login" in its name is not flagged.
- **Error**: `webNavigation.onErrorOccurred` reported a main-frame failure (`net::ERR_NAME_NOT_RESOLVED`, `net::ERR_CONNECTION_REFUSED` and so on; `net::ERR_ABORTED`, which only means one navigation replaced another, is ignored), the address is a browser error page, or the page did not finish loading within the timeout. The error sticks to the pool entry until the tab's next navigation starts. A failed page keeps its address and shows the host as title, so neither the address nor the title of an ordinary page is ever read as an error. HTTP errors rendered as normal pages are not detected.

## Localisation

All text lives in `_locales`. `src/shared/i18n.js` is used by the worker and the pages; static markup is filled from `data-i18n` attributes. `scripts/validate.mjs` fails when a locale is missing a key or the code uses an undefined one.
