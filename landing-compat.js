(() => {
  const isPrimaryDomain = /^(?:www\.)?bradckennedy\.org$/i.test(window.location.hostname || "");
  const appBase = isPrimaryDomain ? "https://app.bradckennedy.org/app" : "/app";

  const search = new URLSearchParams(window.location.search || "");
  if (search.has("share")) {
    const shareValue = search.get("share") || "";
    const hash = shareValue ? `#share=${encodeURIComponent(shareValue)}` : "";
    window.location.replace(`${appBase}${hash}`);
    return;
  }

  const hash = window.location.hash || "";
  if (!hash) return;

  const legacyHashPattern = /^#(?:invite=|dashboard|medications|education|consult|history|settings|trends|changes|checkins|notes|timeline|entry|sharing|exports|share=)/i;
  if (legacyHashPattern.test(hash)) {
    window.location.replace(`${appBase}${hash}`);
  }
})();
