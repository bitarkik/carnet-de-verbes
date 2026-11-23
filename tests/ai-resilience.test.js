import test from "node:test";
import assert from "node:assert/strict";
import {setImmediate as nextTurn} from "node:timers/promises";
import {lookupVerbWithAI, extractVerbsFromWordTextWithAI, testGeminiKey} from "../js/ai.js";
import {OFFLINE_DICTIONARY, lookupOfflineVerb} from "../js/french-engine.js";

const models = ["gemini-3.5-flash-lite", "gemini-4-hydrogen", "gemini-3.8-flash"];
const apiModel = url => url.match(/\/models\/([^:]+):generateContent$/)[1];
const answer = result => Response.json({candidates: [{content: {parts: [{text: JSON.stringify(result)}]}, finishReason: "STOP"}]});
const refused = (status, message, details) => Response.json({error: {message, details}}, {status});
const entry = (verb, counterpart = null) => ({isValidFrenchVerb: true, verb, counterpart});

function mockReplies(t, ...responses) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({model: apiModel(url), config: JSON.parse(options.body).generationConfig});
    return responses.shift();
  });
  return calls;
}

test("typed lookup moves from high demand to Hydrogen and then past an invalid conjugation table", async t => {
  const base = OFFLINE_DICTIONARY.occuper;
  const counterpart = lookupOfflineVerb("s'occuper").verb;
  const broken = {...counterpart, tenses: {...counterpart.tenses, passeCompose: counterpart.tenses.passeCompose.slice(0, 5)}};
  const calls = mockReplies(t, refused(503, "High demand"), answer(entry(base, broken)), answer(entry(base, counterpart)));

  const result = await lookupVerbWithAI("occupe", "mock-key", {includeCounterpart: true});
  assert.equal(result.counterpart.infinitive, "s'occuper");
  assert.deepEqual(calls.map(call => call.model), models);
  const schema = calls[1].config.responseJsonSchema;
  assert.ok(schema.required.includes("counterpart"));
  assert.equal(schema.properties.counterpart.properties.tenses.properties.passeCompose.minItems, 6);
  assert.equal(schema.properties.counterpart.properties.tenses.properties.passeCompose.maxItems, 6);
  assert.equal(calls[1].config.thinkingConfig.thinkingLevel, "LOW");
});

test("partial model failures are reported as quota, overload and availability errors", async t => {
  const calls = mockReplies(t, refused(429, "Limit reached"), refused(503, "High demand"), refused(404, "Model not found"));
  await assert.rejects(lookupVerbWithAI("occupe", "mock-key"), error => {
    assert.match(error.message, /rate limit or quota/);
    assert.match(error.message, /high demand/);
    assert.match(error.message, /unavailable for this project/);
    return true;
  });
  assert.deepEqual(calls.map(call => call.model), models);
});

test("invalid keys stop retries, including API_KEY_INVALID reported as HTTP 400", async t => {
  const calls = mockReplies(t, refused(400, "Invalid credential", [{reason: "API_KEY_INVALID"}]));
  await assert.rejects(testGeminiKey("mock-key"), /rejected the API key/);
  assert.equal(calls.length, 1);
});

test("a rejected schema retries without optional settings within the same model", async t => {
  const calls = mockReplies(t, refused(400, "responseJsonSchema not supported"), answer({ok: true}));
  assert.equal(await testGeminiKey("mock-key"), true);
  assert.deepEqual(calls.map(call => call.model), [models[0], models[0]]);
  assert.equal(calls[0].config.responseMimeType, "application/json");
  assert.deepEqual(calls[1].config, {});
});

test("typed requests abort stalled response bodies within one 30-second budget", async t => {
  t.mock.timers.enable({apis: ["Date", "setTimeout"], now: 100000});
  const attempts = [];
  const aborted = [];
  t.mock.method(globalThis, "fetch", async (url, {signal}) => {
    const model = apiModel(url);
    attempts.push(model);
    return {ok: true, json: () => new Promise((_, reject) => {
      signal.addEventListener("abort", () => { aborted.push(model); reject(signal.reason); }, {once: true});
    })};
  });

  const result = assert.rejects(lookupVerbWithAI("occupe", "mock-key"), /timed out/);
  for (const timeout of [9000, 10000, 11000]) {
    await nextTurn();
    t.mock.timers.tick(timeout);
  }
  await result;
  assert.deepEqual(attempts, models);
  assert.deepEqual(aborted, models);
  assert.equal(Date.now(), 130000);
});

test("a malformed Word extraction falls back instead of pretending that no verbs were found", async t => {
  const calls = mockReplies(t, answer({infinitives: [42]}), answer({infinitives: [" Prendre ", "aller"]}));
  assert.deepEqual(await extractVerbsFromWordTextWithAI("prendre et aller", "mock-key"), ["prendre", "aller"]);
  assert.deepEqual(calls.map(call => call.model), models.slice(0, 2));
});

test("a valid no-match reply needs no fallback", async t => {
  const calls = mockReplies(t, answer({isValidFrenchVerb: false, verb: null, counterpart: null}));
  const result = await lookupVerbWithAI("zzzzz", "mock-key", {includeCounterpart: true});
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
});

