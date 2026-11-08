# Carnet de Verbes

A personal, AI-powered French verb notebook built for Duolingo learners—designed to work seamlessly on both your **phone** and **laptop**, while still exporting cleanly to **Microsoft Word (`.docx`)** anytime.

## Features

- **Type Any Form (Infinitive or Conjugated):** Enter `prendre`, `"avons pris"`, `"il faudrait"`, or `"dormons"`—automatically detects the infinitive, checks for duplicates, and rejects non-French words.
- **Duolingo Screenshot Scanner:** Upload one or multiple phone screenshots from Duolingo lessons; Google Gemini Vision extracts the French verb(s) along with the exact sentence you saw.
- **"What Duolingo Doesn't Explain" Cards:** Highlights `être` vs. `avoir` in *Passé Composé*, required prepositions (`à` vs. `de`), silent-ending pronunciation tips, and underlined irregular stems across 5 core tenses.
- **French Audio (`fr-FR`):** Tap any verb, example sentence, or conjugation row to hear native browser pronunciation.
- **2-Min Practice Mode:** Active-recall fill-in-the-blank drills (with a French accent bar) and flip flashcards generated exclusively from *your* saved verbs.
- **Microsoft Word (`.docx`) Import & Export:** Import verbs from an existing `.docx` Word document, and download a formatted OpenXML `.docx` file with native Word tables anytime.
- **Phone ↔ Laptop Sync:** Instant `localStorage` auto-save plus optional 2-way private **GitHub Gist** cloud sync.

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
