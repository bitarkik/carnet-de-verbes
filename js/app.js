// ==========================================================================
// Carnet de Verbes — Main Application Controller
// ==========================================================================

import { lookupOfflineVerb, extractOfflineVerbsFromText } from "./french-engine.js";
import {
  testGeminiKey,
  lookupVerbWithAI,
  extractVerbsFromScreenshots,
  extractVerbsFromWordTextWithAI
} from "./ai.js";
import { generateDocxBlob, extractTextFromDocx } from "./word-io.js";
import { loadLocalState, saveLocalState, loadSettings, saveSettings, syncWithGitHubGist } from "./sync.js";
import { createPracticeController } from "./practice.js";

const TENSE_LABELS = {
  present: "Présent",
  passeCompose: "Passé Composé",
  imparfait: "Imparfait",
  futur: "Futur Simple",
  conditionnel: "Conditionnel"
};

const $ = (id) => document.getElementById(id);

// ---------- State ----------
let { verbs, tombstones } = loadLocalState();
let settings = loadSettings();
let selectedInfinitive = verbs[0]?.infinitive || null;
let activeTense = "present";
let activeFilter = "all";
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
    showToast("French audio playback isn't supported in this browser.", { isError: true });
    return;
  }
  const cleaned = String(text || "")
    .replace(/\*/g, "")
    .replace(/\(e\)|\(s\)/g, "")
    .replace("il/elle", "il")
    .replace("ils/elles", "ils")
    .trim();
  if (!cleaned) return;

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(cleaned);
  utter.lang = "fr-FR";
  utter.rate = 0.92;
  window.speechSynthesis.speak(utter);
}

function showToast(message, { isError = false, showUndo = false } = {}) {
  const banner = $("toast-banner");
  $("toast-text").textContent = message;
  banner.classList.toggle("is-error", isError);
  $("toast-undo-btn").classList.toggle("hidden", !showUndo);
  banner.classList.remove("hidden");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    banner.classList.add("hidden");
  }, showUndo ? 7500 : 4800);
}

function persistAndScheduleSync() {
  saveLocalState(verbs, tombstones);
  if (settings.githubToken) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => runCloudSync({ quiet: true }), 1400);
  }
}

// ---------- Theme & Status Indicators ----------
function applyTheme(theme) {
  settings.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", settings.theme);
  $("theme-icon-sun").classList.toggle("hidden", settings.theme !== "dark");
  $("theme-icon-moon").classList.toggle("hidden", settings.theme === "dark");
  saveSettings(settings);
}

function updateStatusIndicators() {
  const hasAI = Boolean(settings.geminiKey?.trim());
  const hasSync = Boolean(settings.githubToken?.trim());

  $("ai-status-dot").classList.toggle("online", hasAI);
  $("sync-status-dot").classList.toggle("online", hasSync);
  $("sync-btn-label").textContent = hasSync ? "Sync" : "Cloud Sync";

  $("ai-mode-indicator").innerHTML = hasAI
    ? `<span style="color: var(--accent); font-weight: 600;">● Gemini AI Connected</span> · All 12,000+ French verbs & live Duolingo screenshot scanning active`
    : `<span>75-Verb Offline Starter Ready</span> · <button type="button" id="inline-connect-ai-link" style="color: var(--accent); font-weight: 600; text-decoration: underline;">Connect free Gemini key</button> for all 12,000+ verbs & real screenshots`;

  $("inline-connect-ai-link")?.addEventListener("click", openSettingsModal);
}

// ---------- Practice Controller ----------
const practice = createPracticeController({
  getVerbs: () => verbs,
  speakFrench,
  onSwitchToNotebook: () => switchMainTab("notebook")
});

function switchMainTab(tab) {
  const isNotebook = tab === "notebook";
  $("view-notebook").classList.toggle("hidden", !isNotebook);
  $("view-practice").classList.toggle("hidden", isNotebook);
  $("nav-notebook-btn").classList.toggle("active", isNotebook);
  $("nav-practice-btn").classList.toggle("active", !isNotebook);

  if (!isNotebook) {
    practice.render();
  }
}

