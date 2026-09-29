# Security

## Design principles

Lepidox uses Manifest V3, minimum practical permissions and no remote executable code. Authentication remains under the control of each target website and the browser profile.

Requested permissions:

- `tabs`: create, activate, reuse and observe the managed tab pool, including title/URL status.
- `storage`: persist lists/settings locally and runtime state for service-worker recovery.
- `alarms`: durable scheduling for rotations of 30 seconds or longer and recovery watchdogs.

Lepidox intentionally does not request access to browser cookies, passwords or history.

## Reporting a vulnerability

Please report security issues privately to the project maintainer before publishing exploit details.
