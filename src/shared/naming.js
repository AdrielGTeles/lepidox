// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import { t } from "./i18n.js";

export function fallbackTitle(url, index = 0) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
    if (path) {
      const last = decodeURIComponent(path.split("/").filter(Boolean).at(-1) || "");
      if (last && last.length <= 42 && !/^[a-f0-9-]{20,}$/i.test(last)) {
        return `${parsed.hostname} · ${last}`;
      }
    }
    return parsed.hostname || t("screenNumber", index + 1);
  } catch {
    return t("screenNumber", index + 1);
  }
}

// Precedence: name typed by the user, then the title observed on the page, then the URL.
export function screenTitle(screen, index = 0, observedTitle = "") {
  return String(screen?.name || observedTitle || fallbackTitle(screen?.url || "", index)).trim();
}

const LOGIN_PATH = /(^|\/)(login|signin|sign-in|sign_in|logon|sso|oauth2?|authorize|auth|adfs|saml2?)(\/|\.|$)/i;
const LOGIN_HOST = /^(login|signin|sso|auth|accounts|id)\.|(^|\.)(okta|auth0|onelogin)\.com$/i;

function samePage(a, b) {
  try {
    const first = new URL(a);
    const second = new URL(b);
    return first.origin === second.origin
      && first.pathname.replace(/\/+$/, "") === second.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

// Only the tab address is inspected, never page content. A screen counts as
// "auth" when it was redirected away from the configured address to something
// that looks like a sign-in page; a dashboard merely named "Login metrics" is not.
export function detectPageState(url = "", configuredUrl = "") {
  // Pages that fail to load are reported by webNavigation: a failed page keeps its
  // address and shows the host as title, so neither says anything here.
  if (url.startsWith("chrome-error://") || url.startsWith("edge-error://")) return "error";

  if (configuredUrl && !samePage(url, configuredUrl)) {
    try {
      const parsed = new URL(url);
      if (LOGIN_HOST.test(parsed.hostname) || LOGIN_PATH.test(parsed.pathname)) return "auth";
    } catch {
      // Not a parseable URL: nothing to conclude.
    }
  }

  return "ready";
}
