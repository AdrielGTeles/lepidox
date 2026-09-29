// SPDX-License-Identifier: MPL-2.0

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
    return parsed.hostname || `Tela ${index + 1}`;
  } catch {
    return `Tela ${index + 1}`;
  }
}

export function screenTitle(screen, index = 0) {
  return String(screen?.name || screen?.resolvedTitle || fallbackTitle(screen?.url || "", index)).trim();
}

export function numberedScreenTitle(screen, index = 0) {
  return `${String(index + 1).padStart(2, "0")} · ${screenTitle(screen, index)}`;
}

export function detectPageState(url = "", title = "") {
  const value = `${url} ${title}`.toLowerCase();
  if (
    url.startsWith("chrome-error://") ||
    url.startsWith("edge-error://") ||
    /this site can.?t be reached|não é possível acessar|page not found|server error|dns_probe|err_/.test(value)
  ) {
    return "error";
  }

  if (
    /(^|[\/?#._-])(login|signin|sign-in|logon|sso|oauth|authorize|authentication|auth)([\/?#._-]|$)/i.test(url) ||
    /sign in|log in|login|entrar|autentica[cç][aã]o|authentication required/.test(title.toLowerCase()) ||
    /login\.microsoftonline\.com|adfs|okta\.com\/.*signin/i.test(url)
  ) {
    return "auth";
  }

  return "ready";
}
