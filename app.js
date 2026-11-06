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
 *   set_ui_lang                         -> value: "fr" | "en", chat_id: null
 *                                          (PERSONAL: the opener's stored
 *                                          language preference — the panel
 *                                          header's FR|EN switch; not tied
 *                                          to any group)
 *
 * Language: the whole panel chrome renders in ONE language — the
 * opener's. The bot stamps it into the snapshot as `ui_lang` (their
 * stored per-user preference); group data inside the snapshot (titles,
 * summaries, each group's own bot `lang`) is data, never translated.
 * Every UI string lives in the UI_STRINGS table below, keyed alike in
 * both languages; static labels in index.html carry data-i18n keys
 * into the same table. The header FR|EN switch flips the render
 * locally at once and persists the choice bot-side via set_ui_lang.
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
  uiLangFr: $("ui-lang-fr"),
  uiLangEn: $("ui-lang-en"),
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

/* --------------------------------------------------- UI string table */

/* Every user-facing string of the panel, in both languages, with
 * IDENTICAL key sets (the test suite parses this literal and enforces
 * parity). Written as strict JSON on purpose: no trailing commas, no
 * comments inside. Values may carry {placeholders} (see fmt()) and,
 * for the empty_body key only, a little <strong> markup. */
const UI_STRINGS = {
  "en": {
    "doc_title": "BleepxNotes — Group Control",
    "brand_subtitle": "Group control centre",
    "demo_data": "Demo data",
    "registered_groups": "Registered groups",
    "empty_title": "Nothing loaded here.",
    "empty_body": "This panel only fills when the bot launches it with your data: in your chat with <strong>@bleepxnotes_bot</strong>, send <strong>/notes_groups</strong> and tap <strong>Open the panel</strong>. Opened from the bot's profile or a menu button it stays empty — and it only ever works for the bot owner's account.",
    "card_status": "Status",
    "row_notetaker": "Notetaker",
    "row_listener": "Listener",
    "row_first_call": "First-call capture",
    "row_chat_id": "Chat ID",
    "row_note": "Note",
    "card_commands": "Commands",
    "cmd_start": "Start notetaker",
    "cmd_stop": "Stop",
    "cmd_activate": "Activate BleepxNotes",
    "cmd_approve": "Approve activation",
    "cmd_ignore": "Ignore activation request",
    "card_recording": "Recording",
    "rec_autojoin": "Auto-join calls",
    "rec_autojoin_sub": "Listener joins voice chats automatically",
    "rec_summaries": "Summaries",
    "rec_summaries_sub": "Post a summary after each call",
    "card_language": "Language",
    "card_latest_summary": "Latest summary",
    "row_date": "Date",
    "summary_trunc": "Long summary — the panel shows the first part of it. The full text is one tap away:",
    "send_summary_btn": "Send the summary to my DM",
    "summary_none": "No summary yet for this group — the first summarized call will appear here, readable on this screen.",
    "card_history": "Meeting history",
    "history_none": "No earlier meetings recorded for this group yet.",
    "history_more": "Showing the most recent meetings — older ones are not listed here.",
    "pause_group": "Pause group",
    "resume_group": "Resume group",
    "unregister_group": "Unregister group",
    "unregister_hint": "Unregistering stops all capture in this group. The bot stays a member; activation can be run again later.",
    "unregister_confirm": "Unregister “{title}”? BleepxNotes will stop capturing calls in this group.",
    "status_active": "Active",
    "status_degraded": "Degraded",
    "status_paused": "Paused",
    "status_pending_approval": "Pending approval",
    "status_needs_action": "Needs action",
    "status_bot_absent": "Bot absent",
    "status_unregistered": "Unregistered",
    "status_awaiting_activation": "Awaiting activation",
    "status_pairing": "Activating…",
    "status_pairing_failed": "Activation failed",
    "health_in_group": "Listener in group",
    "health_not_in_group": "Listener not in group",
    "chip_autojoin_on": "Auto-join on",
    "chip_autojoin_off": "Auto-join off",
    "chip_summaries_on": "Summaries on",
    "chip_summaries_off": "Summaries off",
    "val_in_group": "In group",
    "val_not_in_group": "Not in group",
    "capture_verified": "Verified — real audio captured",
    "capture_pending": "Pending — checked on the first call",
    "live_recording": "Recording",
    "live_since": " — since ",
    "live_elsewhere": "In a call in another group",
    "live_error": "Error — the bot reports it in its chat",
    "live_unknown": "Unknown",
    "live_idle": "Idle",
    "hint_recording": "Recording now — Stop ends the call and keeps the recording.",
    "hint_busy": "The notetaker is in a call in another group — it runs one call at a time.",
    "hint_paused": "This group is paused. Resume it below to run commands here.",
    "hint_degraded": "The listener is not in this group — commands return when it rejoins.",
    "hint_pairing": "Activation in progress — the listener is joining this group.",
    "hint_pending": "A group admin asked to activate BleepxNotes here. Approve it from this screen, or ignore the request.",
    "hist_summary_kept": "Summary kept",
    "hist_no_summary": "No summary",
    "hist_recording_kept": "Recording kept",
    "hist_btn_summary": "Summary",
    "hist_btn_recording": "Recording",
    "toast_demo_action": "Demo: {action} (not sent)",
    "toast_summary_sent": "Summary sent — it lands in this chat",
    "toast_recording_sent": "Recording sent — it lands in this chat",
    "toast_autojoin_on": "Auto-join on — sent to the bot",
    "toast_autojoin_off": "Auto-join off — sent to the bot",
    "toast_summaries_on": "Summaries on — sent to the bot",
    "toast_summaries_off": "Summaries off — sent to the bot",
    "toast_lang_set": "Language set — sent to the bot",
    "toast_resume_sent": "Resume sent to the bot",
    "toast_pause_sent": "Pause sent to the bot",
    "toast_unregistered": "Group unregistered",
    "toast_demo_suffix": " (demo)",
    "toast_join_sent": "Start sent — the notetaker is joining the call",
    "toast_stop_sent": "Stop sent — recording is being saved",
    "toast_activation_sent": "Activation sent — the listener is joining the group",
    "toast_ignored": "Activation request ignored",
    "toast_summary_receipt": "Summary sent — it lands in this chat as a receipt"
  },
  "fr": {
    "doc_title": "BleepxNotes — Contrôle des groupes",
    "brand_subtitle": "Centre de contrôle des groupes",
    "demo_data": "Données de démo",
    "registered_groups": "Groupes enregistrés",
    "empty_title": "Rien n'est chargé ici.",
    "empty_body": "Ce panneau ne se remplit que lorsque le bot le lance avec vos données : dans votre conversation avec <strong>@bleepxnotes_bot</strong>, envoyez <strong>/notes_groups</strong> et touchez <strong>Ouvrir le panneau</strong>. Ouvert depuis le profil du bot ou un bouton de menu, il reste vide — et il ne fonctionne que pour le compte du propriétaire du bot.",
    "card_status": "État",
    "row_notetaker": "Prise de notes",
    "row_listener": "Agent d'écoute",
    "row_first_call": "Capture du premier appel",
    "row_chat_id": "ID du chat",
    "row_note": "Note",
    "card_commands": "Commandes",
    "cmd_start": "Démarrer",
    "cmd_stop": "Arrêter",
    "cmd_activate": "Activer BleepxNotes",
    "cmd_approve": "Approuver l'activation",
    "cmd_ignore": "Ignorer la demande d'activation",
    "card_recording": "Enregistrement",
    "rec_autojoin": "Jonction automatique",
    "rec_autojoin_sub": "L'agent rejoint les appels vocaux automatiquement",
    "rec_summaries": "Résumés",
    "rec_summaries_sub": "Publier un résumé après chaque appel",
    "card_language": "Langue",
    "card_latest_summary": "Dernier résumé",
    "row_date": "Date",
    "summary_trunc": "Résumé long — le panneau n'en montre que le début. Le texte complet est à un toucher :",
    "send_summary_btn": "Envoyer le résumé en message privé",
    "summary_none": "Aucun résumé pour ce groupe — le premier appel résumé apparaîtra ici, lisible sur cet écran.",
    "card_history": "Historique des réunions",
    "history_none": "Aucune réunion précédente enregistrée pour ce groupe.",
    "history_more": "Réunions les plus récentes affichées — les plus anciennes ne sont pas listées ici.",
    "pause_group": "Mettre le groupe en pause",
    "resume_group": "Reprendre le groupe",
    "unregister_group": "Retirer le groupe",
    "unregister_hint": "Retirer le groupe arrête toute capture dans ce groupe. Le bot reste membre ; l'activation pourra être relancée plus tard.",
    "unregister_confirm": "Retirer « {title} » ? BleepxNotes cessera de capturer les appels de ce groupe.",
    "status_active": "Actif",
    "status_degraded": "Dégradé",
    "status_paused": "En pause",
    "status_pending_approval": "Approbation en attente",
    "status_needs_action": "Action requise",
    "status_bot_absent": "Bot absent",
    "status_unregistered": "Retiré",
    "status_awaiting_activation": "En attente d'activation",
    "status_pairing": "Activation…",
    "status_pairing_failed": "Échec d'activation",
    "health_in_group": "Agent d'écoute dans le groupe",
    "health_not_in_group": "Agent d'écoute absent du groupe",
    "chip_autojoin_on": "Jonction auto activée",
    "chip_autojoin_off": "Jonction auto désactivée",
    "chip_summaries_on": "Résumés activés",
    "chip_summaries_off": "Résumés désactivés",
    "val_in_group": "Dans le groupe",
    "val_not_in_group": "Absent du groupe",
    "capture_verified": "Vérifié — le son réel est capturé",
    "capture_pending": "En attente — vérifié lors du premier appel",
    "live_recording": "Enregistrement",
    "live_since": " — depuis ",
    "live_elsewhere": "En appel dans un autre groupe",
    "live_error": "Erreur — le bot la signale dans son chat",
    "live_unknown": "Inconnu",
    "live_idle": "Inactif",
    "hint_recording": "Enregistrement en cours — Arrêter termine l'appel et conserve l'enregistrement.",
    "hint_busy": "L'agent d'écoute est en appel dans un autre groupe — un seul appel à la fois.",
    "hint_paused": "Ce groupe est en pause. Reprenez-le ci-dessous pour y exécuter des commandes.",
    "hint_degraded": "L'agent d'écoute n'est pas dans ce groupe — les commandes reviendront quand il le rejoindra.",
    "hint_pairing": "Activation en cours — l'agent rejoint ce groupe.",
    "hint_pending": "Un administrateur du groupe a demandé l'activation de BleepxNotes ici. Approuvez-la depuis cet écran, ou ignorez la demande.",
    "hist_summary_kept": "Résumé conservé",
    "hist_no_summary": "Aucun résumé",
    "hist_recording_kept": "Enregistrement conservé",
    "hist_btn_summary": "Résumé",
    "hist_btn_recording": "Enregistrement",
    "toast_demo_action": "Démo : {action} (non envoyé)",
    "toast_summary_sent": "Résumé envoyé — il arrive dans ce chat",
    "toast_recording_sent": "Enregistrement envoyé — il arrive dans ce chat",
    "toast_autojoin_on": "Jonction auto activée — envoyé au bot",
    "toast_autojoin_off": "Jonction auto désactivée — envoyé au bot",
    "toast_summaries_on": "Résumés activés — envoyé au bot",
    "toast_summaries_off": "Résumés désactivés — envoyé au bot",
    "toast_lang_set": "Langue définie — envoyé au bot",
    "toast_resume_sent": "Reprise envoyée au bot",
    "toast_pause_sent": "Pause envoyée au bot",
    "toast_unregistered": "Groupe retiré",
    "toast_demo_suffix": " (démo)",
    "toast_join_sent": "Démarrage envoyé — l'agent rejoint l'appel",
    "toast_stop_sent": "Arrêt envoyé — l'enregistrement est en cours de sauvegarde",
    "toast_activation_sent": "Activation envoyée — l'agent rejoint le groupe",
    "toast_ignored": "Demande d'activation ignorée",
    "toast_summary_receipt": "Résumé envoyé — il arrive dans ce chat comme reçu"
  }
};

/* The panel's language: the opener's, stamped into the snapshot as
 * ui_lang by the bot (their stored preference). Fallback chain when
 * no snapshot carries one (menu-button launch, older bot): the
 * Telegram client's own language_code, then English. */
let uiLang = "en";

function S(key) {
  const table = UI_STRINGS[uiLang] || UI_STRINGS.en;
  return table[key] || UI_STRINGS.en[key] || key;
}

function fmt(key, vars) {
  let out = S(key);
  Object.keys(vars || {}).forEach((k) => {
    out = out.split("{" + k + "}").join(String(vars[k]));
  });
  return out;
}

function statusLabel(status) {
  return S("status_" + status);
}

/* Push the table into the static shell: every [data-i18n] element's
 * text, every [data-i18n-html] element's markup, the switch states,
 * the toggle aria-labels and the document title. Dynamic regions
 * (list, detail) re-render separately through S() at build time. */
function applyStaticStrings() {
  document.title = S("doc_title");
  document.documentElement.lang = uiLang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = S(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = S(el.getAttribute("data-i18n-html"));
  });
  els.dAutojoin.setAttribute("aria-label", S("rec_autojoin"));
  els.dSummaries.setAttribute("aria-label", S("rec_summaries"));
  els.uiLangFr.classList.toggle("active", uiLang === "fr");
  els.uiLangEn.classList.toggle("active", uiLang === "en");
}

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
    if (parsed && Array.isArray(parsed.groups)) return parsed;
  } catch (e) {
    console.warn("Could not parse #state snapshot:", e);
  }
  return null;
}

