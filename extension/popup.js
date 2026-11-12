const $ = (id) => document.getElementById(id);
const modeValue = () => document.querySelector('input[name="mode"]:checked').value;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
const isX = (url) => /^https:\/\/(x|twitter)\.com\//.test(url || "");

function send(tab, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, msg, (res) => resolve(chrome.runtime.lastError ? null : res));
  });
}

function showState(s) {
  if (!s) return;
  const verb = s.previewOnly ? "Found" : "Deleted";
  $("status").innerHTML =
    `${s.status}<br>${verb}: <b>${s.deleted}</b>` +
    (s.undoReposts ? ` · Reposts: <b>${s.reposts}</b>` : "") +
    ` · Skipped: ${s.skipped} · Errors: ${s.errors}`;
}

async function init() {
  const saved = await chrome.storage.local.get(["xtcMode", "xtcDelay", "xtcReposts", "xtcState"]);
  if (saved.xtcMode) document.querySelector(`input[name="mode"][value="${saved.xtcMode}"]`).checked = true;
  if (saved.xtcDelay) $("delay").value = saved.xtcDelay;
  $("reposts").checked = !!saved.xtcReposts;
  showState(saved.xtcState);

  const tab = await activeTab();
  if (!isX(tab.url)) { $("status").textContent = "Open x.com and log in first."; return; }

  const res = await send(tab, { type: "xtc-handle" });
  if (!res) { $("status").textContent = "Reload the X tab once, then open this again."; return; }

  if (res.handle && !new URL(tab.url).pathname.toLowerCase().startsWith(`/${res.handle}/with_replies`)) {
    $("go").style.display = "block";
    $("go").onclick = () => {
      chrome.tabs.update(tab.id, { url: `https://x.com/${res.handle}/with_replies` });
      window.close();
    };
  }
}

async function start(previewOnly) {
  const mode = modeValue();
  const undoReposts = $("reposts").checked;
  const seconds = Math.max(2, Number($("delay").value) || 4);
  $("delay").value = seconds;
  await chrome.storage.local.set({ xtcMode: mode, xtcDelay: seconds, xtcReposts: undoReposts });

  if (!previewOnly) {
    const what = { replies: "all your replies", posts: "all your posts", all: "ALL your posts and replies" }[mode];
    if (!confirm(`Delete ${what}${undoReposts ? " and undo your reposts" : ""}? This can't be undone.`)) return;
  }

  const res = await send(await activeTab(), {
    type: "xtc-start", mode, undoReposts, previewOnly, delayMs: seconds * 1000,
  });
  if (!res) $("status").textContent = "Couldn't reach the page. Reload the X tab and try again.";
}

$("preview").onclick = () => start(true);
$("start").onclick = () => start(false);
$("stop").onclick = async () => send(await activeTab(), { type: "xtc-stop" });

chrome.storage.onChanged.addListener((c) => { if (c.xtcState) showState(c.xtcState.newValue); });

init();
