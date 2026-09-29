# Lepidox architecture

## Runtime flow

```text
Saved list
   │
   ▼
Rotation Manager
   │
   ├── Scheduler
   │     ├── setTimeout (<30s)
   │     └── chrome.alarms (>=30s / recovery)
   │
   ├── Hot Pool
   │     ├── previous
   │     ├── current
   │     └── next
   │
   └── Investigation Pool
         └── 3 / 5 / 7 live tabs centered on current screen
```

The hot pool uses normal browser tabs. A page that remains in the pool keeps its live DOM, JavaScript state and browser session. When a screen leaves the pool, the physical tab can be reused or closed and that volatile page state is intentionally released.

## Scheduler

Chrome alarms are limited to a minimum effective cadence of roughly 30 seconds. Lepidox therefore uses a hybrid model:

- durations below 30 seconds: an in-memory timer fires before the Manifest V3 worker idle window;
- a 30-second alarm acts as a recovery watchdog;
- durations of 30 seconds or greater use `chrome.alarms` directly;
- the absolute `nextRotationAt` deadline is stored in session storage and re-armed whenever the worker wakes.

## Authentication

Lepidox opens normal tabs in the current Chrome/Edge profile. It does not persist credentials. Existing cookies, SSO sessions and site storage are used naturally by the target site without being read by Lepidox.

## Screen status

Without broad host/content permissions, Lepidox deliberately limits status inspection to browser tab metadata. It can identify loading/complete state and heuristically flag common login/error destinations from title and URL. It does not inspect private page DOM content.
