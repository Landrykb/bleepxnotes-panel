/* BleepxNotes Mini App — group control centre.
 *
 * Data pattern (see INTEGRATION.md): the bot opens this app with a signed,
 * short-lived state snapshot in the URL fragment (#state=...). Mutations go
 * back to the bot via Telegram.WebApp.sendData with the action contract:
 *   { action, chat_id, value }
 *   toggle_autojoin | toggle_summaries  -> value: boolean
 *   set_lang                            -> value: "fr" | "en"
 *   pause_group | resume_group | unregister_group -> value: null
 *
 * Demo mode: when there is no Telegram initData (plain browser / local
 * preview), mock data is loaded, a "Demo data" badge is shown, and sendData
 * calls are logged + toasted instead of sent.
 */
"use strict";

/* ------------------------------------------------------------------ setup */

const tg = (window.Telegram && window.Telegram.WebApp) || null;
const DEMO = !tg || !tg.initData;

if (tg) {
  tg.ready();
  tg.expand();
  if (typeof tg.setHeaderColor === "function") {
    try { tg.setHeaderColor("bg_color"); } catch (e) { /* older clients */ }
  }
}

const $ = (id) => document.getElementById(id);
const els = {
  demoBadge: $("demo-badge"),
  list: $("view-list"),
  groupList: $("group-list"),
  groupCount: $("group-count"),
  listEmpty: $("list-empty"),
  detail: $("view-detail"),
  dTitle: $("d-title"),
  dStatus: $("d-status"),
  dListener: $("d-listener"),
  dCapture: $("d-capture"),
  dChatId: $("d-chatid"),
  dNoteRow: $("d-note-row"),
  dNote: $("d-note"),
  dAutojoin: $("d-autojoin"),
  dSummaries: $("d-summaries"),
  dLangFr: $("d-lang-fr"),
  dLangEn: $("d-lang-en"),
  dPause: $("d-pause"),
  dUnregister: $("d-unregister"),
  toast: $("toast"),
};

/* ------------------------------------------------------------- mock data */

const MOCK_GROUPS = [
  {
    chat_id: -1002001001, title: "IN4BOX — Team", status: "active",
    listener_present: true, lang: "fr", autojoin: true, summaries: true,
    first_call: "verified", note: null,
  },
  {
    chat_id: -1002001002, title: "Book Club — Harold & Landry", status: "degraded",
    listener_present: false, lang: "en", autojoin: true, summaries: true,
    first_call: "verified", note: "Listener not seen in the group — capture paused until it rejoins.",
  },
  {
    chat_id: -1002001003, title: "Weekend Runners", status: "paused",
    listener_present: true, lang: "en", autojoin: false, summaries: true,
    first_call: "pending", note: "Paused from the control centre.",
  },
  {
    chat_id: -1002001004, title: "Studio Sessions", status: "needs_action",
    listener_present: false, lang: "fr", autojoin: true, summaries: false,
    first_call: "pending", note: "Bot needs admin with invite rights to finish pairing — or add the listener account manually once.",
  },
];

/* ------------------------------------------------------------ state load */

/* State snapshot handed over by the bot in the URL fragment:
 *   #state=<base64url(JSON)> — the fragment never leaves the device, so the
 *   snapshot is not sent to the static host. Signature/expiry ride inside
 *   the JSON (checked cosmetically here; the bot re-validates everything
 *   that matters on the sendData side — see INTEGRATION.md). */
