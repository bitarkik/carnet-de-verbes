// New AI entries must meet the full schema. Saved notebooks predate that schema:
// preserve variable-length and absent tense arrays rather than rejecting all entries.
const TENSES = ["present", "passeCompose", "imparfait", "futur", "conditionnel"];
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const text = v => typeof v === "string" && v.length <= 20000;
export function validateVerb(v, depth = 0, { legacy = false } = {}) {
  if (!object(v) || !text(v.infinitive) || !v.infinitive.trim() || !text(v.meaning) ||
      !text(v.pastParticiple) || !["avoir", "être"].includes(v.auxiliary) || !object(v.tenses)) {
    throw new Error("Invalid verb entry: missing or malformed required fields.");
  }
  for (const key of TENSES) {
    const forms = v.tenses[key];
    if (legacy && forms === undefined) continue;
    if (!Array.isArray(forms) || (!legacy && forms.length !== 6) || !forms.every(text))
      throw new Error(`Invalid conjugations for ${v.infinitive}: ${key}.`);
  }
  for (const key of ["note", "group"]) if (v[key] !== undefined && !text(v[key])) throw new Error(`Invalid ${key}.`);
  for (const key of ["addedAt", "updatedAt"]) if (v[key] !== undefined && (!Number.isFinite(v[key]) || v[key] < 0)) throw new Error("Invalid timestamp.");
  for (const key of ["isReflexive", "isIrregular", "isImpersonal", "isDualAux"]) if (v[key] !== undefined && typeof v[key] !== "boolean") throw new Error(`Invalid ${key}.`);
  if (v.duolingoContext !== undefined && (!object(v.duolingoContext) || !text(v.duolingoContext.fr) || !text(v.duolingoContext.en))) throw new Error("Invalid example context.");
  if (v.duolingoTips !== undefined && (!object(v.duolingoTips) || !Object.values(v.duolingoTips).every(text))) throw new Error("Invalid grammar tips.");
  if (v.examples !== undefined && (!Array.isArray(v.examples) || !v.examples.every(e => object(e) && text(e.fr) && text(e.en)))) throw new Error("Invalid examples.");
  if (v.quiz !== undefined && (!object(v.quiz) || !["sentence", "answer", "tense", "en"].every(k => text(v.quiz[k])) || !v.quiz.sentence.includes("____") || (v.quiz.altAnswers !== undefined && (!Array.isArray(v.quiz.altAnswers) || !v.quiz.altAnswers.every(text))) || (v.quiz.explanation !== undefined && !text(v.quiz.explanation)))) throw new Error("Invalid practice question.");
  if (v.counterpartData === undefined) return structuredClone(v);

  const { counterpartData, ...entry } = v;
  if (depth >= 1) {
    if (!legacy) throw new Error("Nested counterpart data is unsupported.");
    // Older notebooks can contain a cached copy of the original verb inside its counterpart.
    return structuredClone(entry);
  }
  return {
    ...structuredClone(entry),
    counterpartData: validateVerb(counterpartData, depth + 1, { legacy })
  };
}
export function validateState(value, { legacy = true } = {}) {
  if (Array.isArray(value)) value = { verbs: value, tombstones: {} };
  if (!object(value) || !Array.isArray(value.verbs) || value.verbs.length > 10000) throw new Error("Invalid notebook format.");
  const tombstones = value.tombstones ?? {};
  if (!object(tombstones) || !Object.entries(tombstones).every(([key, ts]) => key.trim() && Number.isFinite(ts) && ts >= 0)) throw new Error("Invalid deletion history.");
  return { verbs: value.verbs.map(v => validateVerb(v, 0, { legacy })), tombstones: { ...tombstones } };
}
