// ==========================================================================
// Carnet de Verbes — Clean Accordion Notebook Controller (Muse-Inspired)
// ==========================================================================

import { lookupOfflineVerb, extractOfflineVerbsFromText } from "./french-engine.js?v=12";
import {
  testGeminiKey,
  lookupVerbWithAI,
  extractVerbsFromScreenshots,
  extractVerbsFromWordTextWithAI
} from "./ai.js?v=12";
import { generateDocxBlob, extractTextFromDocx } from "./word-io.js?v=12";
import { loadLocalState, saveLocalState, loadSettings, saveSettings, syncWithGitHubGist } from "./sync.js?v=12";
import { createPracticeController } from "./practice.js?v=12";

const TENSES = [
  { key: "present", label: "Présent" },
  { key: "passeCompose", label: "Passé composé" },
  { key: "imparfait", label: "Imparfait" },
  { key: "futur", label: "Futur simple" },
  { key: "conditionnel", label: "Conditionnel" }
];

const PRONOUN_LABELS = ["je", "tu", "il / elle", "nous", "vous", "ils / elles"];

const $ = (id) => document.getElementById(id);

// ---------- State ----------
let { verbs, tombstones } = loadLocalState();
let settings = loadSettings();
let openVerbId = verbs[0]?.infinitive || null;
let activeTenseMap = {};
let activeFilter = "all";
let currentSort = "recent"; // "recent" | "az"
let lastDeletedBackup = null;
let toastTimer = null;
let pendingScreenshots = [];
let syncTimer = null;

// ---------- Helpers ----------
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function speakFrench(text) {
  if (!("speechSynthesis" in window)) {
    showMsg("Audio playback is not supported in this browser.", { isError: true });
    return;
  }
  const cleaned = String(text || "")
    .replace(/\*/g, "")
    .replace(/\(e\)|\(s\)/g, "")
    .replace("il/elle", "il")
    .replace("il / elle", "il")
    .replace("ils/elles", "ils")
    .replace("ils / elles", "ils")
    .trim();
  if (!cleaned) return;

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(cleaned);
  utter.lang = "fr-FR";
  utter.rate = 0.92;
  window.speechSynthesis.speak(utter);
}

function showMsg(text, { isError = false, showUndo = false } = {}) {
  const box = $("status-msg");
  $("status-msg-text").textContent = text;
  box.classList.toggle("err", isError);
  $("status-undo-btn").classList.toggle("hidden", !showUndo);
  box.classList.remove("hidden");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.classList.add("hidden");
  }, showUndo ? 7500 : 4500);
}

function persistAndScheduleSync() {
  saveLocalState(verbs, tombstones);
  if (settings.githubToken) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => runCloudSync({ quiet: true }), 1500);
  }
}

// ---------- Theme & Status ----------
function applyTheme(theme) {
  settings.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", settings.theme);
  $("drawer-theme-label").textContent = settings.theme === "dark" ? "☀️ Switch to Light Theme" : "🌙 Switch to Dark Theme";
  saveSettings(settings);
}

function updateDrawerNotes() {
  const hasAI = Boolean(settings.geminiKey?.trim());
  $("drawer-offline-note").classList.toggle("hidden", hasAI);
  $("drawer-online-note").classList.toggle("hidden", !hasAI);

  $("drawer-gemini-key").value = settings.geminiKey || "";
  $("drawer-github-token").value = settings.githubToken || "";
  $("drawer-sync-status").textContent = settings.lastSyncedAt
    ? `Last synced: ${new Date(settings.lastSyncedAt).toLocaleTimeString()}`
    : "Not synced yet.";
}

