import { TENSE_KEYS, validateVerb } from "./validation.js?v=38";
// ==========================================================================
// Live Google Gemini AI Integration (Verb Lookup, Screenshot Vision, Word Import)
// ==========================================================================

import { areVerbCounterparts, getReflexiveCounterpart, isReflexiveOnly, lookupOfflineVerb, normalizeVerbEntry, stripAccents } from "./french-engine.js?v=38";

const FLASH_LITE = "gemini-3.5-flash-lite";
const HYDROGEN = "gemini-4-hydrogen";
const FLASH = "gemini-3.8-flash";
const TEXT_PLAN = {models: [FLASH_LITE, HYDROGEN, FLASH], totalMs: 30000, attemptsMs: [9000, 10000, 11000]};
const TEXT_WITH_GROQ_PLAN = {...TEXT_PLAN, totalMs: 18000, attemptsMs: [8000, 5000, 5000]};
const GROQ_MODEL = "openai/gpt-oss-20b";
const GROQ_CHECK_MODEL = "openai/gpt-oss-120b";
const COUNTERPART_CHECK_MS = 12000;
const SCREENSHOT_PLAN = {models: [FLASH, HYDROGEN, FLASH_LITE], totalMs: 60000, attemptsMs: [22000, 20000, 18000]};

const textField = {type: "string"};
const booleanField = {type: "boolean"};
const textList = {type: "array", items: textField};
const sixForms = {...textList, minItems: 6, maxItems: 6};
const jsonObject = (properties, required = Object.keys(properties)) => ({type: "object", properties, required});
const bilingualText = jsonObject({fr: textField, en: textField});
const verbSchema = jsonObject({
  infinitive: textField,
  meaning: textField,
  group: textField,
  isIrregular: booleanField,
  isReflexive: booleanField,
  isImpersonal: booleanField,
  auxiliary: {type: "string", enum: ["avoir", "être"]},
  pastParticiple: textField,
  duolingoContext: bilingualText,
  duolingoTips: jsonObject({auxiliaryNote: textField, preposition: textField, homophone: textField, extra: textField}),
  tenses: jsonObject(Object.fromEntries(TENSE_KEYS.map(tense => [tense, sixForms]))),
  examples: {type: "array", items: bilingualText},
  quiz: jsonObject({
    tense: textField, sentence: textField, en: textField, answer: textField,
    altAnswers: textList, explanation: textField
  }, ["tense", "sentence", "en", "answer"])
}, ["infinitive", "meaning", "auxiliary", "pastParticiple", "tenses"]);
const nullableVerb = {...verbSchema, type: ["object", "null"]};
const nullableText = {type: ["string", "null"]};

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
5. Every tense has exactly six strings, in the order je/j', tu, il/elle, nous, vous, ils/elles. Put gender and number alternatives in the same row.
`;

class AIFailure extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function classifyGeminiResponse(status, error) {
  const message = error?.message || "";
  const reasons = Array.isArray(error?.details) ? error.details.map(detail => detail?.reason) : [];
  if (status === 401 || reasons.some(reason => /^API_KEY_/.test(reason || "")) ||
      /API key (?:not valid|is invalid|was reported|has expired)/i.test(message)) {
    return new AIFailure("key", "Gemini rejected the API key. Check it in Settings.");
  }
  if (status === 429 || (status === 400 && /billing|free tier|quota/i.test(message))) {
    return new AIFailure("quota", "Gemini's rate limit or quota was reached. Check your AI Studio limits or try later.");
  }
  if (status === 503) return new AIFailure("busy", "Gemini reported high demand. Try again in a moment.");
  if (status === 408 || status === 504) return new AIFailure("timeout", "A Gemini request timed out. Please retry.");
  if (status === 404 || (status === 403 && /model|tier/i.test(message))) {
    return new AIFailure("unavailable", "A Gemini model is unavailable for this project.");
  }
  if (status === 403) return new AIFailure("key", "Gemini denied access. Check the API key and project permissions in Settings.");
  if (status === 400 && /schema|response.?mime.?type|response.?format|thinking.?config|thinking.?level/i.test(message)) {
    return new AIFailure("format", "Gemini rejected the requested response format.");
  }
  if (status >= 500) return new AIFailure("service", "Gemini reported a temporary service error. Please retry.");
  return new AIFailure("request", `Gemini rejected the request (HTTP ${status}).`);
}

function readGeminiOutput(data) {
  const candidate = data?.candidates?.[0];
  if (data?.promptFeedback?.blockReason || ["SAFETY", "PROHIBITED_CONTENT", "RECITATION"].includes(candidate?.finishReason)) {
    throw new AIFailure("blocked", "Gemini blocked this request. Try a shorter phrase or a cropped screenshot.");
  }
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    throw new AIFailure("invalid", "Gemini did not finish its answer.");
  }
  const parts = candidate?.content?.parts;
  const text = Array.isArray(parts) ? parts.filter(part => !part?.thought && typeof part?.text === "string")
    .map(part => part.text).join("").trim() : "";
  if (!text) throw new AIFailure("invalid", "Gemini returned an empty answer.");
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

async function requestAI({provider, url, headers, body, timeoutMs, readOutput, classify, validate}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json", ...headers},
      credentials: "omit",
      signal: controller.signal,
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(error => {
      if (controller.signal.aborted) throw error;
      return null;
    });
    if (!response.ok) throw classify(response.status, data?.error);
    try {
      return validate(readOutput(data));
    } catch (error) {
      if (error instanceof AIFailure) throw error;
      const detail = error instanceof SyntaxError ? `${provider} returned malformed JSON.` : error.message;
      throw new AIFailure("invalid", provider === "Groq" && !(error instanceof SyntaxError) ? `Groq: ${detail}` : detail);
    }
  } catch (error) {
    if (controller.signal.aborted) throw new AIFailure("timeout", `A ${provider} request timed out. Please retry.`);
    if (error instanceof AIFailure) throw error;
    throw new AIFailure("network", `The connection to ${provider} failed. Check your internet connection and retry.`);
  } finally {
    clearTimeout(timer);
  }
}

function requestGemini(model, key, contents, generationConfig, timeoutMs, validate) {
  return requestAI({
    provider: "Gemini",
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: {"x-goog-api-key": key}, body: {contents, generationConfig}, timeoutMs,
    readOutput: readGeminiOutput, classify: classifyGeminiResponse, validate
  });
}

async function callGemini(apiKey, contents, schema, validate, plan = TEXT_PLAN) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Connect a Gemini API key in Settings first.");
  const deadline = Math.min(Date.now() + plan.totalMs, plan.deadline ?? Infinity);
  const failures = new Map();

  for (const [index, model] of plan.models.entries()) {
    const attemptEnd = Math.min(deadline, Date.now() + plan.attemptsMs[index]);
    if (attemptEnd <= Date.now()) break;
    const generationConfig = {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      thinkingConfig: {thinkingLevel: model === FLASH_LITE ? "MINIMAL" : "LOW"}
    };
    for (const config of [generationConfig, {}]) {
      const remaining = attemptEnd - Date.now();
      if (remaining <= 0) break;
      try {
        return await requestGemini(model, key, contents, config, remaining, result => validate(result, model));
      } catch (error) {
        if (error.kind === "key" || error.kind === "blocked") throw error;
        // Retry this model without formatting options only if it rejected those options.
        if (error.kind === "format" && config === generationConfig) {
          failures.set(error.kind, error.message);
          continue;
        }
        failures.set(error.kind, error.message);
        break;
      }
    }
  }

  const details = [...failures.values()];
  if (Date.now() >= deadline && !failures.has("timeout")) details.push("The lookup reached its time limit.");
  throw new Error(details.length ? [...new Set(details)].join(" ") : "Gemini did not complete the request before its time limit.");
}

// Groq strict mode requires all properties and a closed object at every level.
function groqSchema(schema) {
  if (Array.isArray(schema.type)) {
    return {anyOf: schema.type.map(type => groqSchema({...schema, type}))};
  }
  if (schema.type === "object") {
    const properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, groqSchema(value)]));
    return {...jsonObject(properties), additionalProperties: false};
  }
  if (schema.type === "array") return {type: "array", items: groqSchema(schema.items)};
  return schema.enum ? {type: schema.type, enum: schema.enum} : {type: schema.type};
}

function classifyGroqResponse(status, error) {
  if (status === 401 || status === 403) return new AIFailure("key", "Groq rejected the API key or denied access. Check it in Settings.");
  if (status === 429) return new AIFailure("quota", "Groq's rate limit or quota was reached. Try again later.");
  if (status === 408 || status === 504) return new AIFailure("timeout", "A Groq request timed out. Please retry.");
  if (status === 404) return new AIFailure("unavailable", "The Groq model is unavailable for this account.");
  if (status >= 500 || status === 498) return new AIFailure("busy", "Groq is temporarily unavailable. Try again in a moment.");
  if (status === 400 && /json_validate_failed|schema|response.?format/i.test(`${error?.code || ""} ${error?.message || ""}`)) {
    return new AIFailure("format", "Groq rejected the requested response format.");
  }
  return new AIFailure("request", `Groq rejected the request (HTTP ${status}).`);
}

function readGroqOutput(data) {
  const choice = data?.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === "content_filter") {
    throw new AIFailure("blocked", "Groq blocked this request. Try a shorter phrase.");
  }
  if (choice?.finish_reason && choice.finish_reason !== "stop") {
    throw new AIFailure("invalid", "Groq did not finish its answer.");
  }
  const text = choice?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new AIFailure("invalid", "Groq returned an empty answer.");
  return JSON.parse(text);
}

async function callGroq(key, prompt, schema, validate, deadline, model = GROQ_MODEL) {
  const request = responseFormat => {
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw new AIFailure("timeout", "The lookup reached its time limit before Groq could answer.");
    return requestAI({
      provider: "Groq", url: "https://api.groq.com/openai/v1/chat/completions",
      headers: {Authorization: `Bearer ${key}`}, timeoutMs,
      body: {
        model, reasoning_effort: "low", messages: [{role: "user", content: prompt}],
        response_format: responseFormat
      },
      readOutput: readGroqOutput, classify: classifyGroqResponse, validate
    });
  };
  try {
    return await request({type: "json_schema", json_schema: {name: "notebook_response", strict: true, schema: groqSchema(schema)}});
  } catch (error) {
    if (error.kind !== "format") throw error;
    return request({type: "json_object"});
  }
}

export function testGroqKey(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Connect a Groq API key in Settings first.");
  return callGroq(key, 'Return only JSON: {"ok": true}', jsonObject({ok: booleanField}), result => {
    if (result?.ok !== true) throw new Error("The key verification response was invalid.");
    return true;
  }, Date.now() + 12000);
}

export function testGeminiKey(apiKey) {
  return callGemini(apiKey, [
    {parts: [{text: 'Return only JSON: {"ok": true}'}]}
  ], jsonObject({ok: booleanField}), result => {
    if (result?.ok !== true) throw new Error("Gemini did not return a valid verification response.");
    return true;
  });
}

export async function lookupVerbWithAI(rawInput, geminiKey, {includeCounterpart = false, knownInfinitive, expectedCounterpart, groqKey} = {}) {
  const pairInstructions = includeCounterpart ? `
