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