// ---------- Add / Upsert / Delete Verbs ----------
function upsertVerb(verbObj, { select = true } = {}) {
  const now = Date.now();
  const infKey = verbObj.infinitive.toLowerCase().trim();
  delete tombstones[infKey];

  const existing = verbs.find((v) => v.infinitive.toLowerCase() === infKey);
  if (existing) {
    if (verbObj.duolingoContext) existing.duolingoContext = verbObj.duolingoContext;
    existing.updatedAt = now;
    if (select) selectedInfinitive = existing.infinitive;
    persistAndScheduleSync();
    renderAll();
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
  if (select) selectedInfinitive = enriched.infinitive;
  persistAndScheduleSync();
  renderAll();
  return { alreadyExisted: false, verb: enriched };
}

async function handleAddInput(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return;

  const submitBtn = $("quick-add-submit-btn");
  const input = $("quick-add-input");
  const origLabel = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="spinner"></span> Adding...`;

  try {
    // 1. Check instant offline validated lexicon first (instant 0ms response for top 75 verbs!)
    const offline = lookupOfflineVerb(trimmed);
    if (offline.ok) {
      // If user typed a full custom phrase, preserve it as context!
      if (trimmed.split(/\s+/).length >= 3) {
        offline.verb.duolingoContext = {
          fr: trimmed,
          en: offline.verb.duolingoContext?.en || `Spotted phrase (${offline.verb.infinitive}).`
        };
      }
      input.value = "";
      activeFilter = "all";
      const { alreadyExisted, verb } = upsertVerb(offline.verb);
      showToast(
        alreadyExisted
          ? `“${verb.infinitive}” is already in your notebook — jumped straight to it!`
          : offline.detectedFrom
            ? `Detected “${verb.infinitive}” (${verb.meaning}) from “${offline.detectedFrom}” and saved!`
            : `Saved “${verb.infinitive}” (${verb.meaning}) to your notebook!`
      );
      return;
    }

    // 2. If Gemini API key is configured, query live Gemini AI for any of 12,000+ French verbs!
    if (settings.geminiKey?.trim()) {
      const aiRes = await lookupVerbWithAI(trimmed, settings.geminiKey.trim());
      if (!aiRes.ok) {
        showToast(aiRes.reason, { isError: true });
        return;
      }
      input.value = "";
      activeFilter = "all";
      const { alreadyExisted, verb } = upsertVerb(aiRes.verb);
      showToast(
        alreadyExisted
          ? `“${verb.infinitive}” is already in your notebook — jumped straight to it!`
          : aiRes.detectedFrom
            ? `AI detected “${verb.infinitive}” (${verb.meaning}) from “${aiRes.detectedFrom}” and saved!`
            : `Saved “${verb.infinitive}” (${verb.meaning}) via Gemini AI!`
      );
      return;
    }

    // 3. Strictly reject fake/unknown words when offline
    showToast(offline.reason, { isError: true });
  } catch (err) {
    showToast(`AI lookup failed: ${err.message}`, { isError: true });
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = origLabel;
  }
}

function deleteVerb(infinitive) {
  const idx = verbs.findIndex((v) => v.infinitive === infinitive);
  if (idx === -1) return;
  const [removed] = verbs.splice(idx, 1);
  lastDeletedBackup = removed;
  tombstones[infinitive.toLowerCase()] = Date.now();

  if (selectedInfinitive === infinitive) {
    selectedInfinitive = verbs[0]?.infinitive || null;
  }
  persistAndScheduleSync();
  renderAll();
  showToast(`Removed “${infinitive}” from your notebook.`, { showUndo: true });
}

function undoLastDelete() {
  if (!lastDeletedBackup) return;
  const restored = lastDeletedBackup;
  lastDeletedBackup = null;
  delete tombstones[restored.infinitive.toLowerCase()];
  restored.updatedAt = Date.now();
  verbs.unshift(restored);
  selectedInfinitive = restored.infinitive;
  persistAndScheduleSync();
  renderAll();
  showToast(`Restored “${restored.infinitive}”!`);
}

// ---------- Rendering Notebook ----------
function getFilteredAndSortedVerbs() {
  const q = ($("search-verbs-input")?.value || "").toLowerCase().trim();
  const sortBy = $("sort-verbs-select")?.value || "recent";

  const filtered = verbs.filter((v) => {
    if (activeFilter === "etre" && v.auxiliary !== "être") return false;
    if (activeFilter === "irregular" && !v.isIrregular) return false;
    if (activeFilter === "reflexive" && !v.isReflexive) return false;

    if (!q) return true;
    if (
      v.infinitive.toLowerCase().includes(q) ||
      v.meaning.toLowerCase().includes(q) ||
      (v.note || "").toLowerCase().includes(q)
    ) {
      return true;
    }
    return Object.values(v.tenses || {}).some((arr) =>
      (arr || []).some((form) => form.toLowerCase().includes(q))
    );
  });

  return filtered.sort((a, b) => {
    if (sortBy === "az") return a.infinitive.localeCompare(b.infinitive, "fr");
    return (b.addedAt || 0) - (a.addedAt || 0);
  });
}

function formatConjForm(raw) {
  const highlighted = raw.includes("*");
  const clean = esc(raw.replace(/\*/g, ""));
  if (clean.startsWith("—")) {
    return `<span style="color: var(--text-muted);">${clean}</span>`;
  }
  return highlighted ? `<span class="stem-highlight">${clean}</span>` : `<span>${clean}</span>`;
}

function renderVerbList() {
  $("verb-count-badge").textContent = `${verbs.length} verb${verbs.length === 1 ? "" : "s"}`;

  const isEmpty = verbs.length === 0;
  $("empty-notebook-state").classList.toggle("hidden", !isEmpty);
  $("workspace-grid").classList.toggle("hidden", isEmpty);
  if (isEmpty) return;

  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.filter === activeFilter);
  });

  const list = getFilteredAndSortedVerbs();
  const container = $("verb-list-container");

  if (!list.length) {
    container.innerHTML = `
      <div style="padding: 22px 12px; text-align: center; font-size: 0.8rem; color: var(--text-muted);">
        No matching verbs for this search or filter.
      </div>`;
    return;
  }

  if (!list.some((v) => v.infinitive === selectedInfinitive)) {
    selectedInfinitive = list[0].infinitive;
  }

  container.innerHTML = list
    .map((v) => {
      const isSelected = v.infinitive === selectedInfinitive;
      return `
        <button
          type="button"
          class="verb-list-item ${isSelected ? "selected" : ""}"
          data-select-verb="${esc(v.infinitive)}"
        >
          <div class="verb-item-main">
            <div class="verb-item-title">
              <span>${esc(v.infinitive)}</span>
              ${v.isIrregular ? `<span class="mini-tag">irreg</span>` : ""}
            </div>
            <div class="verb-item-meaning">${esc(v.meaning)}</div>
          </div>
          <span class="aux-tag ${v.auxiliary === "être" ? "is-etre" : ""}">${esc(v.auxiliary)}</span>
        </button>`;
    })
    .join("");

  container.querySelectorAll("[data-select-verb]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedInfinitive = btn.dataset.selectVerb;
      renderVerbList();
      renderVerbDetail();
      if (window.innerWidth < 940) {
        $("verb-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  });
}

function renderVerbDetail() {
  if (!verbs.length) return;
  const v = verbs.find((item) => item.infinitive === selectedInfinitive) || verbs[0];
  if (!v) return;

  const panel = $("verb-detail-panel");
  const forms = v.tenses?.[activeTense] || v.tenses?.present || [];
  const addedDate = v.addedAt ? new Date(v.addedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Saved";

  panel.innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-verb-row">
          <h2 class="detail-verb-title">${esc(v.infinitive)}</h2>
          <button type="button" class="btn btn-subtle" data-speak="${esc(v.infinitive)}" title="Hear French pronunciation">
            🔊 Pronounce
          </button>
        </div>
        <p class="detail-meaning">${esc(v.meaning)}</p>
      </div>

      <div class="detail-badges">
        <span class="meta-pill">${esc(v.group)}</span>
        <span class="meta-pill ${v.auxiliary === "être" ? "is-etre" : ""}">
          Passé: ${esc(v.auxiliary)} + ${esc(v.pastParticiple)}
        </span>
      </div>
    </div>

    ${v.duolingoContext?.fr ? `
      <div class="context-strip">
        <div>
          <div class="context-label">Spotted in Context</div>
          <div class="context-fr">« ${esc(v.duolingoContext.fr)} »</div>
          ${v.duolingoContext.en ? `<div class="context-en">${esc(v.duolingoContext.en)}</div>` : ""}
        </div>
        <button type="button" class="btn btn-subtle" data-speak="${esc(v.duolingoContext.fr)}" title="Listen to sentence">🔊</button>
      </div>
    ` : ""}

    <div class="insights-section">
      <h3 class="section-heading">What Duolingo Doesn't Explain</h3>
      <div class="insights-grid">
        <div class="insight-item">
          <div class="insight-title">Auxiliary & Agreement</div>
          <div class="insight-body">${esc(v.duolingoTips?.auxiliaryNote || "")}</div>
        </div>
        <div class="insight-item">
          <div class="insight-title">Preposition Pattern</div>
          <div class="insight-body">${esc(v.duolingoTips?.preposition || "")}</div>
        </div>
        <div class="insight-item">
          <div class="insight-title">Pronunciation / Silent Endings</div>
          <div class="insight-body">${esc(v.duolingoTips?.homophone || "")}</div>
        </div>
        <div class="insight-item">
          <div class="insight-title">Memory Shortcut</div>
          <div class="insight-body">${esc(v.duolingoTips?.extra || "")}</div>
        </div>
      </div>
    </div>

    <div class="insights-section">
      <div class="tense-bar">
        <div class="tense-tabs">
          ${Object.entries(TENSE_LABELS)
            .map(
              ([key, label]) => `
            <button
              type="button"
              class="tense-tab ${activeTense === key ? "active" : ""}"
              data-tense="${key}"
            >${label}</button>`
            )
            .join("")}
        </div>
        <span class="tense-hint">Tap any form for audio · Underlined = key stem</span>
      </div>

      <div class="conj-grid">
        ${forms
          .map((f) => {
            const clickable = !f.startsWith("—");
            return `
              <button
                type="button"
                class="conj-row-btn"
                ${clickable ? `data-speak="${esc(f)}"` : "disabled"}
              >
                ${formatConjForm(f)}
                ${clickable ? `<span class="speak-affordance">🔊</span>` : ""}
              </button>`;
          })
          .join("")}
      </div>
    </div>

    <div class="bottom-split">
      <div>
        <h3 class="section-heading">Everyday Examples</h3>
        ${(v.examples || [])
          .map(
            (ex) => `
          <div class="example-box">
            <div class="example-top">
              <span>${esc(ex.fr)}</span>
              <button type="button" data-speak="${esc(ex.fr)}" class="speak-affordance" title="Pronounce">🔊</button>
            </div>
            <div class="example-en">${esc(ex.en)}</div>
          </div>`
          )
          .join("")}
      </div>

      <div>
        <h3 class="section-heading">My Personal Note</h3>
        <textarea
          id="detail-note-input"
          class="note-textarea"
          placeholder="Jot down where you heard this verb, a Duolingo tip, or a memory hook..."
        >${esc(v.note || "")}</textarea>
      </div>
    </div>

    <div class="detail-footer">
      <span>Added ${esc(addedDate)} · Auto-saved locally</span>
      <button type="button" id="delete-current-verb-btn" class="btn btn-danger-ghost">
        Delete verb
      </button>
    </div>
  `;

  panel.querySelectorAll("[data-speak]").forEach((el) => {
    el.addEventListener("click", () => speakFrench(el.dataset.speak));
  });

  panel.querySelectorAll("[data-tense]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTense = btn.dataset.tense;
      renderVerbDetail();
    });
  });

  $("detail-note-input")?.addEventListener("input", (e) => {
    v.note = e.target.value;
    v.updatedAt = Date.now();
    persistAndScheduleSync();
  });

  $("delete-current-verb-btn")?.addEventListener("click", () => deleteVerb(v.infinitive));
}