// ---------- Drawer Toggle ----------
function openDrawer() {
  updateDrawerNotes();
  $("drawer-backdrop").classList.remove("hidden");
  $("settings-drawer").classList.add("open");
  $("drawer-backdrop").setAttribute("aria-hidden", "false");
  $("settings-drawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  $("drawer-backdrop").classList.add("hidden");
  $("settings-drawer").classList.remove("open");
  $("drawer-backdrop").setAttribute("aria-hidden", "true");
  $("settings-drawer").setAttribute("aria-hidden", "true");
}

// ---------- Practice Controller ----------
const practice = createPracticeController({
  getVerbs: () => verbs,
  speakFrench,
  onSwitchToNotebook: () => showNotebookView()
});

function showPracticeView() {
  closeDrawer();
  $("view-notebook").classList.add("hidden");
  $("view-practice").classList.remove("hidden");
  $("header-back-btn").classList.remove("hidden");
  $("header-title").textContent = "2-Min Practice";
  $("header-subtitle").textContent = "Active recall on your personal saved verbs";
  practice.render();
}

function showNotebookView() {
  $("view-practice").classList.add("hidden");
  $("view-notebook").classList.remove("hidden");
  $("header-back-btn").classList.add("hidden");
  $("header-title").textContent = "French Verb Notebook";
  $("header-subtitle").textContent = "Hear a new verb? Just type it – the rest fills itself in.";
  render();
}

// ---------- Verb CRUD ----------
function upsertVerb(verbObj, { select = true } = {}) {
  const now = Date.now();
  const infKey = verbObj.infinitive.toLowerCase().trim();
  delete tombstones[infKey];

  const existing = verbs.find((v) => v.infinitive.toLowerCase() === infKey);
  if (existing) {
    if (verbObj.duolingoContext) existing.duolingoContext = verbObj.duolingoContext;
    if (verbObj.meaning) existing.meaning = verbObj.meaning;
    if (verbObj.group) existing.group = verbObj.group;
    if (verbObj.auxiliary) existing.auxiliary = verbObj.auxiliary;
    if (verbObj.pastParticiple) existing.pastParticiple = verbObj.pastParticiple;
    if (verbObj.tenses && Object.keys(verbObj.tenses).length) existing.tenses = verbObj.tenses;
    if (verbObj.duolingoTips) existing.duolingoTips = { ...existing.duolingoTips, ...verbObj.duolingoTips };
    if (verbObj.quiz) existing.quiz = verbObj.quiz;
    existing.updatedAt = now;
    if (select) openVerbId = existing.infinitive;
    persistAndScheduleSync();
    render();
    return { alreadyExisted: true, verb: existing };
  }

  const enriched = {
    ...verbObj,
    infinitive: infKey,
    note: verbObj.note || "",
    addedAt: verbObj.addedAt || now,
    updatedAt: now
  };
  verbs.unshift(enriched);
  if (select) openVerbId = enriched.infinitive;
  persistAndScheduleSync();
  render();
  return { alreadyExisted: false, verb: enriched };
}

async function handleAddVerb(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return;

  const submitBtn = $("quick-add-submit-btn");
  const input = $("quick-add-input");
  submitBtn.disabled = true;
  submitBtn.textContent = "Adding...";

  try {
    // 0. Check if this verb or conjugated form is ALREADY in your personal saved notebook!
    // Never waste an API call or wait 10 seconds if you already have it saved.
    const cleanLower = trimmed.toLowerCase().replace(/’/g, "'").trim();
    const existingVerb = verbs.find((v) => {
      if (v.infinitive.toLowerCase() === cleanLower) return true;
      // Also match if user typed a conjugated form that already exists in this saved verb
      return Object.values(v.tenses || {}).some((forms) =>
        (forms || []).some((f) => {
          const c = f.replace(/\*/g, "").replace(/\(e\)|\(s\)/g, "").toLowerCase().trim();
          if (c === cleanLower) return true;
          const withoutSubj = c.replace(/^(il\/elle|ils\/elles|nous|vous|tu|je)\s+/, "").replace(/^j'/, "").trim();
          return withoutSubj === cleanLower;
        })
      );
    });

    if (existingVerb) {
      input.value = "";
      activeFilter = "all";
      openVerbId = existingVerb.infinitive;
      render();
      showMsg(`${existingVerb.infinitive} is already in your notebook — opened here.`);
      return;
    }

    // 1. Instant offline validated check (140 core verbs)
    const offline = lookupOfflineVerb(trimmed);
    if (offline.ok) {
      if (trimmed.split(/\s+/).length >= 3) {
        offline.verb.duolingoContext = {
          fr: trimmed,
          en: offline.verb.duolingoContext?.en || `Spotted phrase (${offline.verb.infinitive}).`
        };
      }
      input.value = "";
      activeFilter = "all";
      const { alreadyExisted, verb } = upsertVerb(offline.verb);
      showMsg(
        alreadyExisted
          ? `${verb.infinitive} is already in your notebook — opened here.`
          : offline.detectedFrom
            ? `${verb.infinitive} added (detected from “${offline.detectedFrom}”) ✓`
            : `${verb.infinitive} added to your notebook ✓`
      );
      return;
    }

    // 2. Query Gemini AI if key is set
    if (settings.geminiKey?.trim()) {
      const aiRes = await lookupVerbWithAI(trimmed, settings.geminiKey.trim());
      if (!aiRes.ok) {
        showMsg(aiRes.reason, { isError: true });
        return;
      }
      input.value = "";
      activeFilter = "all";
      const { alreadyExisted, verb } = upsertVerb(aiRes.verb);
      showMsg(
        alreadyExisted
          ? `${verb.infinitive} is already in your notebook — opened here.`
          : aiRes.detectedFrom
            ? `${verb.infinitive} added via Gemini AI (from “${aiRes.detectedFrom}”) ✓`
            : `${verb.infinitive} added via Gemini AI ✓`
      );
      return;
    }

    // 3. Strictly reject fake words offline
    showMsg(offline.reason, { isError: true });
  } catch (err) {
    showMsg(`AI lookup failed: ${err.message}`, { isError: true });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Add";
  }
}

function deleteVerb(infinitive) {
  const idx = verbs.findIndex((v) => v.infinitive === infinitive);
  if (idx === -1) return;
  const [removed] = verbs.splice(idx, 1);
  lastDeletedBackup = removed;
  tombstones[infinitive.toLowerCase()] = Date.now();

  if (openVerbId === infinitive) {
    openVerbId = verbs[0]?.infinitive || null;
  }
  persistAndScheduleSync();
  render();
  showMsg(`${infinitive} deleted.`, { showUndo: true });
}

function undoDelete() {
  if (!lastDeletedBackup) return;
  const restored = lastDeletedBackup;
  lastDeletedBackup = null;
  delete tombstones[restored.infinitive.toLowerCase()];
  restored.updatedAt = Date.now();
  verbs.unshift(restored);
  openVerbId = restored.infinitive;
  persistAndScheduleSync();
  render();
  showMsg(`${restored.infinitive} restored ✓`);
}

// ---------- Filter & Sort ----------
function getFilteredVerbs() {
  const q = ($("search-input")?.value || "").toLowerCase().trim();

  const filtered = verbs.filter((v) => {
    if (activeFilter === "etre" && v.auxiliary !== "être") return false;
    if (activeFilter === "irregular" && !v.isIrregular) return false;
    if (activeFilter === "reflexive" && !v.isReflexive) return false;

    if (!q) return true;
    if ((v.infinitive || "").toLowerCase().includes(q) || (v.meaning || "").toLowerCase().includes(q) || (v.note || "").toLowerCase().includes(q)) {
      return true;
    }
    return Object.values(v.tenses || {}).some((arr) =>
      (arr || []).some((form) => form.toLowerCase().includes(q))
    );
  });

  return filtered.sort((a, b) => {
    if (currentSort === "az") return a.infinitive.localeCompare(b.infinitive, "fr");
    return (b.addedAt || 0) - (a.addedAt || 0);
  });
}

function formatVerbCell(rawForm) {
  const isHighlight = rawForm.includes("*");
  const clean = esc(rawForm.replace(/\*/g, ""));
  if (clean.startsWith("—")) {
    return `<span style="color: var(--text-muted);">${clean}</span>`;
  }
  // Strip redundant subject pronoun if already present so cell doesn't duplicate
  const formWithoutSubject = clean
    .replace(/^(je|tu|il\/elle|il \/ elle|nous|vous|ils\/elles|ils \/ elles)\s+/, "")
    .replace(/^j'/, "");

  const display = isHighlight ? `<span class="stem-highlight">${formWithoutSubject}</span>` : formWithoutSubject;
  return display;
}

// ---------- Main Render (Accordion Cards) ----------
function render() {
  const list = getFilteredVerbs();
  const container = $("verb-list-container");
  const emptyBox = $("empty-state");

  const totalCount = verbs.length;
  const filteredCount = list.length;
  $("verb-count-label").textContent =
    totalCount === filteredCount
      ? `${totalCount} verb${totalCount === 1 ? "" : "s"} saved`
      : `${filteredCount} of ${totalCount} verbs`;

  emptyBox.classList.toggle("hidden", totalCount > 0);
  container.classList.toggle("hidden", totalCount === 0);

  // Update Sort Switch
  $("sort-az-btn").classList.toggle("active", currentSort === "az");
  $("sort-recent-btn").classList.toggle("active", currentSort === "recent");

  // Update Filter Pills
  document.querySelectorAll(".sub-toolbar .pill-btn[data-filter]").forEach((p) => {
    p.classList.toggle("active", p.dataset.filter === activeFilter);
  });

  if (totalCount === 0) return;

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-card">No matching verbs found for this search or filter.</div>`;
    return;
  }

  container.innerHTML = list
    .map((v) => {
      const isOpen = v.infinitive === openVerbId;
      const currentTense = activeTenseMap[v.infinitive] || "present";
      const forms = v.tenses?.[currentTense] || v.tenses?.present || [];

      // Build 3 row-pairs for the 2-column table:
      // Row 1: je (0) & tu (1)
      // Row 2: il/elle (2) & nous (3)
      // Row 3: vous (4) & ils/elles (5)
      const rowPairs = [
        [0, 1],
        [2, 3],
        [4, 5]
      ]
        .map(([i1, i2]) => {
          const f1 = forms[i1] || "";
          const f2 = forms[i2] || "";
          return `
            <div class="conj-row-pair">
              <div class="conj-cell" data-speak="${esc(f1)}">
                <span class="conj-pronoun">${PRONOUN_LABELS[i1]}</span>
                <span class="conj-verb">${formatVerbCell(f1)}</span>
                <span class="speaker-icon">🔊</span>
              </div>
              <div class="conj-cell" data-speak="${esc(f2)}">
                <span class="conj-pronoun">${PRONOUN_LABELS[i2]}</span>
                <span class="conj-verb">${formatVerbCell(f2)}</span>
                <span class="speaker-icon">🔊</span>
              </div>
            </div>`;
        })
        .join("");

      return `
        <article class="card ${isOpen ? "open" : ""}" data-card-inf="${esc(v.infinitive)}">
          <div class="card-head" data-toggle="${esc(v.infinitive)}">
            <div>
              <div class="card-title-row">
                <h2>${esc(v.infinitive)}</h2>
                <span class="meaning">— ${esc(v.meaning)}</span>
              </div>
              <div class="badges">
                ${v.isIrregular ? `<span class="badge badge-irreg">${esc(v.group)}</span>` : `<span class="badge">${esc(v.group)}</span>`}
                <span class="badge ${v.auxiliary === "être" ? "badge-etre" : ""}">${v.auxiliary === "être" ? "aux. être" : "aux. avoir"}</span>
                ${v.isReflexive ? `<span class="badge badge-emerald">reflexive</span>` : ""}
              </div>
            </div>
            <div class="chev">${isOpen ? "▲" : "▼"}</div>
          </div>

          <div class="card-body">
            <!-- Tense Pill Tabs -->
            <div class="tabs">
              ${TENSES.map((t) => `
                <button
                  type="button"
                  class="${t.key === currentTense ? "on" : ""}"
                  data-tense-for="${esc(v.infinitive)}"
                  data-tense-key="${t.key}"
                >${t.label}</button>
              `).join("")}
            </div>

            <!-- 2-Column Conjugation Table -->
            <div class="conj-table-2col">
              ${rowPairs}
            </div>

            <!-- Example / Duolingo Sentence Box -->
            ${v.duolingoContext?.fr ? `
              <div class="example">
                <div>
                  <div class="fr">« ${esc(v.duolingoContext.fr)} »</div>
                  <div class="en">${esc(v.duolingoContext.en || "")}</div>
                </div>
                <button type="button" class="icon-circle-btn small" data-speak="${esc(v.duolingoContext.fr)}" title="Hear sentence">🔊</button>
              </div>
            ` : ""}

            <!-- What Duolingo Doesn't Explain -->
            <div class="insights-grid">
              <div class="insight-box">
                <div class="insight-title">Auxiliary &amp; Agreement</div>
                <div class="insight-text">${esc(v.duolingoTips?.auxiliaryNote || (v.auxiliary === "être" ? "Uses être in Passé Composé." : "Uses avoir."))}</div>
              </div>
              <div class="insight-box">
                <div class="insight-title">Preposition Pattern</div>
                <div class="insight-text">${esc(v.duolingoTips?.preposition || "Direct object or check context.")}</div>
              </div>
              <div class="insight-box">
                <div class="insight-title">Pronunciation / Silent Endings</div>
                <div class="insight-text">${esc(v.duolingoTips?.homophone || "Singular endings are silent in spoken French.")}</div>
              </div>
              <div class="insight-box">
                <div class="insight-title">Memory Shortcut</div>
                <div class="insight-text">${esc(v.duolingoTips?.extra || "Check stem changes across tenses.")}</div>
              </div>
            </div>

            <!-- My Note -->
            <div class="note">
              <div class="lbl">My Note</div>
              <textarea
                rows="2"
                placeholder="Add a note — a memory trick, where you heard it..."
                data-note-for="${esc(v.infinitive)}"
              >${esc(v.note || "")}</textarea>
            </div>

            <!-- Card Actions -->
            <div class="card-actions-row">
              <button type="button" class="pill-btn" data-speak="${esc(v.infinitive)}">🔊 Pronounce French</button>
              <button type="button" class="danger-btn" data-del="${esc(v.infinitive)}">Delete verb</button>
            </div>
          </div>
        </article>`;
    })
    .join("");

  // Bind accordion toggles
  container.querySelectorAll("[data-toggle]").forEach((head) => {
    head.addEventListener("click", () => {
      const inf = head.dataset.toggle;
      openVerbId = openVerbId === inf ? null : inf;
      render();
    });
  });

  // Bind audio speech
  container.querySelectorAll("[data-speak]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      speakFrench(el.dataset.speak);
    });
  });

  // Bind tense tabs
  container.querySelectorAll("[data-tense-for]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const inf = btn.dataset.tenseFor;
      activeTenseMap[inf] = btn.dataset.tenseKey;
      render();
    });
  });

  // Bind note typing
  container.querySelectorAll("[data-note-for]").forEach((ta) => {
    ta.addEventListener("input", (e) => {
      const inf = ta.dataset.noteFor;
      const target = verbs.find((v) => v.infinitive === inf);
      if (target) {
        target.note = e.target.value;
        target.updatedAt = Date.now();
        persistAndScheduleSync();
      }
    });
  });

  // Bind delete verb
  container.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteVerb(btn.dataset.del);
    });
  });
}

