# Contributing to Lepidox

Lepidox is written and maintained by one person, Adriel Teles, who also publishes it to the browser stores. Bug reports, ideas and pull requests are welcome; they are reviewed as time allows, and not every proposal will be merged.

## Before you start

- For anything larger than a small fix, open an issue first so the approach can be agreed.
- Keep browser permissions minimal. A change that needs a new permission needs a discussion.
- No telemetry, credential handling, remote code or third-party runtime dependencies.

## Making a change

1. Fork the repository and create a focused branch (`feature/...` or `fix/...`).
2. Load the repository root as an unpacked extension (see the README) and try your change in both Chrome and Microsoft Edge.
3. Run `npm test`. It validates the manifest, locales and sources, then runs the unit tests.
4. User-visible text goes in **both** `_locales/en/messages.json` and `_locales/pt_BR/messages.json`.
5. Open a pull request describing the behaviour change and any security or privacy impact.

## Licensing of contributions

Lepidox is licensed under the Mozilla Public License 2.0. By submitting a contribution you agree that it is licensed under the same terms, and you confirm that you have the right to submit it. You keep the copyright to what you write.

New source files start with:

```js
// Copyright (c) <year> <your name>
// SPDX-License-Identifier: MPL-2.0
```