const snapshot = DEMO ? null : loadStateFromUrl();

let groups;
if (DEMO) {
  groups = MOCK_GROUPS.slice();
  els.demoBadge.hidden = false;
} else {
  groups = (snapshot && snapshot.groups) || [];
}

/* Language resolution: the snapshot's ui_lang (the opener's stored
 * preference, stamped by the bot) wins; without one, the Telegram
 * client's language_code; English last. */
if (snapshot && (snapshot.ui_lang === "fr" || snapshot.ui_lang === "en")) {
  uiLang = snapshot.ui_lang;
} else if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user
    && /^fr/i.test(tg.initDataUnsafe.user.language_code || "")) {
  uiLang = "fr";
}

let current = null; // group object shown in the detail view

/* --------------------------------------------------------------- helpers */

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
    toast(fmt("toast_demo_action", { action: action.replace(/_/g, " ") }));
    return;
  }
  /* NOTE: per Telegram's contract, sendData delivers a web_app_data service
   * message to the bot; the bot applies the change and confirms in chat. */
  tg.sendData(JSON.stringify(payload));
}

/* ------------------------------------------------------------ list view */

function healthHtml(g) {
  if (g.listener_present) {
    return '<span class="dot ok"></span> ' + esc(S("health_in_group"));
  }
  if (g.status === "paused") {
    return '<span class="dot off"></span> ' + esc(statusLabel("paused"));
  }
  return '<span class="dot bad"></span> ' + esc(S("health_not_in_group"));
}

