// X Tweets Cleaner content script.
// Runs on the signed-in user's Replies timeline and performs the selected cleanup
// action through X's visible controls: open the post menu, choose Delete, and confirm.

(() => {
  if (window.__xTweetsCleanerLoaded) return;
  window.__xTweetsCleanerLoaded = true;

  const DELETE_WORDS = ["delete", "حذف", "supprimer", "eliminar", "löschen", "excluir", "elimina", "sil", "削除", "삭제"];
  const REPLYING_WORDS = ["replying to", "ردًا على", "رداً على", "رد على", "en réponse à", "en respuesta a", "antwort an"];

  const C = {
    bg: "#140c2a", card: "#1d1338", border: "rgba(167,139,250,.35)",
    text: "#efe9ff", dim: "#a99cc9", accent: "#a78bfa", accent2: "#7c3aed",
  };

  const state = {
    running: false,
    mode: "replies",       // Selects which of the user's replies and posts are eligible.
    undoReposts: false,
    previewOnly: false,
    delayMs: 4000,
    dateFilterEnabled: false,
    dateFrom: "",
    dateTo: "",
    deleted: 0,
    reposts: 0,
    skipped: 0,
    dateExcluded: 0,
    dateUnknown: 0,
    errors: 0,
    status: "Idle",
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Add a small random variation so actions do not run at perfectly fixed intervals.
  const humanDelay = (ms) => ms + Math.floor(Math.random() * ms * 0.5);
  let countedDateExcluded = new Set();
  let countedDateUnknown = new Set();
  let handledTweets = new Set();
  let observedTweetKeys = new Set();

  // ---------- On-page status panel ----------
  let panel;
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement("div");
    panel.id = "xtc-panel";
    panel.style.cssText = `
      position:fixed;bottom:20px;left:20px;z-index:999999;
      background:linear-gradient(160deg,${C.card},${C.bg});color:${C.text};
      border:1px solid ${C.border};border-radius:16px;padding:14px 16px;
      font:13px/1.55 "IBM Plex Sans",system-ui,sans-serif;min-width:240px;
      box-shadow:0 10px 40px rgba(76,29,149,.45),0 0 0 1px rgba(255,255,255,.03) inset;`;
    document.body.appendChild(panel);
    return panel;
  }

  function render() {
    chrome.storage.local.set({ xtcState: { ...state } });
    if (!state.running && state.status === "Idle") { if (panel) panel.remove(); return; }
    const p = ensurePanel();
    const verb = state.previewOnly ? "Found" : "Deleted";
    p.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;color:${C.accent};letter-spacing:.2px">✦ X Tweets Cleaner</div>
      <div style="color:${C.text}">${state.status}</div>
      <div style="color:${C.dim};margin-top:2px">${verb}: <b style="color:${C.text}">${state.deleted}</b>
        ${state.undoReposts ? ` · Reposts: <b style="color:${C.text}">${state.reposts}</b>` : ""}
        · Skipped: ${state.skipped} · Errors: ${state.errors}</div>
      ${state.dateFilterEnabled ? `<div style="color:${C.dim};margin-top:3px">Date range: excluded ${state.dateExcluded} · unknown dates ${state.dateUnknown}</div>` : ""}
      ${state.running ? `<button id="xtc-stop" style="margin-top:10px;background:linear-gradient(135deg,${C.accent},${C.accent2});color:#fff;border:0;border-radius:999px;padding:5px 16px;cursor:pointer;font-weight:600">Stop</button>` : ""}`;
    const btn = p.querySelector("#xtc-stop");
    if (btn) btn.onclick = () => stop("Stopped");
  }
  function setStatus(s) { state.status = s; render(); }

  // ---------- Timeline and tweet helpers ----------
  function myHandle() {
    const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    return a ? a.getAttribute("href").replace("/", "").toLowerCase() : null;
  }

  function authorOf(article) {
    const link = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
    return link ? (link.getAttribute("href").split("/")[1] || "").toLowerCase() : null;
  }

  const hasSocialContext = (a) => !!a.querySelector('[data-testid="socialContext"]');
  const isMyRepost = (a) => !!a.querySelector('[data-testid="unretweet"]') && hasSocialContext(a);

  function hasReplyingTo(article) {
    const text = (article.innerText || "").toLowerCase();
    return REPLYING_WORDS.some((w) => text.includes(w));
  }

  // On the Replies timeline, X often places a reply directly after the post it answers.
  // Use that neighboring post as a fallback when localized reply text is unavailable.
  function isReply(article, me) {
    if (hasReplyingTo(article)) return true;
    const cell = article.closest('[data-testid="cellInnerDiv"]');
    const prevArticle = cell?.previousElementSibling?.querySelector('article[data-testid="tweet"]');
    if (!prevArticle || hasSocialContext(prevArticle)) return false;
    const prevAuthor = authorOf(prevArticle);
    return !!prevAuthor && prevAuthor !== me;
  }

  function classify(article, me) {
    if (state.undoReposts && isMyRepost(article)) return "repost";
    if (authorOf(article) !== me) return null;          // Never act on another user's post.
    if (hasSocialContext(article)) return null;         // Leave contextual items, such as pins, alone.
    const reply = isReply(article, me);
    if (state.mode === "all") return "delete";
    if (state.mode === "replies") return reply ? "delete" : null;
    if (state.mode === "posts") return reply ? null : "delete";
    return null;
  }

  function tweetKey(article) {
    // Status IDs stay stable when the timeline re-renders the same tweet.
    const link = [...article.querySelectorAll('a[href*="/status/"]')]
      .find((a) => /\/status\/\d+/.test(a.getAttribute("href") || ""));
    const match = link?.getAttribute("href")?.match(/\/status\/(\d+)/);
    return match ? `status:${match[1]}` : article;
  }

  function noteNewTweets() {
    let added = 0;
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const key = tweetKey(article);
      if (observedTweetKeys.has(key)) continue;
      observedTweetKeys.add(key);
      added++;
    }
    return added;
  }

  function publicationDate(article) {
    // Prefer machine-readable timestamps; fall back to other date text exposed by X.
    const time = article.querySelector("time");
    const candidates = [time?.getAttribute("datetime"), time?.getAttribute("title"), time?.getAttribute("aria-label"), time?.textContent];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const value = candidate.trim();
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  }

  function rangeBounds() {
    // Treat the selected end date as inclusive by using the start of the next day.
    const [fy, fm, fd] = (state.dateFrom || "").split("-").map(Number);
    const [ty, tm, td] = (state.dateTo || "").split("-").map(Number);
    return {
      from: fy ? new Date(fy, fm - 1, fd).getTime() : -Infinity,
      to: ty ? new Date(ty, tm - 1, td + 1).getTime() : Infinity,
    };
  }

  function dateEligibility(article) {
    if (!state.dateFilterEnabled) return "eligible";
    const date = publicationDate(article);
    if (!date) return "unknown";
    const bounds = rangeBounds();
    const time = date.getTime();
    return time >= bounds.from && time < bounds.to ? "eligible" : "outside";
  }

  function noteDateSkip(article, reason) {
    const key = tweetKey(article);
    const set = reason === "outside" ? countedDateExcluded : countedDateUnknown;
    if (set.has(key)) return;
    set.add(key);
    if (reason === "outside") state.dateExcluded++;
    else state.dateUnknown++;
  }

  function findTargets(me) {
    // Mark each visible article as handled or skipped so repeated scans do not
    // keep reconsidering the same DOM node.
    const out = [];
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (article.dataset.xtcDone) continue;
      const kind = classify(article, me);
      if (!kind) {
        article.dataset.xtcDone = "skip";
        if (authorOf(article) === me) state.skipped++;
        continue;
      }
      const key = tweetKey(article);
      if (state.dateFilterEnabled) {
        if (handledTweets.has(key)) {
          article.dataset.xtcDone = "duplicate";
          continue;
        }
      }
      const dateResult = dateEligibility(article);
      if (dateResult !== "eligible") {
        noteDateSkip(article, dateResult);
        article.dataset.xtcDone = dateResult === "outside" ? "date-outside" : "date-unknown";
        continue;
      }
      if (state.dateFilterEnabled) handledTweets.add(key);
      out.push({ article, kind });
    }
    return out;
  }

  async function waitFor(fn, timeout = 5000, step = 100) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  function findDeleteMenuItem() {
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    for (const it of items) {
      const t = (it.innerText || "").trim().toLowerCase();
      if (DELETE_WORDS.some((w) => t === w || t.startsWith(w))) return it;
    }
    // If the menu label is localized or unexpected, use X's red destructive-action color.
    for (const it of items) {
      const span = it.querySelector("span");
      if (span && getComputedStyle(span).color === "rgb(244, 33, 46)") return it;
    }
    return null;
  }

  const closeMenus = () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  async function deleteArticle(article) {
    article.scrollIntoView({ block: "center" });
    await sleep(400 + Math.random() * 400);
    const caret = article.querySelector('[data-testid="caret"]');
    if (!caret) throw new Error("No menu button");
    caret.click();
    const del = await waitFor(findDeleteMenuItem);
    if (!del) { closeMenus(); throw new Error("Delete option not found"); }
    await sleep(250 + Math.random() * 300);
    del.click();
    const confirm = await waitFor(() => document.querySelector('[data-testid="confirmationSheetConfirm"]'));
    if (!confirm) { closeMenus(); throw new Error("Confirm button not found"); }
    await sleep(250 + Math.random() * 300);
    confirm.click();
    await waitFor(() => !article.isConnected, 6000);
  }

  async function undoRepost(article) {
    article.scrollIntoView({ block: "center" });
    await sleep(400 + Math.random() * 400);
    const btn = article.querySelector('[data-testid="unretweet"]');
    if (!btn) throw new Error("Repost button not found");
    btn.click();
    const confirm = await waitFor(() => document.querySelector('[data-testid="unretweetConfirm"]'));
    if (!confirm) { closeMenus(); throw new Error("Undo repost not found"); }
    await sleep(250 + Math.random() * 300);
    confirm.click();
    await sleep(800);
  }

  // ---------- Timeline scan and cleanup loop ----------
  async function run() {
    const me = myHandle();
    if (!me) return stop("Couldn't detect your account. Are you logged in?");
    if (!location.pathname.toLowerCase().startsWith(`/${me}/with_replies`)) {
      return stop(`Open x.com/${me}/with_replies first`);
    }

    let emptyScrolls = 0;
    let stalledScrolls = 0;
    noteNewTweets();
    let errorsInRow = 0;

    while (state.running) {
      const targets = findTargets(me);

      if (targets.length === 0) {
        // Keep scrolling until the timeline stops yielding new items, or the
        // regular non-date scan has made several empty passes.
        if (!state.dateFilterEnabled && ++emptyScrolls > 8) {
          return stop(state.previewOnly ? "Scan finished" : "Done. Nothing left to clean.");
        }
        if (state.dateFilterEnabled && stalledScrolls >= 15) {
          return stop(state.previewOnly ? "Scan finished. No more posts loaded." : "Done. No more posts loaded.");
        }
        setStatus("Scrolling for more…");
        window.scrollBy(0, window.innerHeight * 1.5);
        await sleep(2000);
        if (state.dateFilterEnabled) {
          if (noteNewTweets() > 0) stalledScrolls = 0;
          else stalledScrolls++;
        }
        continue;
      }
      emptyScrolls = 0;
      stalledScrolls = 0;

      for (const { article, kind } of targets) {
        if (!state.running) break;

        // Recheck the date immediately before acting in case the queued item changed.
        const dateResult = dateEligibility(article);
        if (dateResult !== "eligible") {
          noteDateSkip(article, dateResult);
          article.dataset.xtcDone = dateResult === "outside" ? "date-outside" : "date-unknown";
          render();
          continue;
        }

        if (state.previewOnly) {
          article.dataset.xtcDone = "preview";
          article.dataset.xtcPreviewOutline = "true";
          article.style.outline = `3px solid ${kind === "repost" ? "#38bdf8" : C.accent}`;
          article.style.outlineOffset = "-3px";
          kind === "repost" ? state.reposts++ : state.deleted++;
          render();
          continue;
        }

        try {
          if (kind === "repost") {
            setStatus("Undoing repost…");
            await undoRepost(article);
            state.reposts++;
          } else {
            setStatus("Deleting…");
            await deleteArticle(article);
            state.deleted++;
          }
          if (article.isConnected) article.dataset.xtcDone = "done";
          errorsInRow = 0;
          render();
          setStatus(`Waiting ${Math.round(state.delayMs / 1000)}s+ (anti-bot pause)…`);
          await sleep(humanDelay(state.delayMs));
        } catch (e) {
          article.dataset.xtcDone = "error";
          state.errors++;
          errorsInRow++;
          console.warn("[X Tweets Cleaner]", e);
          render();
          if (errorsInRow >= 4) {
            setStatus("Several errors in a row. Cooling down for 2 minutes…");
            await sleep(120000);
            errorsInRow = 0;
          } else {
            await sleep(3000);
          }
        }
      }

      if (state.previewOnly) {
        window.scrollBy(0, window.innerHeight * 1.5);
        await sleep(1500);
        if (state.dateFilterEnabled) {
          if (noteNewTweets() > 0) stalledScrolls = 0;
          else stalledScrolls++;
        }
      }
    }
  }

  function start(opts) {
    if (state.running) return;
    if (opts.dateFilterEnabled && opts.dateFrom && opts.dateTo && opts.dateFrom > opts.dateTo) {
      state.running = false;
      state.status = "Invalid date range: From Date must be on or before To Date.";
      render();
      return;
    }
    if (opts.dateFilterEnabled) {
      for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
        delete article.dataset.xtcDone;
        if (article.dataset.xtcPreviewOutline) {
          article.style.removeProperty("outline");
          article.style.removeProperty("outline-offset");
          delete article.dataset.xtcPreviewOutline;
        }
      }
    }
    Object.assign(state, {
      running: true,
      mode: ["replies", "posts", "all"].includes(opts.mode) ? opts.mode : "replies",
      undoReposts: !!opts.undoReposts,
      previewOnly: !!opts.previewOnly,
      dateFilterEnabled: !!opts.dateFilterEnabled,
      dateFrom: typeof opts.dateFrom === "string" ? opts.dateFrom : "",
      dateTo: typeof opts.dateTo === "string" ? opts.dateTo : "",
      delayMs: Math.max(2000, Number(opts.delayMs) || 4000),
      deleted: 0, reposts: 0, skipped: 0, dateExcluded: 0, dateUnknown: 0, errors: 0,
      status: "Starting…",
    });
    countedDateExcluded = new Set();
    countedDateUnknown = new Set();
    handledTweets = new Set();
    observedTweetKeys = new Set();
    render();
    run().catch((e) => stop("Error: " + e.message));
  }

  function stop(msg) {
    state.running = false;
    state.status = msg || "Stopped";
    render();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "xtc-handle") { reply({ handle: myHandle() }); return; }
    if (msg.type === "xtc-start") start(msg);
    else if (msg.type === "xtc-stop") stop("Stopped");
    reply({ ok: true, state: { ...state } });
  });
})();
