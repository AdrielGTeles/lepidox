# Lepidox

**Rotates your dashboards on a timer. For wall screens, war rooms and NOCs.**

Lepidox is an extension for Chrome and Microsoft Edge. You give it a list of dashboards; it shows one after the other and loads the next one in advance.

## What it does

- **Rotates a list of screens.** Any number of lists, each with its own screens and timing.
- **Builds lists quickly.** Create one from the tabs you have open, paste several addresses at once, or add them one by one.
- **Names screens for you.** A screen takes its page title unless you type a name.
- **Times each screen.** One duration for the list, optionally a different one per screen (5 seconds minimum).
- **Preloads.** Three tabs stay loaded: current, next and previous. A jump to a distant screen loads the page before switching to it.
- **Pauses to investigate.** While paused, 3, 5 or 7 neighbouring screens stay ready. Clicking one of those tabs moves the session there.
- **Follows your edits.** Lists save as you edit. A running rotation picks up reorders, additions, removals and disabled screens without restarting.
- **Flags problems.** A screen redirected to a sign-in page, or one that fails to load, is marked in the popup and in the list. *Check access* tests a whole list before it goes on the wall.
- **Recovers.** A managed tab closed by accident is reopened. A list can resume by itself when the browser starts.
- **Shows its state.** The toolbar icon changes colour: grey when stopped, green when rotating, amber when paused, red when something needs attention.
- Keyboard shortcuts, JSON import and export, English and Brazilian Portuguese.

## What it does not do

- **It does not sign in for you.** Screens open in ordinary tabs and use the sessions your browser already has. When a session expires, Lepidox tells you which screen is asking for a sign-in; you sign in on that tab.
- **It does not read your pages.** It has no access to page content, cookies or passwords. It sees only the title, address and loading state of the tabs it manages.
- **It does not send anything anywhere.** There is no account, server or analytics. Lists are kept in this browser's storage and are not synced between devices; use export and import to move them.
- **It does not keep every dashboard open.** Only the screens around the current one are loaded. A screen that leaves that window is reloaded when its turn comes back, so anything not in its address (a scroll position, a filter picked by hand) is lost.
- **It does not take over your tabs.** It opens its own tabs and closes them when you stop. The tabs you already had stay as they were.
- **It does not see errors inside a page.** A dashboard that loads but shows "no data" or an error panel looks fine to Lepidox. It detects redirects to a sign-in page and pages that fail to load.
- **It does not run two lists at once**, and a rotation lives in one browser window.
- **It does not switch to full screen.** Use the browser's own full-screen mode (F11).

## Install

Store listings are in preparation. Until then, load it unpacked:

1. Clone this repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the repository root (the folder with `manifest.json`).

Requires Chrome or Edge 120 or newer.

## Keyboard shortcuts

| Action | Default |
| --- | --- |
| Pause / resume | `Alt+Shift+Space` |
| Next screen | `Alt+Shift+Right` |
| Previous screen | `Alt+Shift+Left` |
| Stop | `Alt+Shift+S` |

Change them in `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`. The options page always shows the keys currently assigned.

## Permissions

| Permission | Why |
| --- | --- |
| `tabs` | Open, switch, reuse and close the tabs that show your screens; read their title and address to name screens and notice sign-in redirects; list open tabs when you create a list from them. |
| `storage` | Keep your lists and the state of a running rotation in the browser. |
| `alarms` | Wake the extension when it is time to rotate. |

Lepidox requests no host permissions. See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Development

There is no build step and no dependency: the repository root is the extension. Node 22+ is only needed for the checks and the store package.

```sh
npm test         # validates manifest/locales/sources, then runs the unit tests
npm run build    # writes dist/lepidox-<version>.zip for both stores
npm run icons    # redraws the logo and every icon from scripts/icons.mjs
```

```text
lepidox/
├── _locales/          en, pt_BR
├── assets/icons/      lepidox.svg and the PNG icons, written by scripts/icons.mjs
├── src/
│   ├── background/    service worker: rotation, scheduling, tab pool
│   ├── core/          constants, list model, storage
│   ├── shared/        i18n and naming, used by worker and pages
│   ├── ui/            design tokens, components and DOM helpers
│   ├── popup/
│   └── options/
├── scripts/           validate.mjs, build.mjs, icons.mjs
├── tests/
├── store/             screenshots and promotional images
└── docs/              architecture and store publishing notes
```

How the pieces fit together is described in [docs/architecture.md](docs/architecture.md). Publishing steps and listing texts are in [docs/store](docs/store).

## The name and the logo

Lepidox is named after lepidocrocite, γ-FeO(OH), the iron oxide-hydroxide that forms in rust: *lepid-* from the mineral, *-ox* from oxide.

Lepidocrocite crystallises in thin plates, and that is the logo: three plates in a spiral, each turned one step further than the one below, going from steel to rust to the plate on display. They are also the three tabs Lepidox keeps loaded. In the toolbar the top plate is green while rotating, amber when paused, red when something needs attention and grey when stopped.

`npm run icons` draws the mark and writes every icon; the script has no dependencies.

## License

[Mozilla Public License 2.0](LICENSE). Copyright © 2026 Adriel Teles.

Lepidox is developed and maintained by one person. Bug reports and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
