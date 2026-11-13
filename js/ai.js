// ==========================================================================
// Live Google Gemini AI Integration (Verb Lookup, Screenshot Vision, Word Import)
// ==========================================================================

import { normalizeVerbEntry } from "./french-engine.js?v=19";

// Modern Gemini 3.x Flash series models ordered by free-tier quota (500 RPD vs 20 RPD)
const MODELS = [
  "gemini-3.5-flash-lite", // Primary: 500 requests/day & 15 requests/min (high quota, ultra-fast ~1s)
  "gemini-3.8-flash",      // Fallback 1: High quality reasoning (20 requests/day free tier)
  "gemini-3.6-flash"       // Fallback 2: (20 requests/day free tier)
];

const VERB_ENTRY_SCHEMA_PROMPT = `
Return ONLY valid JSON matching this exact structure:
{
  "isValidFrenchVerb": true,
  "detectedFrom": "conjugated word/phrase if input was not already the bare infinitive, else null",
  "reasonIfInvalid": "friendly short explanation if input has NO real French verb (e.g. 'banana is an English noun, not a French verb')",
  "verb": {
    "infinitive": "lowercase French infinitive (include 'se ' or 's\\'' if input was reflexive)",
    "meaning": "concise English meaning(s)",
    "group": "e.g. '1st group · Regular -er' or '3rd group · Irregular -ir' or '1st group · Reflexive -er'",
    "isIrregular": true,
    "isReflexive": false,
    "isImpersonal": false,
    "auxiliary": "avoir or être",
    "pastParticiple": "past participle",
    "duolingoContext": {
      "fr": "natural French sentence (use the user's input sentence if they gave one!)",
      "en": "English translation"
    },
    "duolingoTips": {
      "auxiliaryNote": "concise note on Passé Composé auxiliary & agreement",
      "preposition": "required preposition pattern (à, de, direct object, etc.) with short example",
      "homophone": "spoken pronunciation / silent-ending / homophone tip",
      "extra": "helpful pattern shortcut, stem change, or false-friend alert"
    },
    "tenses": {
      "present": ["je ...", "tu ...", "il/elle ...", "nous ...", "vous ...", "ils/elles ..."],
      "passeCompose": ["6 forms with je/j', tu, il/elle, nous, vous, ils/elles"],
      "imparfait": ["6 forms"],
      "futur": ["6 forms in Futur Simple"],
      "conditionnel": ["6 forms in Conditionnel Présent"]
    },
    "examples": [
      { "fr": "Natural everyday French sentence 1", "en": "English translation 1" },
      { "fr": "Natural everyday French sentence 2", "en": "English translation 2" }
    ],
    "quiz": {
      "tense": "Présent or Passé Composé or Imparfait or Futur Simple or Conditionnel",
      "sentence": "French sentence with ____ where the conjugated verb goes",
      "en": "English translation of the quiz sentence",
      "answer": "exact missing conjugated word(s) for ____",
      "altAnswers": ["optional acceptable variant"],
      "explanation": "1-sentence grammar explanation"
    }
  }
}
Important formatting rules:
1. If the user types a non-French word, an English word like "banana", gibberish, or a French noun/adjective with no verb, set "isValidFrenchVerb": false and "verb": null!
2. In "tenses", append an asterisk * at the end of forms that have irregular stems, stem-changes, or être agreement (e.g. "nous buvons*") so the UI highlights them.
3. For impersonal verbs like falloir, pleuvoir, neiger, or s'agir, set "isImpersonal": true, use "—" for unused persons, and only fill index 2 ("il faut*").
4. Any reflexive verb (starting with "se " or "s'") MUST have "isReflexive": true and "auxiliary": "être".
`;

function extractJsonFromGeminiData(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const nonThoughtText = parts
    .filter((p) => !p.thought && typeof p.text === "string" && p.text.trim().length > 0)
    .map((p) => p.text.trim())
    .join("\n");
  const fallbackText = parts
    .filter((p) => typeof p.text === "string" && p.text.trim().length > 0)
    .map((p) => p.text.trim())
    .join("\n");

  let rawText = (nonThoughtText || fallbackText).trim();
  if (!rawText) return null;

  // Clean possible ```json ``` markdown code blocks and isolate the JSON object
  rawText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    rawText = rawText.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(rawText);
}

