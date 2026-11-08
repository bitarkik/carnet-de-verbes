// ==========================================================================
// Live Google Gemini AI Integration (Verb Lookup, Screenshot Vision, Word Import)
// ==========================================================================

// Modern Gemini 3.x Flash series models ONLY (all legacy 2.x models removed)
const MODELS = [
  "gemini-3.8-flash",      // Primary recommended model
  "gemini-3.6-flash",      // Backup 1
  "gemini-3.5-flash-lite"  // Backup 2
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
    "group": "e.g. '1st group · Regular -er' or '3rd group · Irregular -ir'",
    "isIrregular": true,
    "isReflexive": false,
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
3. For impersonal verbs like falloir or pleuvoir, use "—" for unused persons and only fill index 2 ("il faut*").
`;

async function callGemini(apiKey, contents) {
  let lastErr = null;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    
    // Set up generation config with low thinking level so model doesn't spend 20+ seconds overthinking a verb
    const generationConfig = {
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingLevel: "low"
      }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000); // 12-second timeout per model attempt

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
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
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          throw lastErr;
        }
        continue;
      }

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      // In Gemini 3, internal reasoning has thought: true, final answer has thought: false or undefined
      const answerPart = parts.find((p) => !p.thought && p.text) || parts.find((p) => p.text);
      let rawText = answerPart?.text?.trim();
      if (!rawText) throw new Error("Empty response from Gemini.");
      
      // Clean possible ```json ``` markdown code blocks
      rawText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      return JSON.parse(rawText);
    } catch (fetchErr) {
      clearTimeout(timer);
      lastErr = fetchErr;
      if (fetchErr.name === "AbortError") {
        lastErr = new Error(`Model ${model} timed out. Trying faster fallback...`);
      }
      continue;
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
    verb: result.verb,
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
  const snippet = docText.slice(0, 12000);
  const prompt = `Below is text extracted from a student's Microsoft Word French verb list.
Identify up to 25 distinct French verbs listed in this document and generate complete structured verb objects for each one.
Return ONLY valid JSON: { "verbs": [ ...array of verb objects matching the "verb" schema below... ] }
${VERB_ENTRY_SCHEMA_PROMPT}

Document text:
"""
${snippet}
"""`;

  const result = await callGemini(apiKey, [{ parts: [{ text: prompt }] }]);
  return Array.isArray(result?.verbs) ? result.verbs : [];
}
