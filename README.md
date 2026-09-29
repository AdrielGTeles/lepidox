# Lepidox

**Smart dashboard rotator for war rooms, NOCs and monitoring environments.**

Lepidox is an open-source Chromium extension that rotates authenticated dashboards while keeping a small working set of tabs hot. It is designed for long-running operational rooms where opening dozens of live dashboards at once wastes memory, but reloading every screen at rotation time is too slow.

## 1.0.0 highlights

- URL lists with any number of screens.
- Screen name or automatic page-title discovery.
- Global list duration and optional per-screen duration (minimum 5 seconds).
- Hybrid scheduler: fast in-memory timer below 30 seconds and `chrome.alarms` recovery/fallback.
- Smart hot pool: 3 live tabs while rotating.
- Investigation mode: configurable 3, 5 or 7 live tabs while paused.
- Previous / current / next preloading.
- Load-before-switch for distant jumps.
- Manual navigation while paused recenters the hot pool around the selected screen.
- Authentication stays with the browser/site; Lepidox never stores passwords, MFA or cookies.
- Session/authentication heuristics based only on tab URL/title.
- Access preflight for saved lists.
- Screen status: cold, loading, ready, active, authentication required and error.
- Automatic reconstruction if a managed tab is closed unexpectedly.
- Optional browser-start auto-resume per list.
- JSON import/export.
- Keyboard shortcuts.
- Dynamic toolbar icon for inactive / active / paused / error states.
- Chrome and Microsoft Edge from one Manifest V3 codebase.
- No analytics, remote code or mandatory backend.

## Installation for development

1. Clone or extract this repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the repository root containing `manifest.json`.

## Keyboard shortcuts

| Action | Default shortcut |
| --- | --- |
| Pause / resume | `Ctrl+Shift+Space` |
| Next screen | `Ctrl+Shift+Right` |
| Previous screen | `Ctrl+Shift+Left` |
| Stop list | `Ctrl+Shift+X` |

Shortcuts can be changed in `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`.

## Authentication model

Lepidox does not authenticate on behalf of the user. Managed tabs are normal tabs in the current browser profile, so Grafana, Datadog, Power BI, SSO providers and internal applications use their own existing browser sessions. Lepidox does **not** request the `cookies` permission and does not store credentials.

## Memory model

During automatic rotation, Lepidox keeps a working set of up to three pages alive: previous, current and next. The next page is therefore already loading/loaded before it is displayed. When paused, the pool expands around the current position to make investigation faster. Screens outside the pool are represented by their saved URL and metadata rather than a live DOM/JavaScript context.

## Project structure

```text
lepidox/
├── assets/icons/
├── docs/
├── src/
│   ├── background/
│   ├── core/
│   ├── options/
│   ├── popup/
│   └── shared/
├── manifest.json
├── PRIVACY.md
├── SECURITY.md
├── CONTRIBUTING.md
├── CHANGELOG.md
└── LICENSE
```

## License

Mozilla Public License 2.0 (`MPL-2.0`).
