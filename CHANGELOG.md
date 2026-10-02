# Changelog

## 1.1.0 - 2026-10-02

First release prepared for the Chrome Web Store and Microsoft Edge Add-ons.

### Interface

- Popup and options page rebuilt on one shared set of tokens and components (`src/ui`), with larger text and plain wording.
- Popup: one clear state at a time (no lists yet, lists to start, or the running session), and it now follows the rotation by itself instead of freezing at `0s`.
- Options: lists on the left, one editor on the right. Changes save automatically; the per-list Save button is gone.
- Create a list from the open tabs, add open tabs to a list, or paste several addresses at once.
- Addresses typed without `https://` are completed. Invalid ones are flagged in place.
- Drag screens to reorder them (or use the arrow keys on the handle). Removing a screen can be undone.
- The shortcuts panel shows the keys actually assigned and links to the browser's shortcut settings.
- English and Brazilian Portuguese.
- New logo and icons: three plates in a spiral, each turned one step further than the one below, going from steel to rust. The name comes from lepidocrocite, the iron oxide-hydroxide found in rust, which crystallises in thin plates. The top plate is green while rotating, amber when paused, red when something needs attention and grey when stopped.

### Behaviour

- Editing a running list no longer scrambles it: the rotation follows reorders, additions, removals and address changes, and stops if its list is deleted.
- A pause, stop or jump issued while a screen is loading is no longer overwritten when the load finishes.
- Pressing next twice while a screen loads skips two screens.
- A dashboard whose address or title merely contains "login" or "auth" is no longer reported as needing a sign-in; only a redirect to a sign-in page is.
- Stopping a rotation never closes the window, even when its tabs are the only ones left.
- Starting a list that cannot run leaves the current rotation untouched.
- Closing the rotation window ends the session cleanly.

### Changed

- Default shortcuts are now `Alt+Shift+Space`, `Alt+Shift+Right`, `Alt+Shift+Left` and `Alt+Shift+S`. The previous `Ctrl+Shift+Left/Right` took over word selection in every text field. Existing installs keep whatever keys they already have.
- Page titles and screen status are stored apart from the lists, so the service worker never rewrites a list being edited. Lists saved by 1.0.0 are migrated on update.
- Exported files no longer carry page titles or status.
- Requires Chrome or Edge 120.

### Project

- Unit tests for the rotation engine (`npm test`), a validator for manifest, locales, icons and sources, a dependency-free packager (`npm run build`) and icon generator (`npm run icons`).
- Copyright notice, privacy policy and store listing material for publication by an individual developer.

## 1.0.0 - 2026-09-29

- Promoted Lepidox to the first complete release architecture.
- Fixed list durations below 30 seconds by replacing the alarm-only scheduler with a hybrid scheduler.
- Migrates 0.1 alpha screen durations to inherited list durations.
- Added automatic screen titles and structured screen editor.
- Added 3-tab rotation hot pool and configurable investigation pool (3/5/7).
- Added immediate next/previous preloading and load-before-switch.
- Added manual investigation recentering and managed-tab reconstruction.
- Added per-screen duration and enable/disable controls.
- Added screen status and authentication/error heuristics.
- Added list preflight, JSON import/export and optional browser auto-resume.
- Added keyboard shortcuts.
- Added dynamic active/paused/error/inactive toolbar icons and badges.
- Rebuilt popup and options UI using the dark corporate visual system used by the project's reference dashboards.

## 0.1.0-alpha

- Initial lists, rotation, pause, previous/next and 3-tab pool prototype.