test("Groq gets the remaining twelve seconds after stalled Gemini attempts", async t => {
  t.mock.timers.enable({apis: ["Date", "setTimeout"], now: 100000});
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const groq = new URL(url).hostname === "api.groq.com";
    calls.push({provider: groq ? "Groq" : apiModel(url), at: Date.now(), headers: options.headers});
    return new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), {once: true});
    });
  });
  const lookup = lookupVerbWithAI("dérange", "google-key", {includeCounterpart: true, groqKey: "groq-key"});
  const rejected = assert.rejects(lookup, /Also tried Groq.*Groq request timed out/);
  for (const elapsed of [8000, 5000, 5000, 12000]) {
    await nextTurn();
    t.mock.timers.tick(elapsed);
  }
  await rejected;
  assert.deepEqual(calls.map(({provider, at}) => [provider, at - 100000]), [
    [models[0], 0], [models[1], 8000], [models[2], 13000], ["Groq", 18000]
  ]);
  assert.ok(calls.slice(0, 3).every(call => !call.headers.Authorization && call.headers["x-goog-api-key"] === "google-key"));
  assert.equal(calls[3].headers.Authorization, "Bearer groq-key");
  assert.equal(calls[3].headers["x-goog-api-key"], undefined);
  assert.equal(Date.now(), 130000);
});

function groqAnswer(result) {
  return Response.json({choices: [{message: {content: JSON.stringify(result)}, finish_reason: "stop"}]});
}

test("Groq alone supports lookup, and retrying a rejected schema still validates conjugations", async t => {
  const calls = [];
  const invalid = {...OFFLINE_DICTIONARY.aller, tenses: {...OFFLINE_DICTIONARY.aller.tenses, present: ["je vais"]}};
  t.mock.method(globalThis, "fetch", async (url, {body}) => {
    assert.equal(new URL(url).hostname, "api.groq.com");
    const request = JSON.parse(body);
    calls.push(request);
    if (calls.length === 1) return refused(400, "response_format schema not supported");
    return groqAnswer(entry(invalid));
  });
  await assert.rejects(lookupVerbWithAI("aller", "", {includeCounterpart: true, groqKey: "groq-key"}), /Invalid conjugations for aller/);
  assert.equal(calls[0].model, "openai/gpt-oss-20b");
  const schema = calls[0].response_format.json_schema;
  assert.equal(schema.strict, true);
  assert.equal(schema.schema.additionalProperties, false);
  assert.equal(schema.schema.properties.verb.anyOf[0].additionalProperties, false);
  assert.ok(schema.schema.required.includes("counterpart"));
  assert.equal(calls[1].response_format.type, "json_object");
});

test("Gemini results that already contain both forms never contact Groq", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(new URL(url).hostname);
    return answer(entry(OFFLINE_DICTIONARY.occuper, lookupOfflineVerb("s'occuper").verb));
  });
  const result = await lookupVerbWithAI("occuper", "google-key", {groqKey: "groq-key", includeCounterpart: true});
  assert.equal(result.counterpart.infinitive, "s'occuper");
  assert.deepEqual(calls, ["generativelanguage.googleapis.com"]);
});

test("a missing form is cross-checked with Groq using only the identified infinitive", async t => {
  const from = (base, infinitive) => ({...base, infinitive, tenses: Object.fromEntries(Object.entries(base.tenses).map(([key, forms]) =>
    [key, forms.map(form => form.replaceAll("disput", "réconcili"))]))});
  const base = from(OFFLINE_DICTIONARY.disputer, "réconcilier");
  const counterpart = from(lookupOfflineVerb("se disputer").verb, "se réconcilier");
  const hosts = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const host = new URL(url).hostname;
    hosts.push(host);
    if (host === "generativelanguage.googleapis.com") return answer(entry(base));
    const request = JSON.parse(options.body);
    assert.match(request.messages[0].content, /infinitive "réconcilier"/);
    assert.doesNotMatch(request.messages[0].content, /hier soir/);
    return groqAnswer({counterpart});
  });
  const result = await lookupVerbWithAI("ils se sont réconciliés hier soir", "google-key", {groqKey: "groq-key", includeCounterpart: true});
  assert.deepEqual(hosts, ["generativelanguage.googleapis.com", "api.groq.com"]);
  assert.equal(result.counterpart.infinitive, "se réconcilier");
  assert.equal(result.provider, "Groq");
});

test("a timed out counterpart check preserves the first verb and respects the lookup deadline", async t => {
  t.mock.timers.enable({apis: ["Date", "setTimeout"], now: 100000});
  const attempts = [];
  t.mock.method(globalThis, "fetch", async (url, {signal}) => {
    attempts.push({model: apiModel(url), time: Date.now() - 100000});
    if (attempts.length === 3) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      return answer(entry(OFFLINE_DICTIONARY.aller));
    }
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), {once: true}));
  });
  const lookup = lookupVerbWithAI("aller", "mock-key", {includeCounterpart: true});
  for (const elapsed of [9000, 10000, 10000, 1000]) {
    await nextTurn();
    t.mock.timers.tick(elapsed);
  }
  const result = await lookup;
  assert.equal(result.verb.infinitive, "aller");
  assert.equal(result.counterpart, null);
  assert.equal(result.counterpartCheck, "incomplete");
  assert.deepEqual(attempts, [
    {model: models[0], time: 0}, {model: models[1], time: 9000},
    {model: models[2], time: 19000}, {model: models[0], time: 29000}
  ]);
  assert.equal(Date.now(), 130000);
});