function renderAll() {
  updateStatusIndicators();
  renderVerbList();
  renderVerbDetail();
}

// ---------- Screenshot Scanner Modal ----------
function openScreenshotModal() {
  pendingScreenshots = [];
  $("screenshot-thumbs").innerHTML = "";
  $("scan-screenshots-btn").disabled = true;
  $("screenshot-ai-warning").classList.toggle("hidden", Boolean(settings.geminiKey?.trim()));
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
    img.className = "thumb-img";
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    strip.appendChild(img);
  });

  $("scan-screenshots-btn").disabled = false;
}

async function runScreenshotExtraction() {
  if (!pendingScreenshots.length) return;
  if (!settings.geminiKey?.trim()) {
    closeScreenshotModal();
    openSettingsModal();
    showToast("Paste your free Google Gemini API key first so AI Vision can read your screenshots!", { isError: true });
    return;
  }

  const btn = $("scan-screenshots-btn");
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Reading Screenshot...`;

  try {
    const entries = await extractVerbsFromScreenshots(pendingScreenshots, settings.geminiKey.trim());
    if (!entries.length) {
      showToast("No French verbs were spotted in that screenshot.", { isError: true });
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
    showToast(
      addedCount > 0
        ? `Extracted and added ${addedCount} new French verb${addedCount === 1 ? "" : "s"} from your screenshot!`
        : `Spotted “${entries[0]?.verb?.infinitive}” — already in your notebook (updated context)!`
    );
  } catch (err) {
    showToast(`Screenshot scan failed: ${err.message}`, { isError: true });
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

// ---------- Word (.docx) & JSON Import / Export Modal ----------
function openWordModal() {
  const preview = $("word-preview-box");
  if (!verbs.length) {
    preview.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">Your notebook is currently empty. You can import an existing <strong>.docx</strong> Word file or <strong>.json</strong> backup below!</p>`;
  } else {
    preview.innerHTML = verbs
      .map(
        (v, i) => `
        <div style="padding: 12px 0; ${i < verbs.length - 1 ? "border-bottom: 1px solid var(--border);" : ""}">
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
            <strong style="font-size: 0.92rem;">${i + 1}. ${esc(v.infinitive)} — ${esc(v.meaning)}</strong>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${esc(v.group)} · Aux: ${esc(v.auxiliary)} (${esc(v.pastParticiple)})</span>
          </div>
          <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 4px;">
            <strong>Présent:</strong> ${(v.tenses?.present || []).map((f) => esc(f.replace(/\*/g, ""))).join(", ")}
          </div>
        </div>`
      )
      .join("");
  }
  $("word-modal").classList.remove("hidden");
}