function renderList() {
  els.groupCount.textContent = groups.length ? String(groups.length) : "";
  els.listEmpty.hidden = groups.length > 0;
  els.groupList.innerHTML = groups.map((g) => {
    const langLabel = g.lang === "fr" ? "Français" : "English";
    return (
      '<article class="group-card" data-chat-id="' + g.chat_id + '" role="button" tabindex="0">' +
        '<div class="gc-top">' +
          '<span class="gc-name">' + esc(g.title) + "</span>" +
          '<span class="pill st-' + esc(g.status) + '">' + esc(statusLabel(g.status)) + "</span>" +
        "</div>" +
        '<div class="gc-health">' + healthHtml(g) + "</div>" +
        '<div class="gc-chips">' +
          '<span class="chip">' + icon("globe") + langLabel + "</span>" +
          '<span class="chip' + (g.autojoin ? "" : " off") + '">' + icon("mic") +
            esc(S(g.autojoin ? "chip_autojoin_on" : "chip_autojoin_off")) + "</span>" +
          '<span class="chip' + (g.summaries ? "" : " off") + '">' + icon("bell") +
            esc(S(g.summaries ? "chip_summaries_on" : "chip_summaries_off")) + "</span>" +
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
  els.dTitle.textContent = g.title;
  els.dStatus.className = "pill st-" + g.status;
  els.dStatus.textContent = statusLabel(g.status);

  els.dListener.innerHTML = g.listener_present
    ? icon("check") + '<span class="row-value good">' + esc(S("val_in_group")) + "</span>"
    : icon("warn") + '<span class="row-value bad">' + esc(S("val_not_in_group")) + "</span>";
  els.dListener.className = "row-value";

  if (g.first_call === "verified") {
    els.dCapture.innerHTML = icon("check") + " " + esc(S("capture_verified"));
    els.dCapture.className = "row-value good";
  } else {
    els.dCapture.innerHTML = icon("clock") + " " + esc(S("capture_pending"));
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
    els.dLive.innerHTML = '<span class="rec-dot"></span> ' + esc(S("live_recording")) +
      (g.call_started_at ? esc(S("live_since")) + esc(fmtTime(g.call_started_at)) : "");
    els.dLive.className = "row-value rec";
  } else if (g.listener_state === "recording") {
    els.dLive.textContent = S("live_elsewhere");
    els.dLive.className = "row-value";
  } else if (g.listener_state === "error") {
    els.dLive.innerHTML = icon("warn") + " " + esc(S("live_error"));
    els.dLive.className = "row-value bad";
  } else if (g.listener_state === "unknown") {
    els.dLive.textContent = S("live_unknown");
    els.dLive.className = "row-value";
  } else {
    els.dLive.textContent = S("live_idle");
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
    ? S("cmd_approve") : S("cmd_activate");
  els.dIgnore.hidden = st !== "pending_approval";
  let hint = null;
  if (st === "active" && g.in_call) {
    hint = S("hint_recording");
  } else if (st === "active" && busyElsewhere) {
    hint = S("hint_busy");
  } else if (st === "paused") {
    hint = S("hint_paused");
  } else if (st === "degraded") {
    hint = S("hint_degraded");
  } else if (st === "pairing") {
    hint = S("hint_pairing");
  } else if (st === "pending_approval") {
    hint = S("hint_pending");
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
    ? icon("play") + " " + esc(S("resume_group"))
    : icon("pause") + " " + esc(S("pause_group"));
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
    bits.push(e.sum > 0 ? S("hist_summary_kept") : S("hist_no_summary"));
    if (e.rec) bits.push(S("hist_recording_kept"));
    let buttons = "";
    if (e.sum > 0) {
      buttons += '<button class="btn btn-ghost hist-btn" data-act="sum" data-id="' +
        esc(e.id) + '">' + icon("file") + " " + esc(S("hist_btn_summary")) + "</button>";
    }
    if (e.rec) {
      buttons += '<button class="btn btn-ghost hist-btn" data-act="rec" data-id="' +
        esc(e.id) + '">' + icon("mic") + " " + esc(S("hist_btn_recording")) + "</button>";
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
        if (!DEMO) toast(S("toast_summary_sent"));
      } else {
        sendAction("send_recording", current.chat_id, id);
        if (!DEMO) toast(S("toast_recording_sent"));
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
  if (!DEMO) toast(S(next ? "toast_autojoin_on" : "toast_autojoin_off"));
});

els.dSummaries.addEventListener("click", () => {
  if (!current) return;
  const next = !current.summaries;
  haptic("impact", "light");
  sendAction("toggle_summaries", current.chat_id, next);
  applyLocal((g) => { g.summaries = next; });
  if (!DEMO) toast(S(next ? "toast_summaries_on" : "toast_summaries_off"));
});

function setLang(lang) {
  if (!current || current.lang === lang) return;
  haptic("selection");
  sendAction("set_lang", current.chat_id, lang);
  applyLocal((g) => { g.lang = lang; });
  if (!DEMO) toast(S("toast_lang_set"));
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
    if (!DEMO) toast(S("toast_resume_sent"));
  } else {
    sendAction("pause_group", current.chat_id, null);
    applyLocal((g) => { g.status = "paused"; });
    if (!DEMO) toast(S("toast_pause_sent"));
  }
});

els.dUnregister.addEventListener("click", () => {
  if (!current) return;
  const g = current;
  const msg = fmt("unregister_confirm", { title: g.title });
  const doIt = () => {
    haptic("notify", "warning");
    sendAction("unregister_group", g.chat_id, null);
    groups = groups.filter((x) => x.chat_id !== g.chat_id);
    closeDetail();
    toast(S("toast_unregistered") + (DEMO ? S("toast_demo_suffix") : ""));
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
  if (!DEMO) toast(S("toast_join_sent"));
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
  if (!DEMO) toast(S("toast_stop_sent"));
});

els.dActivate.addEventListener("click", () => {
  if (!current) return;
  haptic("impact", "medium");
  sendAction("activate_group", current.chat_id, null);
  applyLocal((g) => { g.status = "pairing"; });
  if (!DEMO) toast(S("toast_activation_sent"));
});

els.dIgnore.addEventListener("click", () => {
  if (!current) return;
  haptic("impact", "light");
  sendAction("ignore_activation", current.chat_id, null);
  applyLocal((g) => { g.status = "awaiting_activation"; });
  if (!DEMO) toast(S("toast_ignored"));
});

els.dSendSummary.addEventListener("click", () => {
  if (!current) return;
  haptic("selection");
  sendAction("send_summary", current.chat_id, null);
  if (!DEMO) toast(S("toast_summary_receipt"));
});

/* ------------------------------------------- personal panel language */

/* The header FR|EN switch: flips THIS person's panel language at
 * once (local re-render of every string) and persists the choice
 * bot-side as their stored per-user preference (set_ui_lang), so the
 * next panel — and their DM surfaces — open in the same language.
 * Group data and each group's own bot language are untouched. */
function setUiLang(lang) {
  if (lang === uiLang) return;
  uiLang = lang;
  haptic("selection");
  sendAction("set_ui_lang", null, lang);
  applyStaticStrings();
  if (current) {
    renderDetail();
  } else {
    renderList();
  }
}
els.uiLangFr.addEventListener("click", () => setUiLang("fr"));
els.uiLangEn.addEventListener("click", () => setUiLang("en"));

/* ----------------------------------------------------------------- boot */

applyStaticStrings();
renderList();
