// Lists open pull requests and links each to its preview deploy
// (pr-preview/pr-<N>/, published by .github/workflows/deploy.yml).
(function () {
  var REPO = "FreekingDean/freekingdean.github.io";
  var SITE = "https://freekingdean.github.io";
  var API = "https://api.github.com/repos/" + REPO + "/pulls?state=open&per_page=50&sort=updated&direction=desc";
  var CACHE_KEY = "playground-open-prs";
  var CACHE_MS = 5 * 60 * 1000;

  var list = document.getElementById("pr-list");
  if (!list) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function status(text, link) {
    list.textContent = "";
    var li = el("li", "pr-status", text);
    if (link) {
      li.appendChild(document.createTextNode(" "));
      var a = el("a", null, link.text);
      a.href = link.href;
      li.appendChild(a);
    }
    list.appendChild(li);
  }

  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    var units = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
    for (var i = 0; i < units.length; i++) {
      var v = Math.floor(s / units[i][1]);
      if (v >= 1) return v + units[i][0] + " ago";
    }
    return "just now";
  }

  function render(prs) {
    list.textContent = "";
    if (!prs.length) {
      status("Nothing open right now. Everything's shipped!");
      return;
    }
    prs.forEach(function (pr) {
      var li = el("li", "pr");

      var main = el("a", "pr-main");
      main.href = SITE + "/pr-preview/pr-" + pr.number + "/";
      main.title = "Open the preview for #" + pr.number;
      var title = el("span", "pr-title", pr.title);
      var meta = el("span", "pr-meta",
        "#" + pr.number + " · " + (pr.user ? pr.user.login : "someone") +
        " · updated " + ago(pr.updated_at) + (pr.draft ? " · draft" : ""));
      main.appendChild(title);
      main.appendChild(meta);

      var links = el("span", "pr-links");
      var preview = el("a", "pr-btn pr-btn--primary", "Preview");
      preview.href = main.href;
      var gh = el("a", "pr-btn", "GitHub");
      gh.href = pr.html_url;
      links.appendChild(preview);
      links.appendChild(gh);

      li.appendChild(main);
      li.appendChild(links);
      list.appendChild(li);
    });
  }

  function slim(data) {
    return data.map(function (pr) {
      return {
        number: pr.number, title: pr.title, html_url: pr.html_url,
        updated_at: pr.updated_at, draft: pr.draft,
        user: pr.user ? { login: pr.user.login } : null
      };
    });
  }

  function readCache() {
    try {
      var c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      return c && Array.isArray(c.prs) ? c : null;
    } catch (e) { return null; }
  }

  function writeCache(prs) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), prs: prs })); } catch (e) {}
  }

  var cached = readCache();
  if (cached && Date.now() - cached.at < CACHE_MS) {
    render(cached.prs);
    return;
  }

  fetch(API, { headers: { Accept: "application/vnd.github+json" } })
    .then(function (res) {
      if (!res.ok) {
        var err = new Error("HTTP " + res.status);
        err.rateLimited = (res.status === 403 || res.status === 429) &&
          res.headers.get("x-ratelimit-remaining") === "0";
        throw err;
      }
      return res.json();
    })
    .then(function (data) {
      var prs = slim(data);
      writeCache(prs);
      render(prs);
    })
    .catch(function (err) {
      if (cached) { render(cached.prs); return; }
      status(err.rateLimited
        ? "GitHub's rate limit kicked in, so the list can't load right now."
        : "Couldn't load open PRs.",
        { text: "See them on GitHub", href: "https://github.com/" + REPO + "/pulls" });
    });
})();