function loadStateFromUrl() {
  const hash = window.location.hash || "";
  const m = hash.match(/(?:^|[&#])state=([^&]+)/);
  if (!m) return null;
  try {
    /* The bot's token is <base64url>.<hmac-hex> — decode only the body. */
    const b64url = m[1].split(".")[0];
    let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = decodeURIComponent(escape(window.atob(b64)));
    const parsed = JSON.parse(json);
    if (parsed && Array.isArray(parsed.groups)) return parsed.groups;
  } catch (e) {
    console.warn("Could not parse #state snapshot:", e);
  }
  return null;
}

let groups;
if (DEMO) {
  groups = MOCK_GROUPS.slice();
  els.demoBadge.hidden = false;
} else {
  groups = loadStateFromUrl() || [];
}

let current = null; // group object shown in the detail view

/* --------------------------------------------------------------- helpers */

const STATUS_META = {
  active:           { label: "Active" },
  degraded:         { label: "Degraded" },
  paused:           { label: "Paused" },
  pending_approval: { label: "Pending approval" },
  needs_action:     { label: "Needs action" },
  bot_absent:       { label: "Bot absent" },
  unregistered:     { label: "Unregistered" },
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function icon(name) {
  return '<svg class="ic"><use href="#i-' + name + '"/></svg>';
}

function haptic(kind, arg) {
  if (!tg || !tg.HapticFeedback) return;
  try {
    if (kind === "impact") tg.HapticFeedback.impactOccurred(arg || "light");
    else if (kind === "selection") tg.HapticFeedback.selectionChanged();
    else if (kind === "notify") tg.HapticFeedback.notificationOccurred(arg || "success");
  } catch (e) { /* haptics are best-effort */ }
}

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 2200);
}

/* ------------------------------------------------------------ sendData */

function sendAction(action, chatId, value) {
  const payload = {
    action: action,
    chat_id: chatId,
    value: value === undefined ? null : value,
    /* Raw initData so the bot can HMAC-validate the sender before applying
     * anything (see INTEGRATION.md). The action contract above is unchanged. */
    init_data: tg ? tg.initData : "",
  };
  if (DEMO) {
    console.log("[demo] sendData:", JSON.stringify(payload));
    toast("Demo: " + action.replace(/_/g, " ") + " (not sent)");
    return;
  }
  /* NOTE: per Telegram's contract, sendData delivers a web_app_data service
   * message to the bot; the bot applies the change and confirms in chat. */
  tg.sendData(JSON.stringify(payload));
}

/* ------------------------------------------------------------ list view */

function healthHtml(g) {
  if (g.listener_present) {
    return '<span class="dot ok"></span> Listener in group';
  }
  if (g.status === "paused") {
    return '<span class="dot off"></span> Paused';
  }
  return '<span class="dot bad"></span> Listener not in group';
}

function renderList() {
  els.groupCount.textContent = groups.length ? String(groups.length) : "";
  els.listEmpty.hidden = groups.length > 0;
  els.groupList.innerHTML = groups.map((g) => {
    const meta = STATUS_META[g.status] || { label: g.status };
    const langLabel = g.lang === "fr" ? "Français" : "English";
    return (
      '<article class="group-card" data-chat-id="' + g.chat_id + '" role="button" tabindex="0">' +
        '<div class="gc-top">' +
          '<span class="gc-name">' + esc(g.title) + "</span>" +
          '<span class="pill st-' + esc(g.status) + '">' + esc(meta.label) + "</span>" +
        "</div>" +
        '<div class="gc-health">' + healthHtml(g) + "</div>" +
        '<div class="gc-chips">' +
          '<span class="chip">' + icon("globe") + langLabel + "</span>" +
          '<span class="chip' + (g.autojoin ? "" : " off") + '">' + icon("mic") +
            (g.autojoin ? "Auto-join on" : "Auto-join off") + "</span>" +
          '<span class="chip' + (g.summaries ? "" : " off") + '">' + icon("bell") +
            (g.summaries ? "Summaries on" : "Summaries off") + "</span>" +
        "</div>" +
      "</article>"
    );
  }).join("");

  els.groupList.querySelectorAll(".group-card").forEach((card) => {
    const open = () => {
      const id = Number(card.getAttribute("data-chat-id"));
      const g = groups.find((x) => x.chat_id === id);
      if (g) { haptic("selection"); openDetail(g); }
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
}

/* ---------------------------------------------------------- detail view */

function setSwitch(btn, on) {
  btn.setAttribute("aria-checked", on ? "true" : "false");
}

function renderDetail() {
  const g = current;
  if (!g) return;
  const meta = STATUS_META[g.status] || { label: g.status };
  els.dTitle.textContent = g.title;
  els.dStatus.className = "pill st-" + g.status;
  els.dStatus.textContent = meta.label;

  els.dListener.innerHTML = g.listener_present
    ? icon("check") + '<span class="row-value good">In group</span>'
    : icon("warn") + '<span class="row-value bad">Not in group</span>';
  els.dListener.className = "row-value";

  if (g.first_call === "verified") {
    els.dCapture.innerHTML = icon("check") + " Verified — real audio captured";
    els.dCapture.className = "row-value good";
  } else {
    els.dCapture.innerHTML = icon("clock") + " Pending — checked on the first call";
    els.dCapture.className = "row-value";
  }

  els.dChatId.textContent = String(g.chat_id);

  if (g.note) {
    els.dNoteRow.hidden = false;
    els.dNote.textContent = g.note;
  } else {
    els.dNoteRow.hidden = true;
  }

  setSwitch(els.dAutojoin, !!g.autojoin);
  setSwitch(els.dSummaries, !!g.summaries);
  els.dLangFr.classList.toggle("active", g.lang === "fr");
  els.dLangEn.classList.toggle("active", g.lang === "en");

  const paused = g.status === "paused";
  els.dPause.innerHTML = paused
    ? icon("play") + " Resume group"
    : icon("pause") + " Pause group";
  els.dPause.hidden = g.status === "unregistered";
  els.dUnregister.hidden = g.status === "unregistered";
}

function openDetail(g) {
  current = g;
  renderDetail();
  els.list.hidden = true;
  els.detail.hidden = false;
  if (tg && tg.BackButton) {
    tg.BackButton.show();
  }
  window.scrollTo(0, 0);
}

function closeDetail() {
  current = null;
  els.detail.hidden = true;
  els.list.hidden = false;
  if (tg && tg.BackButton) {
    tg.BackButton.hide();
  }
  renderList();
  window.scrollTo(0, 0);
}

if (tg && tg.BackButton && typeof tg.BackButton.onClick === "function") {
  tg.BackButton.onClick(() => { if (current) { haptic("selection"); closeDetail(); } });
}

/* ------------------------------------------------------------ mutations */

function applyLocal(mutator) {
  if (!current) return;
  mutator(current);
  renderDetail();
}

els.dAutojoin.addEventListener("click", () => {
  if (!current) return;
  const next = !current.autojoin;
  haptic("impact", "light");
  sendAction("toggle_autojoin", current.chat_id, next);
  applyLocal((g) => { g.autojoin = next; });
  if (!DEMO) toast("Auto-join " + (next ? "on" : "off") + " — sent to the bot");
});

els.dSummaries.addEventListener("click", () => {
  if (!current) return;
  const next = !current.summaries;
  haptic("impact", "light");
  sendAction("toggle_summaries", current.chat_id, next);
  applyLocal((g) => { g.summaries = next; });
  if (!DEMO) toast("Summaries " + (next ? "on" : "off") + " — sent to the bot");
});

function setLang(lang) {
  if (!current || current.lang === lang) return;
  haptic("selection");
  sendAction("set_lang", current.chat_id, lang);
  applyLocal((g) => { g.lang = lang; });
  if (!DEMO) toast("Language set — sent to the bot");
}
els.dLangFr.addEventListener("click", () => setLang("fr"));
els.dLangEn.addEventListener("click", () => setLang("en"));

els.dPause.addEventListener("click", () => {
  if (!current) return;
  const paused = current.status === "paused";
  haptic("impact", "medium");
  if (paused) {
    sendAction("resume_group", current.chat_id, null);
    applyLocal((g) => { g.status = g.listener_present ? "active" : "degraded"; g.note = null; });
    if (!DEMO) toast("Resume sent to the bot");
  } else {
    sendAction("pause_group", current.chat_id, null);
    applyLocal((g) => { g.status = "paused"; });
    if (!DEMO) toast("Pause sent to the bot");
  }
});

els.dUnregister.addEventListener("click", () => {
  if (!current) return;
  const g = current;
  const msg = "Unregister \u201C" + g.title + "\u201D? BleepxNotes will stop capturing calls in this group.";
  const doIt = () => {
    haptic("notify", "warning");
    sendAction("unregister_group", g.chat_id, null);
    groups = groups.filter((x) => x.chat_id !== g.chat_id);
    closeDetail();
    toast("Group unregistered" + (DEMO ? " (demo)" : ""));
  };
  if (tg && typeof tg.showConfirm === "function") {
    tg.showConfirm(msg, (ok) => { if (ok) doIt(); });
  } else if (window.confirm(msg)) {
    doIt();
  }
});

/* ----------------------------------------------------------------- boot */

renderList();
