/* BleepxNotes Mini App — group control centre.
 *
 * Data pattern (see INTEGRATION.md): the bot opens this app with a signed,
 * short-lived state snapshot in the URL fragment (#state=...). Mutations go
 * back to the bot via Telegram.WebApp.sendData with the action contract:
 *   { action, chat_id, value }
 *   toggle_autojoin | toggle_summaries  -> value: boolean
 *   set_lang                            -> value: "fr" | "en"
 *   pause_group | resume_group | unregister_group -> value: null
 *   join_group | stop_group             -> value: null (live commands)
 *   send_summary                        -> value: null (full text to the DM;
 *                                          the text itself is already in
 *                                          the snapshot, readable in-panel)
 *   send_history_summary                -> value: meeting id (full summary
 *                                          of that past meeting to the DM)
 *   send_recording                      -> value: meeting id (the meeting's
 *                                          kept audio files to the DM)
 *   activate_group | ignore_activation  -> value: null (activation flow)
 *
 * Group history rides in the snapshot as METADATA only (per group:
 * `history`: [{id, dur, sum, rec}] newest-first + `history_more`):
 * the meeting id is its timestamp (YYYYMMDD-HHMMSS dir name), `sum`
 * is the summary's length in chars (0 = none), `rec` flags a kept
 * recording. Texts and audio never ride in the URL — the two actions
 * above fetch them through the bot, which re-checks ownership
 * against the live manifest before sending anything.
 *
 * The panel is self-contained: live status and the latest summary are
 * read from the snapshot on this screen — nothing sends the user back
 * to the chat to type a command.
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
  dLive: $("d-live"),
  dListener: $("d-listener"),
  dCapture: $("d-capture"),
  dChatId: $("d-chatid"),
  dNoteRow: $("d-note-row"),
  dNote: $("d-note"),
  dJoinStopRow: $("d-joinstop-row"),
  dJoin: $("d-join"),
  dStop: $("d-stop"),
  dActivate: $("d-activate"),
  dActivateLabel: $("d-activate-label"),
  dIgnore: $("d-ignore"),
  dCmdHint: $("d-cmd-hint"),
  dAutojoin: $("d-autojoin"),
  dSummaries: $("d-summaries"),
  dLangFr: $("d-lang-fr"),
  dLangEn: $("d-lang-en"),
  dSummaryBlock: $("d-summary-block"),
  dSummaryDate: $("d-summary-date"),
  dSummaryText: $("d-summary-text"),
  dSummaryTrunc: $("d-summary-trunc"),
  dSendSummary: $("d-send-summary"),
  dSummaryNone: $("d-summary-none"),
  dHistory: $("d-history"),
  dHistoryNone: $("d-history-none"),
  dHistoryMore: $("d-history-more"),
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
    listener_state: "recording", in_call: true, call_started_at: 1730000000,
    summary: {
      date: "2026-11-04", truncated: false,
      text: "Résumé — IN4BOX — Team\n\n• Point d'avancement : la maquette du panneau est validée.\n• Décision : lancement du pilote en janvier.\n• Action : Landry envoie la liste des producteurs avant vendredi.",
    },
    history: [
      { id: "20261104-193000", dur: 1740, sum: 812, rec: 1 },
      { id: "20261102-100500", dur: 905, sum: 640, rec: 0 },
    ],
    history_more: false,
  },
  {
    chat_id: -1002001002, title: "Book Club — Harold & Landry", status: "degraded",
    listener_present: false, lang: "en", autojoin: true, summaries: true,
    first_call: "verified", note: "Listener not seen in the group — capture paused until it rejoins.",
    listener_state: "recording", in_call: false, call_started_at: null,
    summary: null,
    history: [],
    history_more: false,
  },
  {
    chat_id: -1002001003, title: "Weekend Runners", status: "paused",
    listener_present: true, lang: "en", autojoin: false, summaries: true,
    first_call: "pending", note: "Paused from the control centre.",
    listener_state: "recording", in_call: false, call_started_at: null,
    summary: {
      date: "2026-11-01", truncated: false,
      text: "Summary — Weekend Runners\n\n• Sunday route confirmed: river loop, 12 km.\n• Action: Sam brings the water station list.",
    },
    history: [
      { id: "20261101-083000", dur: 1500, sum: 640, rec: 0 },
    ],
    history_more: false,
  },
  {
    chat_id: -1002001004, title: "Studio Sessions", status: "needs_action",
    listener_present: false, lang: "fr", autojoin: true, summaries: false,
    first_call: "pending", note: "Bot needs admin with invite rights to finish pairing — or add the listener account manually once.",
    listener_state: "recording", in_call: false, call_started_at: null,
    summary: null,
    history: [],
    history_more: false,
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
  awaiting_activation: { label: "Awaiting activation" },
  pairing:          { label: "Activating…" },
  pairing_failed:   { label: "Activation failed" },
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

function fmtTime(unixSeconds) {
  try {
    return new Date(unixSeconds * 1000).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit",
    });
  } catch (e) {
    return "";
  }
}

/* History entries: the meeting id IS the timestamp (YYYYMMDD-HHMMSS). */
function fmtMeetingStamp(id) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(id || "");
  if (!m) return id || "";
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  try {
    return d.toLocaleDateString([], {
      day: "numeric", month: "short", year: "numeric",
    }) + " · " + d.toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit",
    });
  } catch (e) {
    return m[1] + "-" + m[2] + "-" + m[3];
  }
}

