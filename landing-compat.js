(() => {
  const hash = window.location.hash || "";
  if (!hash) return;

  const legacyHashPattern = /^#(?:invite=|dashboard|medications|education|consult|history|settings|trends|changes|checkins|notes|timeline|entry|sharing|exports|share=)/i;
  if (legacyHashPattern.test(hash)) {
    window.location.replace(`/app${hash}`);
  }
})();