Add a required top-level "counterpart" field. When the same infinitive has both established
non-reflexive and pronominal uses in modern French, return a complete verb entry for the other
form in "counterpart", with its own meanings, examples, quiz and conjugations. Do this whether
or not the input contains a reflexive pronoun. Prefer the form used in the input for "verb".
For an exclusively pronominal verb, use its full se/s' infinitive for "verb", even if the user
omitted the pronoun, and set "counterpart" to null. Also use null if no genuine counterpart
exists or the input is invalid. Never invent a form by adding or removing se/s'.
Each tense must have exactly six strings, one per person, including only one row for each
combined il/elle and ils/elles. Put gender/number alternatives in the same string.
${expectedCounterpart ? `The verified other form is ${JSON.stringify(expectedCounterpart)}. Include it in "counterpart".` : ""}
` : "";
  const prompt = `You are an expert French linguistics tutor helping a Duolingo French learner.
Analyze the user's input: ${JSON.stringify(rawInput)}
${knownInfinitive ? `Use the already identified infinitive ${JSON.stringify(knownInfinitive)} as "verb".` : ""}
${VERB_ENTRY_SCHEMA_PROMPT}${pairInstructions}`;

  const properties = {
    isValidFrenchVerb: booleanField, detectedFrom: nullableText, reasonIfInvalid: nullableText, verb: nullableVerb
  };
  const required = ["isValidFrenchVerb", "verb"];
  if (includeCounterpart) {
    properties.counterpart = nullableVerb;
    required.push("counterpart");
  }
  const schema = jsonObject(properties, required);
  const validate = (response, model) => ({
    ...validateLookupResult(response, rawInput, {includeCounterpart, knownInfinitive, expectedCounterpart}), model
  });
  const contents = [{parts: [{text: prompt}]}];
  const primaryKey = String(geminiKey || "").trim();
  const backupKey = String(groqKey || "").trim();
  const deadline = Date.now() + TEXT_PLAN.totalMs;
  const plan = {...(backupKey ? TEXT_WITH_GROQ_PLAN : TEXT_PLAN), deadline};
  const lookupWithGroq = () => callGroq(backupKey, prompt, schema, response => ({
    ...validate(response, GROQ_MODEL), provider: "Groq"
  }), deadline);

  let result;
  if (!primaryKey && backupKey) {
    result = await lookupWithGroq();
  } else {
    try {
      result = await callGemini(primaryKey, contents, schema, validate, plan);
    } catch (geminiError) {
      if (!backupKey || geminiError.kind === "blocked") throw geminiError;
      try {
        result = await lookupWithGroq();
      } catch (groqError) {
        throw new Error(`${geminiError.message} Also tried Groq. ${groqError.message}`);
      }
    }
  }

  if (!includeCounterpart || !result.ok || result.counterpart || isReflexiveOnly(result.verb.infinitive)) return result;
  return verifyMissingCounterpart(result, primaryKey, backupKey, expectedCounterpart, deadline);
}

export function checkVerbCounterpart(verb, geminiKey, groqKey) {
  return verifyMissingCounterpart({verb}, geminiKey, groqKey, undefined, Date.now() + COUNTERPART_CHECK_MS);
}

async function verifyMissingCounterpart(result, geminiKey, groqKey, expectedCounterpart, lookupDeadline) {
  const {infinitive} = result.verb;
  const expected = expectedCounterpart || getReflexiveCounterpart(infinitive);
  const offline = expected && lookupOfflineVerb(expected).verb;
  if (offline?.infinitive === expected && areVerbCounterparts(infinitive, expected)) {
    return {...result, counterpart: offline};
  }

  // Do not show a model's negative answer to the verifier. Ask it about the lemma independently.
  const prompt = `Act as a French dictionary. Check whether the French infinitive ${JSON.stringify(infinitive)}
  has an established ${result.verb.isReflexive ? "non-pronominal" : "pronominal (reflexive or reciprocal)"} form in modern French.
  Consider common fixed expressions as well as literal reflexive uses. The other form must be a genuine use of the
  same infinitive, with its own meaning. Do not invent one or return an unrelated synonym.
  ${expected ? `The verified spelling of the other form is ${JSON.stringify(expected)}.` : ""}
  Return JSON with one field, "counterpart". It must be null only if there is no established other form.
  Otherwise return a complete verb entry. Use the "verb" object described below as the field's value,
  including all six persons in each tense. Do not include the other fields from the example envelope.
  ${VERB_ENTRY_SCHEMA_PROMPT}`;
  const schema = jsonObject({counterpart: nullableVerb});
  const validate = response => {
    if (!response || !Object.hasOwn(response, "counterpart")) throw new Error("The AI did not return a second form check.");
    if (response.counterpart === null && !expected) return null;
    if (response.counterpart === null) throw new Error(`The AI did not return “${expected}”.`);
    const counterpart = checkedAIVerb(response.counterpart);
    if (!areVerbCounterparts(infinitive, counterpart.infinitive) || (expected && counterpart.infinitive !== expected)) {
      throw new Error("The AI did not return the matching form of this verb.");
    }
    return counterpart;
  };
  const deadline = Math.min(lookupDeadline, Date.now() + COUNTERPART_CHECK_MS);
  const complete = (counterpart, provider) => counterpart
    ? {...result, counterpart, provider}
    : {...result, counterpartCheck: "not-found"};
  if (groqKey) {
    const model = result.model === GROQ_MODEL ? GROQ_CHECK_MODEL : GROQ_MODEL;
    const groqDeadline = geminiKey && result.provider !== "Groq" ? Math.min(deadline, Date.now() + 7000) : deadline;
    try {
      return complete(await callGroq(groqKey, prompt, schema, validate, groqDeadline, model), "Groq");
    } catch (error) {
      if (error.kind === "blocked") return {...result, counterpartCheck: "incomplete"};
    }
  }
  if (geminiKey && Date.now() < deadline) {
    const plan = {models: TEXT_PLAN.models.filter(model => model !== result.model), totalMs: COUNTERPART_CHECK_MS, attemptsMs: [6000, 6000, 6000], deadline};
    try {
      return complete(await callGemini(geminiKey, [{parts: [{text: prompt}]}], schema, validate, plan), result.provider);
    } catch {
      // The main verb is valid. Leave the other form unchecked and allow a later retry.
    }
  }
  return {...result, counterpartCheck: "incomplete"};
}

function validateLookupResult(result, rawInput, {includeCounterpart, knownInfinitive, expectedCounterpart}) {
  if (typeof result?.isValidFrenchVerb !== "boolean" || !Object.hasOwn(result, "verb")) {
    throw new Error("The AI did not say whether it recognized the verb.");
  }
  if (!result.isValidFrenchVerb) {
    if (result.verb !== null || knownInfinitive) throw new Error("The AI did not return the identified verb.");
    return {
      ok: false,
      reason: typeof result.reasonIfInvalid === "string" && result.reasonIfInvalid.trim() ||
        `“${rawInput}” is not recognized as a French verb.`
    };
  }
  let verb = checkedAIVerb(result.verb);
  let counterpart = null;
  if (includeCounterpart) {
    if (!Object.hasOwn(result, "counterpart")) throw new Error("The AI did not finish checking for both forms. Please retry.");
    if (result.counterpart !== null) {
      counterpart = checkedAIVerb(result.counterpart);
      if (!areVerbCounterparts(verb.infinitive, counterpart.infinitive)) {
        throw new Error("The AI returned forms from different verbs. Please retry.");
      }
    }
    if (knownInfinitive && counterpart?.infinitive === knownInfinitive) [verb, counterpart] = [counterpart, verb];
    const expected = expectedCounterpart || getReflexiveCounterpart(verb.infinitive);
    if (expected && counterpart && counterpart.infinitive !== expected) {
      throw new Error(`The AI did not return “${expected}”. Please retry.`);
    }
  }
  if (knownInfinitive && verb.infinitive !== knownInfinitive) throw new Error("The AI returned a different verb. Please retry.");
  return {ok: true, verb, counterpart, detectedFrom: typeof result.detectedFrom === "string" ? result.detectedFrom : null};
}

function checkedAIVerb(raw) {
  const v = normalizeVerbEntry(validateVerb(raw));
  // Counterparts must be checked independently from their primary entries.
  delete v.counterpartData;
  const usesEtre = v.auxiliary === "être";
  for (const form of v.tenses.passeCompose) {
    if (form.startsWith("—")) continue;
    const etreForm = /\b(suis|es|est|sommes|etes|sont)\b/.test(stripAccents(form));
    if (etreForm !== usesEtre) throw new Error("AI returned inconsistent auxiliary and conjugations. Please retry.");
    if (v.isReflexive && !/\b(me|te|se|nous|vous)\b|[mts]['’]/i.test(form)) throw new Error("AI omitted a reflexive pronoun. Please retry.");
  }
  return v;
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

  const schema = jsonObject({entries: {type: "array", items: jsonObject({spottedForm: textField, verb: verbSchema})}});
  return callGemini(apiKey, [{parts: [...imageParts, {text: prompt}]}], schema, result => {
    if (!Array.isArray(result?.entries)) throw new Error("Gemini did not return a list of verbs from the screenshots.");
    return result.entries.map(item => {
      if (typeof item?.spottedForm !== "string" || !item.spottedForm.trim()) {
        throw new Error("Gemini did not identify a conjugated form in the screenshot.");
      }
      return {spottedForm: item.spottedForm, verb: checkedAIVerb(item.verb)};
    });
  }, SCREENSHOT_PLAN);
}

export async function extractVerbsFromWordTextWithAI(docText, apiKey) {
  if (docText.length > 15000) throw new Error("AI Word extraction is limited to 15,000 characters. Split the document into smaller files.");
  const snippet = docText;
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

  return callGemini(apiKey, [{parts: [{text: prompt}]}], jsonObject({infinitives: textList}), result => {
    if (!Array.isArray(result?.infinitives) || !result.infinitives.every(value => typeof value === "string" && value.trim())) {
      throw new Error("Gemini did not return a valid list of verbs from the document.");
    }
    return result.infinitives.map(value => value.toLowerCase().trim());
  });
}
