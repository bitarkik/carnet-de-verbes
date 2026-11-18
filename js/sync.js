import { validateState } from "./validation.js?v=27";
// ==========================================================================
// Local Auto-Save + 2-Way GitHub Gist Cloud Sync (Phone <-> Laptop)
// ==========================================================================

const STATE_KEY = "carnet_de_verbes_state_v1";
const SETTINGS_KEY = "carnet_de_verbes_settings_v1";
const GIST_FILENAME = "carnet-de-verbes-sync.json";

export function loadLocalState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return { verbs: [], tombstones: {} };
    const parsed = JSON.parse(raw);
    const state = validateState(parsed);
    try { validateState(parsed, { legacy: false }); }
    catch {
      // Preserve the exact original bytes once, before the app can save a compatible state.
      try {
        const key = "carnet_de_verbes_before_compatibility";
        if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
      } catch { /* Full storage must not prevent reading the existing notebook. */ }
    }
    return state;
  } catch (error) {
    throw new Error(`Stored notebook could not be read. Export your browser data before resetting it. ${error.message}`);
  }
}

export function saveLocalState(verbs, tombstones = {}) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ verbs, tombstones, savedAt: Date.now() }));
  } catch (err) {
    throw new Error("Notebook could not be saved on this device. Download a JSON backup now.");
  }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    const session = JSON.parse(sessionStorage.getItem(SETTINGS_KEY) || "{}");
    const parsed = { ...stored, ...session };
    return {
      rememberCredentials: parsed.rememberCredentials ?? Boolean(stored.geminiKey || stored.githubToken),
      geminiKey: parsed.geminiKey || "",
      githubToken: parsed.githubToken || "",
      gistId: parsed.gistId || "",
      theme: parsed.theme || "light",
      lastSyncedAt: parsed.lastSyncedAt || null
    };
  } catch {
    return { rememberCredentials: false, geminiKey: "", githubToken: "", gistId: "", theme: "light", lastSyncedAt: null };
  }
}

export function saveSettings(settings) {
  try {
    const persisted = { ...settings };
    if (!settings.rememberCredentials) {
      delete persisted.geminiKey;
      delete persisted.githubToken;
      sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } else sessionStorage.removeItem(SETTINGS_KEY);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
  } catch (err) {
    throw new Error("Settings could not be saved. Check browser storage permissions.");
  }
}

// Merge local and remote verb collections cleanly using updatedAt + deletion tombstones
export function mergeNotebookStates(local, remote) {
  local = validateState(local);
  remote = validateState(remote);
  const mergedTombstones = { ...(remote.tombstones || {}), ...(local.tombstones || {}) };
  for (const [inf, ts] of Object.entries(remote.tombstones || {})) {
    if (!mergedTombstones[inf] || ts > mergedTombstones[inf]) mergedTombstones[inf] = ts;
  }

  const byInf = new Map();
  for (const v of [...(remote.verbs || []), ...(local.verbs || [])]) {
    if (!v || !v.infinitive) continue;
    const key = v.infinitive.toLowerCase();
    const deletedAt = mergedTombstones[key] || 0;
    const vTime = v.updatedAt || v.addedAt || 1;
    if (deletedAt && deletedAt >= vTime) continue; // Verb was deleted more recently than added

    const prev = byInf.get(key);
    if (!prev || vTime >= (prev.updatedAt || prev.addedAt || 0)) {
      byInf.set(key, v);
    }
  }

  const mergedVerbs = Array.from(byInf.values()).sort(
    (a, b) => (b.addedAt || 0) - (a.addedAt || 0)
  );
  return { verbs: mergedVerbs, tombstones: mergedTombstones };
}

async function ghFetch(path, token, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    signal: AbortSignal.timeout(30000),
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || `GitHub HTTP ${res.status}`);
  }
  return res.json();
}

// Automatically discover existing private sync Gist if gistId is blank (paginates up to 500 gists)
async function findExistingSyncGist(token) {
  for (let page = 1; page <= 5; page++) {
    const gists = await ghFetch(`/gists?per_page=100&page=${page}`, token);
    if (!Array.isArray(gists) || !gists.length) break;
    for (const g of gists) {
      if (!g.public && g.files && g.files[GIST_FILENAME]) {
        return g.id;
      }
    }
    if (gists.length < 100) break;
  }
  return null;
}

async function readGistFile(file) {
  if (!file) throw new Error("Remote notebook file is missing. Nothing was overwritten.");
  if (!file.truncated && typeof file.content === "string") return file.content;
  let url;
  try { url = new URL(file.raw_url); } catch { throw new Error("Remote notebook download URL is missing. Nothing was overwritten."); }
  if (url.protocol !== "https:" || url.hostname !== "gist.githubusercontent.com" || url.username || url.password)
    throw new Error("Unexpected notebook download host. Nothing was overwritten.");
  // Secret Gist raw URLs are readable without sending the user's API token.
  const response = await fetch(url.href, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Full notebook download failed (${response.status}). Nothing was overwritten.`);
  const content = await response.text();
  if (content.length > 20 * 1024 * 1024) throw new Error("Remote notebook exceeds the 20 MB safety limit. Nothing was overwritten.");
  return content;
}

export async function syncWithGitHubGist(localState, settings) {
  localState = validateState(localState);
  const token = (settings.githubToken || "").trim();
  if (!token) throw new Error("Missing GitHub Gist token.");

  let gistId = (settings.gistId || "").trim();
  if (!gistId) {
    gistId = await findExistingSyncGist(token);
  }

  // Create new private Gist if none exists yet
  if (!gistId) {
    const created = await ghFetch("/gists", token, {
      method: "POST",
      body: JSON.stringify({
        description: "Carnet de Verbes — Personal French Verb Sync",
        public: false,
        files: {
          [GIST_FILENAME]: {
            content: JSON.stringify(localState, null, 2)
          }
        }
      })
    });
    return {
      gistId: created.id,
      merged: localState
    };
  }

  // Pull existing Gist, merge 2-way, and push merged state back
  const gist = await ghFetch(`/gists/${gistId}`, token);
  const fileObj = gist.files?.[GIST_FILENAME];
  if (gist.public) throw new Error("Sync requires a secret Gist. Nothing was overwritten.");
  const remoteContent = await readGistFile(fileObj);
  let remoteState;
  try { remoteState = validateState(JSON.parse(remoteContent)); }
  catch (error) { throw new Error(`Remote notebook is invalid. Nothing was overwritten. ${error.message}`); }

  const merged = mergeNotebookStates(localState, remoteState);
  const files = { [GIST_FILENAME]: { content: JSON.stringify(merged, null, 2) } };
  try { validateState(JSON.parse(remoteContent), { legacy: false }); }
  catch {
    const backupName = "carnet-de-verbes-before-compatibility.json";
    if (!gist.files[backupName]) files[backupName] = { content: remoteContent };
  }

  // Detect intervening remote edits; GitHub Gists do not provide an atomic merge API.
  const latest = await ghFetch(`/gists/${gistId}`, token);
  if (latest.public || await readGistFile(latest.files?.[GIST_FILENAME]) !== remoteContent) {
    throw new Error("Notebook changed on another device. Retry sync to merge the latest changes.");
  }
  await ghFetch(`/gists/${gistId}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      files
    })
  });

  return { gistId, merged };
}
