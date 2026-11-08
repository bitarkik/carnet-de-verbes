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
    return {
      verbs: Array.isArray(parsed.verbs) ? parsed.verbs : [],
      tombstones: parsed.tombstones && typeof parsed.tombstones === "object" ? parsed.tombstones : {}
    };
  } catch {
    return { verbs: [], tombstones: {} };
  }
}

export function saveLocalState(verbs, tombstones = {}) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ verbs, tombstones, savedAt: Date.now() }));
  } catch (err) {
    console.warn("Could not save to localStorage (private browsing mode or quota exceeded):", err);
  }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      geminiKey: parsed.geminiKey || "",
      githubToken: parsed.githubToken || "",
      gistId: parsed.gistId || "",
      theme: parsed.theme || "light",
      lastSyncedAt: parsed.lastSyncedAt || null
    };
  } catch {
    return { geminiKey: "", githubToken: "", gistId: "", theme: "light", lastSyncedAt: null };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("Could not save settings to localStorage:", err);
  }
}

// Merge local and remote verb collections cleanly using updatedAt + deletion tombstones
function mergeNotebookStates(local, remote) {
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
    if (deletedAt > vTime) continue; // Verb was deleted more recently than added

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
      if (g.files && g.files[GIST_FILENAME]) {
        return g.id;
      }
    }
    if (gists.length < 100) break;
  }
  return null;
}

export async function syncWithGitHubGist(localState, settings) {
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
  let remoteState = { verbs: [], tombstones: {} };
  if (fileObj?.content) {
    try {
      remoteState = JSON.parse(fileObj.content);
    } catch {
      remoteState = { verbs: [], tombstones: {} };
    }
  }

  const merged = mergeNotebookStates(localState, remoteState);

  await ghFetch(`/gists/${gistId}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(merged, null, 2)
        }
      }
    })
  });

  return { gistId, merged };
}