// ---------- Word (.docx) & JSON Export / Import ----------
function handleDownloadDocx() {
  if (!verbs.length) {
    showMsg("Add at least one verb before exporting Word.", { isError: true });
    return;
  }
  const blob = generateDocxBlob(verbs);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Carnet_de_Verbes.docx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  closeDrawer();
  $("quick-export-menu").classList.add("hidden");
  showMsg("Downloaded Carnet_de_Verbes.docx ✓");
}

function handleDownloadJsonBackup() {
  if (!verbs.length) {
    showMsg("Notebook is empty — nothing to backup.", { isError: true });
    return;
  }
  const blob = new Blob([JSON.stringify({ verbs, tombstones }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "carnet-de-verbes-backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  closeDrawer();
  $("quick-export-menu").classList.add("hidden");
  showMsg("Downloaded JSON backup ✓");
}

async function handleImportDocx(file) {
  if (!file) return;
  closeDrawer();
  showMsg(`Reading “${file.name}”...`);
  try {
    const text = await extractTextFromDocx(file);
    const verbMap = new Map();
    const existingSet = new Set(verbs.map((v) => v.infinitive.toLowerCase()));

    // 1. Instant offline dictionary & structured heading scan
    for (const v of extractOfflineVerbsFromText(text)) {
      verbMap.set(v.infinitive.toLowerCase(), v);
    }

    // 2. If Gemini AI key is connected, also extract any additional verbs outside the offline pack
    if (settings.geminiKey?.trim()) {
      const apiKey = settings.geminiKey.trim();
      try {
        const aiInfinitives = await extractVerbsFromWordTextWithAI(text, apiKey);
        const needAiLookup = [];

        for (const rawInf of aiInfinitives) {
          const lowerInf = rawInf.toLowerCase();
          if (verbMap.has(lowerInf) || existingSet.has(lowerInf)) continue;

          const off = lookupOfflineVerb(rawInf);
          if (off.ok && off.verb) {
            verbMap.set(off.verb.infinitive.toLowerCase(), off.verb);
          } else {
            needAiLookup.push(rawInf);
          }
        }

        // Generate full conjugation tables via Gemini AI for any verbs not in the offline pack
        for (let i = 0; i < needAiLookup.length; i++) {
          const targetInf = needAiLookup[i];
          showMsg(`Generating conjugations for “${targetInf}” via Gemini AI (${i + 1}/${needAiLookup.length})...`);
          try {
            const aiRes = await lookupVerbWithAI(targetInf, apiKey);
            if (aiRes.ok && aiRes.verb) {
              verbMap.set(aiRes.verb.infinitive.toLowerCase(), aiRes.verb);
            }
          } catch (_) {
            // Continue importing remaining verbs even if one fails
          }
          // Brief pause when importing many AI verbs so free-tier RPM limits aren't triggered
          if (needAiLookup.length > 4 && i < needAiLookup.length - 1) {
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
      } catch (_) {
        // Fall back to offline-extracted verbs if AI call fails
      }
    }

    const importedVerbs = Array.from(verbMap.values());
    if (!importedVerbs.length) {
      showMsg("Couldn't find French verbs in that .docx file.", { isError: true });
      return;
    }

    let added = 0;
    for (const v of importedVerbs.reverse()) {
      const { alreadyExisted } = upsertVerb(v, { select: true });
      if (!alreadyExisted) added += 1;
    }
    showMsg(
      added > 0
        ? `Imported ${added} new verb${added === 1 ? "" : "s"} (${importedVerbs.length} total in file) from “${file.name}”! 🎉`
        : `All ${importedVerbs.length} verb${importedVerbs.length === 1 ? "" : "s"} in “${file.name}” are already in your notebook ✓`
    );
  } catch (err) {
    showMsg(`Import error: ${err.message}`, { isError: true });
  }
}

async function handleImportJson(file) {
  if (!file) return;
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.verbs;
    if (!Array.isArray(list)) throw new Error("Invalid backup format.");
    let added = 0;
    for (const v of list.reverse()) {
      if (v?.infinitive) {
        const { alreadyExisted } = upsertVerb(v);
        if (!alreadyExisted) added += 1;
      }
    }
    closeDrawer();
    showMsg(`Restored ${added} verb${added === 1 ? "" : "s"} from JSON backup ✓`);
  } catch (err) {
    showMsg(`Backup restore failed: ${err.message}`, { isError: true });
  }
}

// ---------- Cloud Sync ----------
async function runCloudSync({ quiet = false } = {}) {
  if (!settings.githubToken?.trim()) {
    openDrawer();
    $("drawer-github-token").focus();
    return;
  }

  const syncBtn = $("drawer-sync-btn");
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing...";

  try {
    const { gistId, merged } = await syncWithGitHubGist({ verbs, tombstones }, settings);
    verbs = merged.verbs;
    tombstones = merged.tombstones;
    if (!openVerbId && verbs.length) openVerbId = verbs[0].infinitive;

    settings.gistId = gistId;
    settings.lastSyncedAt = Date.now();
    saveSettings(settings);
    saveLocalState(verbs, tombstones);
    render();
    updateDrawerNotes();

    if (!quiet) {
      showMsg(`Synced ${verbs.length} verb${verbs.length === 1 ? "" : "s"} with your private GitHub Gist ✓`);
    }
  } catch (err) {
    if (!quiet) showMsg(`Sync error: ${err.message}`, { isError: true });
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = "Sync";
  }
}

// ---------- Screenshot OCR ----------
function openScreenshotModal() {
  pendingScreenshots = [];
  $("screenshot-thumbs").innerHTML = "";
  $("scan-screenshot-submit-btn").disabled = true;
  $("screenshot-ai-needed-alert").classList.toggle("hidden", Boolean(settings.geminiKey?.trim()));
  $("screenshot-modal").classList.remove("hidden");
}

function closeScreenshotModal() {
  $("screenshot-modal").classList.add("hidden");
}

function stageScreenshotFiles(fileList) {
  const imgs = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) return;
  pendingScreenshots = imgs;

  const strip = $("screenshot-thumbs");
  strip.innerHTML = "";
  imgs.forEach((file) => {
    const img = document.createElement("img");
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    strip.appendChild(img);
  });

  $("scan-screenshot-submit-btn").disabled = false;
}

async function runScreenshotScan() {
  if (!pendingScreenshots.length) return;
  if (!settings.geminiKey?.trim()) {
    closeScreenshotModal();
    openDrawer();
    $("drawer-gemini-key").focus();
    showMsg("Paste your free Google Gemini API key to enable screenshot reading.", { isError: true });
    return;
  }

  const btn = $("scan-screenshot-submit-btn");
  btn.disabled = true;
  btn.textContent = "Scanning with AI...";

  try {
    const entries = await extractVerbsFromScreenshots(pendingScreenshots, settings.geminiKey.trim());
    if (!entries.length) {
      showMsg("No French verbs were spotted in that screenshot.", { isError: true });
      return;
    }

    let addedCount = 0;
    for (const item of entries) {
      if (item?.verb?.infinitive) {
        const { alreadyExisted } = upsertVerb(item.verb, { select: true });
        if (!alreadyExisted) addedCount += 1;
      }
    }
    closeScreenshotModal();
    showMsg(
      addedCount > 0
        ? `Extracted ${addedCount} French verb${addedCount === 1 ? "" : "s"} from your screenshot ✓`
        : `Spotted ${entries[0]?.verb?.infinitive} (already in notebook) ✓`
    );
  } catch (err) {
    showMsg(`Screenshot scan error: ${err.message}`, { isError: true });
  } finally {
    btn.disabled = false;
    btn.textContent = "Extract Verbs with AI";
  }
}

// ---------- Event Listeners Initialization ----------
function init() {
  applyTheme(settings.theme);

  // Top Header
  $("open-drawer-btn").addEventListener("click", openDrawer);
  $("close-drawer-btn").addEventListener("click", closeDrawer);
  $("drawer-backdrop").addEventListener("click", closeDrawer);
  $("header-back-btn").addEventListener("click", showNotebookView);

  // Quick Add Form
  $("quick-add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    handleAddVerb($("quick-add-input").value);
  });
  $("open-screenshot-btn").addEventListener("click", openScreenshotModal);

  // Undo button
  $("status-undo-btn").addEventListener("click", undoDelete);

  // Search & Sort Toolbar
  $("search-input").addEventListener("input", render);
  $("sort-az-btn").addEventListener("click", () => {
    currentSort = "az";
    render();
  });
  $("sort-recent-btn").addEventListener("click", () => {
    currentSort = "recent";
    render();
  });

  // Filter Pills
  document.querySelectorAll(".sub-toolbar .pill-btn[data-filter]").forEach((p) => {
    p.addEventListener("click", () => {
      activeFilter = p.dataset.filter;
      render();
    });
  });

  // Toolbar Export Popup
  $("toolbar-export-btn").addEventListener("click", () => {
    $("quick-export-menu").classList.toggle("hidden");
  });
  $("quick-export-docx-btn").addEventListener("click", handleDownloadDocx);
  $("quick-export-json-btn").addEventListener("click", handleDownloadJsonBackup);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".sub-toolbar")) {
      $("quick-export-menu")?.classList.add("hidden");
    }
  });

  // Empty State Starters & Word Import
  $("empty-starters-btn")?.addEventListener("click", () => {
    for (const starter of ["se lever", "boire", "prendre"]) {
      const res = lookupOfflineVerb(starter);
      if (res.ok) upsertVerb(res.verb);
    }
    showMsg("Loaded 3 starter verbs ✓");
  });
  $("empty-import-word-btn")?.addEventListener("click", () => $("import-docx-file-input").click());

  // Drawer Actions
  $("drawer-practice-btn").addEventListener("click", showPracticeView);
  $("drawer-export-docx-btn").addEventListener("click", handleDownloadDocx);
  $("drawer-import-docx-btn").addEventListener("click", () => $("import-docx-file-input").click());
  $("drawer-export-json-btn").addEventListener("click", handleDownloadJsonBackup);
  $("drawer-import-json-btn").addEventListener("click", () => $("import-json-file-input").click());

  $("drawer-sync-btn").addEventListener("click", () => {
    settings.githubToken = $("drawer-github-token").value.trim();
    saveSettings(settings);
    runCloudSync({ quiet: false });
  });

  $("drawer-test-key-btn").addEventListener("click", async () => {
    const key = $("drawer-gemini-key").value.trim();
    if (!key) {
      settings.geminiKey = "";
      saveSettings(settings);
      updateDrawerNotes();
      showMsg("Gemini API key cleared.");
      return;
    }
    const btn = $("drawer-test-key-btn");
    btn.disabled = true;
    btn.textContent = "...";
    try {
      await testGeminiKey(key);
      settings.geminiKey = key;
      saveSettings(settings);
      updateDrawerNotes();
      showMsg("✓ Gemini API key verified & saved!");
    } catch (err) {
      showMsg(`Key error: ${err.message}`, { isError: true });
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });

  $("drawer-theme-btn").addEventListener("click", () => {
    applyTheme(settings.theme === "dark" ? "light" : "dark");
  });

  // Screenshot Modal
  $("close-screenshot-btn").addEventListener("click", closeScreenshotModal);
  $("screenshot-dropzone").addEventListener("click", () => $("screenshot-file-input").click());
  $("screenshot-dropzone").addEventListener("dragover", (e) => e.preventDefault());
  $("screenshot-dropzone").addEventListener("drop", (e) => {
    e.preventDefault();
    stageScreenshotFiles(e.dataTransfer?.files);
  });
  $("screenshot-file-input").addEventListener("change", (e) => stageScreenshotFiles(e.target.files));
  $("scan-screenshot-submit-btn").addEventListener("click", runScreenshotScan);

  // File Inputs
  $("import-docx-file-input").addEventListener("change", (e) => {
    handleImportDocx(e.target.files?.[0]);
    e.target.value = "";
  });
  $("import-json-file-input").addEventListener("change", (e) => {
    handleImportJson(e.target.files?.[0]);
    e.target.value = "";
  });

  // Keyboard shortcut Esc
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDrawer();
      closeScreenshotModal();
      $("quick-export-menu")?.classList.add("hidden");
    }
  });

  render();
  updateDrawerNotes();
  if (settings.githubToken) runCloudSync({ quiet: true });

  // Register Service Worker for offline PWA functionality & installability
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js?v=12")
        .then((reg) => {
          reg.update().catch(() => {});
          // Listen for updates and automatically refresh if new version found
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                console.log("New version of Carnet de Verbes installed.");
              }
            });
          });
        })
        .catch((err) => console.warn("ServiceWorker registration failed:", err));
    });
  }
}

init();