function fmtDuration(seconds) {
  if (seconds == null) return "";
  const s = Math.max(0, Math.round(seconds));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return mm + ":" + ss;
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

  /* Live state, read straight from the snapshot: this group recording,
   * the (single) listener busy in another group, or idle. */
  if (g.in_call) {
    els.dLive.innerHTML = '<span class="rec-dot"></span> Recording' +
      (g.call_started_at ? " — since " + esc(fmtTime(g.call_started_at)) : "");
    els.dLive.className = "row-value rec";
  } else if (g.listener_state === "recording") {
    els.dLive.textContent = "In a call in another group";
    els.dLive.className = "row-value";
  } else if (g.listener_state === "error") {
    els.dLive.innerHTML = icon("warn") + " Error — the bot reports it in its chat";
    els.dLive.className = "row-value bad";
  } else if (g.listener_state === "unknown") {
    els.dLive.textContent = "Unknown";
    els.dLive.className = "row-value";
  } else {
    els.dLive.textContent = "Idle";
    els.dLive.className = "row-value";
  }

  /* Commands: Start/Stop only make sense on a capture-active group,
   * so other states get their own working action (activation) or an
   * honest hint — never a dead button, never "go type a command". */
  const st = g.status;
  const busyElsewhere = g.listener_state === "recording" && !g.in_call;
  els.dJoinStopRow.hidden = st !== "active";
  els.dJoin.disabled = g.in_call || !g.listener_present || busyElsewhere;
  els.dStop.disabled = !g.in_call;
  const activatable = ["awaiting_activation", "needs_action",
    "pairing_failed", "bot_absent"].includes(st);
  els.dActivate.hidden = !(activatable || st === "pending_approval");
  els.dActivateLabel.textContent = st === "pending_approval"
    ? "Approve activation" : "Activate BleepxNotes";
  els.dIgnore.hidden = st !== "pending_approval";
  let hint = null;
  if (st === "active" && g.in_call) {
    hint = "Recording now — Stop ends the call and keeps the recording.";
  } else if (st === "active" && busyElsewhere) {
    hint = "The notetaker is in a call in another group — it runs one call at a time.";
  } else if (st === "paused") {
    hint = "This group is paused. Resume it below to run commands here.";
  } else if (st === "degraded") {
    hint = "The listener is not in this group — commands return when it rejoins.";
  } else if (st === "pairing") {
    hint = "Activation in progress — the listener is joining this group.";
  } else if (st === "pending_approval") {
    hint = "A group admin asked to activate BleepxNotes here. Approve it from this screen, or ignore the request.";
  }
  els.dCmdHint.hidden = !hint;
  els.dCmdHint.textContent = hint || "";

  /* Latest summary: the text itself is in the snapshot — reading it
   * never leaves this screen. */
  if (g.summary) {
    els.dSummaryBlock.hidden = false;
    els.dSummaryNone.hidden = true;
    els.dSummaryDate.textContent = g.summary.date || "—";
    els.dSummaryText.textContent = g.summary.text || "";
    els.dSummaryTrunc.hidden = !g.summary.truncated;
  } else {
    els.dSummaryBlock.hidden = true;
    els.dSummaryNone.hidden = false;
  }

  renderHistory();

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

/* Meeting history: metadata from the snapshot; the summary text and
 * the recording itself are fetched through the bot (sendData), which
 * re-checks that the meeting belongs to this group before sending. */
function renderHistory() {
  const g = current;
  if (!g) return;
  const hist = Array.isArray(g.history) ? g.history : [];
  els.dHistoryNone.hidden = hist.length > 0;
  els.dHistoryMore.hidden = !g.history_more;
  els.dHistory.innerHTML = hist.map((e) => {
    const bits = [];
    const dur = fmtDuration(e.dur);
    if (dur) bits.push(dur);
    bits.push(e.sum > 0 ? "Summary kept" : "No summary");
    if (e.rec) bits.push("Recording kept");
    let buttons = "";
    if (e.sum > 0) {
      buttons += '<button class="btn btn-ghost hist-btn" data-act="sum" data-id="' +
        esc(e.id) + '">' + icon("file") + " Summary</button>";
    }
    if (e.rec) {
      buttons += '<button class="btn btn-ghost hist-btn" data-act="rec" data-id="' +
        esc(e.id) + '">' + icon("mic") + " Recording</button>";
    }
    return (
      '<div class="hist-row">' +
        '<div class="hist-main">' +
          '<span class="hist-when">' + esc(fmtMeetingStamp(e.id)) + "</span>" +
          '<span class="hist-meta">' + esc(bits.join(" · ")) + "</span>" +
        "</div>" +
        (buttons ? '<div class="hist-btns">' + buttons + "</div>" : "") +
      "</div>"
    );
  }).join("");

  els.dHistory.querySelectorAll(".hist-btn").forEach((b) => {
    b.addEventListener("click", () => {
      if (!current) return;
      const id = b.getAttribute("data-id");
      haptic("selection");
      if (b.getAttribute("data-act") === "sum") {
        sendAction("send_history_summary", current.chat_id, id);
        if (!DEMO) toast("Summary sent — it lands in this chat");
      } else {
        sendAction("send_recording", current.chat_id, id);
        if (!DEMO) toast("Recording sent — it lands in this chat");
      }
    });
  });
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

/* Live commands — the /notes_panel card's Start / Stop, on this screen. */

els.dJoin.addEventListener("click", () => {
  if (!current || els.dJoin.disabled) return;
  haptic("impact", "medium");
  sendAction("join_group", current.chat_id, null);
  applyLocal((g) => {
    g.in_call = true;
    g.listener_state = "recording";
    g.call_started_at = Math.floor(Date.now() / 1000);
  });
  if (!DEMO) toast("Start sent — the notetaker is joining the call");
});

els.dStop.addEventListener("click", () => {
  if (!current || els.dStop.disabled) return;
  haptic("impact", "medium");
  sendAction("stop_group", current.chat_id, null);
  applyLocal((g) => {
    g.in_call = false;
    g.listener_state = "idle";
    g.call_started_at = null;
  });
  if (!DEMO) toast("Stop sent — recording is being saved");
});

els.dActivate.addEventListener("click", () => {
  if (!current) return;
  haptic("impact", "medium");
  sendAction("activate_group", current.chat_id, null);
  applyLocal((g) => { g.status = "pairing"; });
  if (!DEMO) toast("Activation sent — the listener is joining the group");
});

els.dIgnore.addEventListener("click", () => {
  if (!current) return;
  haptic("impact", "light");
  sendAction("ignore_activation", current.chat_id, null);
  applyLocal((g) => { g.status = "awaiting_activation"; });
  if (!DEMO) toast("Activation request ignored");
});

els.dSendSummary.addEventListener("click", () => {
  if (!current) return;
  haptic("selection");
  sendAction("send_summary", current.chat_id, null);
  if (!DEMO) toast("Summary sent — it lands in this chat as a receipt");
});

/* ----------------------------------------------------------------- boot */

renderList();
