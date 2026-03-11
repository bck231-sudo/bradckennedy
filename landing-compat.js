(() => {
  const appBase = "/app";

  const hash = window.location.hash || "";
  if (!hash) return;

  const supportedHashPattern = /^#(?:invite=|share_token=|reset=|dashboard|medications|education|consult|history|settings|trends|changes|checkins|notes|timeline|entry|sharing|exports)/i;
  if (supportedHashPattern.test(hash)) {
    window.location.replace(`${appBase}${hash}`);
  }
})();