async function callGemini(apiKey, contents) {
  let lastErr = null;
  const cleanKey = String(apiKey || "").trim();

  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`;

    // Try JSON mode first; if a model returns an empty candidate in JSON mode, retry plain text mode
    const configsToTry = [
      { temperature: 0.1, responseMimeType: "application/json" },
      { temperature: 0.1 }
    ];

    for (const generationConfig of configsToTry) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents,
            generationConfig
          })
        });

        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const msg = errBody?.error?.message || `Gemini HTTP ${res.status}`;
          lastErr = new Error(msg);
          if (res.status === 401 || res.status === 403) {
            throw lastErr;
          }
          break; // Move to next model in MODELS
        }

        const data = await res.json();
        const parsed = extractJsonFromGeminiData(data);
        if (parsed) {
          return parsed;
        }

        const reason =
          data?.promptFeedback?.blockReason ||
          data?.candidates?.[0]?.finishReason ||
          "empty candidate";
        lastErr = new Error(`Empty response from Gemini (${model}: ${reason}).`);
        // Continue to fallback config (plain text mode) before moving to next model
      } catch (fetchErr) {
        clearTimeout(timer);
        lastErr = fetchErr;
        if (fetchErr.name === "AbortError") {
          lastErr = new Error(`Model ${model} timed out. Trying fallback...`);
          break;
        }
        if (String(fetchErr.message).includes("API key not valid") || String(fetchErr.message).includes("401") || String(fetchErr.message).includes("403")) {
          throw fetchErr;
        }
      }
    }
  }
  throw lastErr || new Error("Could not reach Gemini API.");
}

export async function testGeminiKey(apiKey) {
  const parsed = await callGemini(apiKey, [
    { parts: [{ text: 'Return JSON: {"ok": true, "greeting": "Bonjour !"}' }] }
  ]);
  return !!parsed?.ok;
}

export async function lookupVerbWithAI(rawInput, apiKey) {
  const prompt = `You are an expert French linguistics tutor helping a Duolingo French learner.
Analyze the user's input: "${rawInput}"
${VERB_ENTRY_SCHEMA_PROMPT}`;

  const result = await callGemini(apiKey, [{ parts: [{ text: prompt }] }]);
  if (!result.isValidFrenchVerb || !result.verb) {
    return {
      ok: false,
      reason: result.reasonIfInvalid || `“${rawInput}” is not recognized as a French verb.`
    };
  }
  return {
    ok: true,
    verb: normalizeVerbEntry(result.verb),
    detectedFrom: result.detectedFrom || null
  };
}

function fileToInlineData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.split(",")[1];
      resolve({
        inline_data: {
          mime_type: file.type || "image/png",
          data: base64
        }
      });
    };
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function extractVerbsFromScreenshots(files, apiKey) {
  const imageParts = await Promise.all(Array.from(files).map(fileToInlineData));
  const prompt = `You are reading one or more Duolingo (or French learning) phone screenshots.
Identify every meaningful French verb shown in the French exercise sentence(s) on screen (skip auxiliary-only 'avoir/être' when it is merely forming Passé Composé for another verb, unless avoir/être IS the main verb).
Return ONLY valid JSON with an array "entries", where each item has the exact "verb" object schema below (with "duolingoContext.fr" set to the EXACT French sentence visible in the screenshot, and "spottedForm" set to the conjugated word seen in the screenshot):
{
  "entries": [
    {
      "spottedForm": "word/phrase seen in screenshot",
      "verb": { ...same verb schema... }
    }
  ]
}
Schema reference for each "verb" object:
${VERB_ENTRY_SCHEMA_PROMPT}`;

  const result = await callGemini(apiKey, [
    { parts: [...imageParts, { text: prompt }] }
  ]);
  return Array.isArray(result?.entries) ? result.entries : [];
}

export async function extractVerbsFromWordTextWithAI(docText, apiKey) {
  const snippet = docText.slice(0, 15000);
  const prompt = `Below is text extracted from a student's Microsoft Word French verb document.
Extract every distinct French verb listed or studied in this document and return its lowercase French infinitive (include "se " or "s'" if it is listed as a reflexive verb, e.g. "se lever", "s'appeler").
Skip English words and skip auxiliary-only occurrences inside full conjugation tables if the main verb heading is already included.
Return ONLY valid JSON matching this exact structure:
{
  "infinitives": ["prendre", "aller", "se lever"]
}

Document text:
"""
${snippet}
"""`;

  const result = await callGemini(apiKey, [{ parts: [{ text: prompt }] }]);
  return Array.isArray(result?.infinitives)
    ? result.infinitives.map((s) => String(s || "").toLowerCase().trim()).filter(Boolean)
    : [];
}
