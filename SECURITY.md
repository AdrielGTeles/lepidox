# Security

## What Lepidox can do

Lepidox uses Manifest V3 with three permissions:

- `tabs`: create, activate, reuse and close the tabs it manages, and read their title and address for screen names and status. Also used to list open tabs when the user creates a list from them.
- `storage`: keep lists and settings locally, and the state of a running rotation so it survives a service worker suspension.
- `alarms`: rotations of 30 seconds or longer, and a watchdog for shorter ones.

## What Lepidox cannot do

- **Read or change a page.** It requests no host permissions and injects no content scripts.
- **Reach cookies, passwords or browsing history.** It requests none of those permissions.
- **Run code from the network.** Every script it executes ships inside the package.
- **Authenticate.** Sign-in stays between each website and the browser profile. Lepidox only notices that a tab was redirected to a sign-in page.
- **Talk to a server.** It makes no network requests of its own.

## How the code keeps it that way

- Text that comes from outside the extension (list names, page titles, imported files) is only ever written to the page as text, never parsed as HTML.
- Only `http` and `https` addresses are opened as screens.
- `npm test` fails if `eval`, `innerHTML`, inline scripts or remote scripts appear in the sources.

## Supported versions

Only the latest published version receives fixes.

## Reporting a vulnerability

Please report security issues privately, before publishing details: use **Report a vulnerability** under the *Security* tab of <https://github.com/AdrielGTeles/lepidox>. Lepidox is maintained by one person; expect a first answer within a few days.
