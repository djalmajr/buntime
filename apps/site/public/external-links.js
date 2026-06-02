// Open every external link in a new tab, with safe rel attributes.
// Runs site-wide (injected via the Starlight `head` config) so it covers
// Markdown content links and the Starlight chrome alike (header social icon,
// hero actions, edit-page link). Internal and anchor links are left untouched.
(() => {
  const apply = () => {
    const { origin } = location;
    for (const a of document.querySelectorAll("a[href]")) {
      let url;
      try {
        url = new URL(a.href, location.href);
      } catch {
        continue;
      }
      const isHttp = url.protocol === "http:" || url.protocol === "https:";
      if (!isHttp || url.origin === origin) continue;
      a.target = "_blank";
      const rel = new Set((a.rel || "").split(/\s+/).filter(Boolean));
      rel.add("noopener");
      rel.add("noreferrer");
      a.rel = [...rel].join(" ");
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
})();
