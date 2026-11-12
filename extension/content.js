// X Tweets Cleaner — content script
// Runs on https://x.com/<you>/with_replies and repeats the clicks you'd do by hand:
// "..." menu -> Delete -> Confirm   (and Repost -> Undo repost for reposts).

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
    mode: "replies",       // "replies" | "posts" | "all"
    undoReposts: false,
    previewOnly: false,
    delayMs: 4000,
    deleted: 0,
    reposts: 0,
    skipped: 0,
    errors: 0,
    status: "Idle",
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 4s base + up to 50% random extra, so the rhythm doesn't look robotic
  const humanDelay = (ms) => ms + Math.floor(Math.random() * ms * 0.5);

  // ---------- on-page status panel ----------
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
      ${state.running ? `<button id="xtc-stop" style="margin-top:10px;background:linear-gradient(135deg,${C.accent},${C.accent2});color:#fff;border:0;border-radius:999px;padding:5px 16px;cursor:pointer;font-weight:600">Stop</button>` : ""}`;
    const btn = p.querySelector("#xtc-stop");
    if (btn) btn.onclick = () => stop("Stopped");
  }
  function setStatus(s) { state.status = s; render(); }

  // ---------- helpers ----------
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

  // On the Replies tab, a reply sits directly under the post it answers.
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
    if (authorOf(article) !== me) return null;          // someone else's post
    if (hasSocialContext(article)) return null;         // pinned, etc. — left alone
    const reply = isReply(article, me);
    if (state.mode === "all") return "delete";
    if (state.mode === "replies") return reply ? "delete" : null;
    if (state.mode === "posts") return reply ? null : "delete";
    return null;
  }

  function findTargets(me) {
    const out = [];
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (article.dataset.xtcDone) continue;
      const kind = classify(article, me);
      if (!kind) {
        article.dataset.xtcDone = "skip";
        if (authorOf(article) === me) state.skipped++;
        continue;
      }
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
    for (const it of items) { // fallback: X colours Delete red
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

  // ---------- main loop ----------
  async function run() {
    const me = myHandle();
    if (!me) return stop("Couldn't detect your account. Are you logged in?");
    if (!location.pathname.toLowerCase().startsWith(`/${me}/with_replies`)) {
      return stop(`Open x.com/${me}/with_replies first`);
    }

    let emptyScrolls = 0;
    let errorsInRow = 0;

    while (state.running) {
      const targets = findTargets(me);

      if (targets.length === 0) {
        if (++emptyScrolls > 8) return stop(state.previewOnly ? "Scan finished" : "Done. Nothing left to clean.");
        setStatus("Scrolling for more…");
        window.scrollBy(0, window.innerHeight * 1.5);
        await sleep(2000);
        continue;
      }
      emptyScrolls = 0;

      for (const { article, kind } of targets) {
        if (!state.running) break;

        if (state.previewOnly) {
          article.dataset.xtcDone = "preview";
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
      }
    }
  }

  function start(opts) {
    if (state.running) return;
    Object.assign(state, {
      running: true,
      mode: ["replies", "posts", "all"].includes(opts.mode) ? opts.mode : "replies",
      undoReposts: !!opts.undoReposts,
      previewOnly: !!opts.previewOnly,
      delayMs: Math.max(2000, Number(opts.delayMs) || 4000),
      deleted: 0, reposts: 0, skipped: 0, errors: 0,
      status: "Starting…",
    });
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
