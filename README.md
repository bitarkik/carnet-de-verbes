# Carnet de Verbes

A personal, AI-powered French verb notebook built for Duolingo learners—designed to work seamlessly on both your **phone** and **laptop**, while still exporting cleanly to **Microsoft Word (`.docx`)** anytime.

## Features

- **Type Any Form (Infinitive or Conjugated):** Enter `prendre`, `"avons pris"`, `"il faudrait"`, or `"dormons"`—automatically detects the infinitive, checks for duplicates, and rejects non-French words.
- **Duolingo Screenshot Scanner:** Upload one or multiple phone screenshots from Duolingo lessons; Google Gemini Vision extracts the French verb(s) along with the exact sentence you saw.
- **"What Duolingo Doesn't Explain" Cards:** Highlights `être` vs. `avoir` in *Passé Composé*, required prepositions (`à` vs. `de`), silent-ending pronunciation tips, and underlined irregular stems across 5 core tenses.
- **French Audio (`fr-FR`):** Tap any verb, example sentence, or conjugation row to hear native browser pronunciation.
- **Practice Mode:** Active-recall fill-in-the-blank drills (with a French accent bar) and flip flashcards generated exclusively from *your* saved verbs.
- **Microsoft Word (`.docx`) Import & Export:** Import verbs from an existing `.docx` Word document, and download a formatted OpenXML `.docx` file with native Word tables anytime.
- **Phone ↔ Laptop Sync:** Instant `localStorage` auto-save plus optional 2-way secret **GitHub Gist** cloud sync.

## Deploying Free on GitHub Pages (with Optional Custom Domain)

Because this project uses clean, zero-build Vanilla HTML, CSS, and ES Modules, deploying takes under a minute:

1. Push this repository to GitHub.
2. Open **Settings → Pages** in your GitHub repository.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch** → select `main` and `/ (root)` → click **Save**.
4. Your app will be live at `https://<your-username>.github.io/<repo-name>/`!
   - **On your phone:** Open that URL in Safari (iOS) or Chrome (Android) and tap **Add to Home Screen** to install it like a native app right next to Duolingo.
   - **Optional Custom Subdomain (e.g. `verbs.yourdomain.com`):** Add a `CNAME` record in your domain's DNS pointing `verbs` → `<your-username>.github.io`, then enter `verbs.yourdomain.com` under **Custom domain** in **Settings → Pages** (and enable *Enforce HTTPS*).

## Local Development

Serve the folder with any static HTTP server:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Reliability, privacy, and recovery

- Notebook data stays in this browser unless you use AI or Gist sync. AI requests send your submitted text or screenshots to Google. Generated French can be wrong; review it before studying. Supported models are listed in [Google’s model documentation](https://ai.google.dev/gemini-api/docs/models). Quotas and billing depend on your account.
- Credentials are kept in tab session storage by default. “Remember credentials” persists them in local storage on this device. Existing saved credentials retain their previous behavior until you uncheck that option. Both storage types are readable by scripts on this origin. Use a trusted device and a GitHub token scoped only to Gists.
- Secret Gists are unlisted, not access-controlled private vaults: anyone with the URL can read them. Sync refuses public, missing or malformed notebook files before writing. It serializes operations in this tab, preserves edits made while a request is running, and checks for intervening remote changes. Gists have no atomic merge API: avoid simultaneous edits on multiple devices and keep JSON backups.
- JSON restore merges the backup into the notebook, replacing matching entries (including notes and cached counterparts) and honoring deletion history. It validates the complete file first and saves a pre-restore recovery copy in this browser, available from Settings. It does not delete unrelated current entries. Word import extracts verbs, not a complete notebook backup; use JSON to preserve all fields.
- Unrecognized Word headings are skipped offline rather than assigned guessed conjugations. AI extraction accepts up to 15,000 characters and reports partial failures. Word/JSON uploads are limited to 10 MB; screenshot selection accepts 10 images, 5 MB each, 20 MB total. Word import supports modern browsers with `DecompressionStream("deflate-raw")`.
- If browser storage is full, download a JSON backup immediately. Clearing site data removes the notebook, local recovery copy, credentials, and offline cache.

## Development checks

The app remains a zero-build static site. Node dependencies are only for development tests:

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

Tests use synthetic notebooks and mocked GitHub/Gemini calls; they do not access real user data. Browser checks cover desktop/mobile viewport flows, keyboard focus, automated accessibility rules, and offline reload. Real-device Safari, live provider quotas, and Microsoft Word page layout still require manual verification.

Changes are developed on a separate branch and reviewed through a pull request. Revert a merged change with `git revert <commit>`; code rollback does not undo remote data writes. To recover Gist data, consult its revision history and your JSON backups before syncing again.

### Existing notebook compatibility

Saved and synced notebooks may contain variable-length conjugation arrays produced before strict AI validation was introduced. Loading, restoring, and merging preserve those arrays and all entries; newly generated AI entries still require six forms per tense. The first compatible load of an older-format notebook keeps the exact original JSON under `carnet_de_verbes_before_compatibility`, downloadable through Settings → Download original recovery copy. Before syncing an older-format remote notebook, its original JSON is also retained once in `carnet-de-verbes-before-compatibility.json` in the same Gist. A load failure offers an original-data download and does not initialize or sync an empty notebook. Do not clear site storage to resolve a compatibility error.

Large Gists: when GitHub returns a truncated preview, sync downloads the complete `raw_url` file from `gist.githubusercontent.com` without forwarding credentials, validates it, and compares the complete content again before writing. A failed download never triggers a write. If an installed app is stuck on older cached code, open `recover.html` in the same browser, download the original notebook if desired, then select Update and open notebook. Recovery updates only the service worker; it does not clear local storage. Update registration runs independently of notebook loading, and navigations check the network with an offline fallback.