function closeWordModal() {
  $("word-modal").classList.add("hidden");
}

async function handleImportDocx(file) {
  if (!file) return;
  showToast(`Reading “${file.name}”...`);
  try {
    const text = await extractTextFromDocx(file);
    let importedVerbs = extractOfflineVerbsFromText(text);

    // If Gemini AI is active, also extract any rarer verbs in the Word document!
    if (settings.geminiKey?.trim()) {
      const aiVerbs = await extractVerbsFromWordTextWithAI(text, settings.geminiKey.trim());
      if (aiVerbs.length > importedVerbs.length) {
        importedVerbs = aiVerbs;
      }
    }

    if (!importedVerbs.length) {
      showToast("Couldn't detect French verbs automatically in that .docx (connect Gemini AI in Settings for messy layouts).", { isError: true });
      return;
    }

    let added = 0;
    for (const v of importedVerbs.reverse()) {
      const { alreadyExisted } = upsertVerb(v, { select: true });
      if (!alreadyExisted) added += 1;
    }
    closeWordModal();
    showToast(`Imported ${added} new French verb${added === 1 ? "" : "s"} from “${file.name}”! 🎉`);
  } catch (err) {
    showToast(`Import error: ${err.message}`, { isError: true });
  }
}

function handleDownloadDocx() {
  if (!verbs.length) {
    showToast("Add at least one verb before exporting a Word file.", { isError: true });
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
  showToast("Downloaded Carnet_de_Verbes.docx!");
}

function handleDownloadJsonBackup() {
  const blob = new Blob([JSON.stringify({ verbs, tombstones }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "carnet-de-verbes-backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast("Downloaded JSON backup!");
}

async function handleImportJsonBackup(file) {
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
    closeWordModal();
    showToast(`Restored ${added} verb${added === 1 ? "" : "s"} from JSON backup!`);
  } catch (err) {
    showToast(`Backup restore failed: ${err.message}`, { isError: true });
  }
}

// ---------- Settings & GitHub Cloud Sync Modal ----------
function openSettingsModal() {
  $("settings-gemini-key").value = settings.geminiKey || "";
  $("settings-github-token").value = settings.githubToken || "";
  $("settings-gist-id").value = settings.gistId || "";
  $("settings-sync-meta").textContent = settings.lastSyncedAt
    ? `Last synced: ${new Date(settings.lastSyncedAt).toLocaleString()}`
    : "Not synced yet.";
  $("settings-modal").classList.remove("hidden");
}

function closeSettingsModal() {
  $("settings-modal").classList.add("hidden");
}

async function runCloudSync({ quiet = false } = {}) {
  if (!settings.githubToken?.trim()) {
    openSettingsModal();
    return;
  }
  const syncBtn = $("sync-now-btn");
  syncBtn.disabled = true;
  $("sync-btn-label").textContent = "Syncing...";

  try {
    const { gistId, merged } = await syncWithGitHubGist({ verbs, tombstones }, settings);
    verbs = merged.verbs;
    tombstones = merged.tombstones;
    if (!selectedInfinitive && verbs.length) selectedInfinitive = verbs[0].infinitive;

    settings.gistId = gistId;
    settings.lastSyncedAt = Date.now();
    saveSettings(settings);
    saveLocalState(verbs, tombstones);
    renderAll();

    if (!quiet) {
      showToast(`Synced ${verbs.length} verb${verbs.length === 1 ? "" : "s"} with your private GitHub Gist!`);
    }
  } catch (err) {
    if (!quiet) showToast(`Cloud sync error: ${err.message}`, { isError: true });
  } finally {
    syncBtn.disabled = false;
    updateStatusIndicators();
  }
}

// ---------- Wire All DOM Events ----------
function init() {
  applyTheme(settings.theme);

  // Navigation & Topbar
  $("nav-notebook-btn").addEventListener("click", () => switchMainTab("notebook"));
  $("nav-practice-btn").addEventListener("click", () => switchMainTab("practice"));
  $("theme-toggle-btn").addEventListener("click", () => {
    applyTheme(settings.theme === "dark" ? "light" : "dark");
  });
  $("open-word-modal-btn").addEventListener("click", openWordModal);
  $("open-settings-btn").addEventListener("click", openSettingsModal);
  $("sync-now-btn").addEventListener("click", () => runCloudSync({ quiet: false }));

  // Toast
  $("toast-undo-btn").addEventListener("click", undoLastDelete);
  $("toast-close-btn").addEventListener("click", () => $("toast-banner").classList.add("hidden"));

  // Quick Add
  $("quick-add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    handleAddInput($("quick-add-input").value);
  });

  document.querySelectorAll("[data-try]").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("quick-add-input").value = chip.dataset.try;
      handleAddInput(chip.dataset.try);
    });
  });

  // Empty State Starters & Word Import
  $("empty-starter-btn").addEventListener("click", () => {
    for (const starter of ["se lever", "boire", "prendre"]) {
      const res = lookupOfflineVerb(starter);
      if (res.ok) upsertVerb(res.verb);
    }
    showToast("Added 3 starter verbs — try clicking forms for audio or switching to 2-Min Practice!");
  });
  $("empty-import-docx-btn").addEventListener("click", () => $("import-docx-input").click());
  $("empty-setup-ai-btn").addEventListener("click", openSettingsModal);

  // Search, Sort, Filters
  $("search-verbs-input").addEventListener("input", renderVerbList);
  $("sort-verbs-select").addEventListener("change", renderVerbList);
  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      activeFilter = chip.dataset.filter;
      renderVerbList();
    });
  });

  // Screenshot Modal
  $("open-screenshot-btn").addEventListener("click", openScreenshotModal);
  $("close-screenshot-btn").addEventListener("click", closeScreenshotModal);
  $("screenshot-dropzone").addEventListener("click", () => $("screenshot-file-input").click());
  $("screenshot-dropzone").addEventListener("dragover", (e) => e.preventDefault());
  $("screenshot-dropzone").addEventListener("drop", (e) => {
    e.preventDefault();
    stageScreenshotFiles(e.dataTransfer?.files);
  });
  $("screenshot-file-input").addEventListener("change", (e) => stageScreenshotFiles(e.target.files));
  $("scan-screenshots-btn").addEventListener("click", runScreenshotExtraction);
  $("screenshot-open-settings-btn").addEventListener("click", () => {
    closeScreenshotModal();
    openSettingsModal();
  });

  document.querySelectorAll("[data-demo-shot]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inf = btn.dataset.demoShot;
      const fr = btn.dataset.fr;
      const en = btn.dataset.en;
      const res = lookupOfflineVerb(inf);
      if (res.ok) {
        res.verb.duolingoContext = { fr, en };
        upsertVerb(res.verb);
        closeScreenshotModal();
        showToast(`Added “${res.verb.infinitive}” with your Duolingo context sentence!`);
      }
    });
  });

  // Word & Backup Modal
  $("close-word-modal-btn").addEventListener("click", closeWordModal);
  $("download-docx-btn").addEventListener("click", handleDownloadDocx);
  $("download-json-btn").addEventListener("click", handleDownloadJsonBackup);
  $("trigger-docx-import-btn").addEventListener("click", () => $("import-docx-input").click());
  $("trigger-json-import-btn").addEventListener("click", () => $("import-json-input").click());

  $("import-docx-input").addEventListener("change", (e) => {
    handleImportDocx(e.target.files?.[0]);
    e.target.value = "";
  });
  $("import-json-input").addEventListener("change", (e) => {
    handleImportJsonBackup(e.target.files?.[0]);
    e.target.value = "";
  });

  // Settings Modal
  $("close-settings-btn").addEventListener("click", closeSettingsModal);
  $("test-gemini-btn").addEventListener("click", async () => {
    const key = $("settings-gemini-key").value.trim();
    if (!key) {
      showToast("Paste your Gemini API key first.", { isError: true });
      return;
    }
    const btn = $("test-gemini-btn");
    btn.disabled = true;
    btn.textContent = "Testing...";
    try {
      await testGeminiKey(key);
      settings.geminiKey = key;
      saveSettings(settings);
      updateStatusIndicators();
      showToast("✓ Gemini API key verified and saved!");
    } catch (err) {
      showToast(`Key check failed: ${err.message}`, { isError: true });
    } finally {
      btn.disabled = false;
      btn.textContent = "Test Key";
    }
  });

  $("save-settings-btn").addEventListener("click", async () => {
    settings.geminiKey = $("settings-gemini-key").value.trim();
    settings.githubToken = $("settings-github-token").value.trim();
    settings.gistId = $("settings-gist-id").value.trim();
    saveSettings(settings);
    closeSettingsModal();
    renderAll();

    if (settings.githubToken) {
      await runCloudSync({ quiet: false });
    } else {
      showToast("Settings saved locally!");
    }
  });

  // Close modals on Escape or backdrop click
  ["screenshot-modal", "word-modal", "settings-modal"].forEach((id) => {
    $(id).addEventListener("click", (e) => {
      if (e.target.id === id) $(id).classList.add("hidden");
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeScreenshotModal();
      closeWordModal();
      closeSettingsModal();
    }
  });

  // Register Service Worker for PWA phone installation
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  renderAll();
  if (settings.githubToken) {
    runCloudSync({ quiet: true });
  }
}

init();
