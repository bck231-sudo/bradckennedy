(() => {
  const canonicalOrigin = "https://www.adhdagenda.com";
  const redirectHosts = new Set([
    "www.adhdagenda.com",
    "adhdagenda.com",
    "carepanel.org",
    "www.carepanel.org",
    "bradckennedy.org",
    "www.bradckennedy.org"
  ]);

  try {
    if (window.__adhdagendaCacheResetPending) return;
    const { protocol, hostname, pathname, search, hash, href } = window.location;
    if (protocol !== "http:" && protocol !== "https:") return;
    const host = String(hostname || "").trim().toLowerCase();
    if (!redirectHosts.has(host)) return;

    const target = `${canonicalOrigin}${pathname || "/"}${search || ""}${hash || ""}`;
    if (target !== href) {
      window.location.replace(target);
    }
  } catch (_error) {
    // Best-effort canonical host redirect only.
  }
})();
