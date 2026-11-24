import test from "node:test";
import assert from "node:assert/strict";
import { OFFLINE_DICTIONARY, lookupOfflineVerb, extractOfflineVerbsFromText, getReflexiveCounterpart } from "../js/french-engine.js";
import { validateVerb, validateState } from "../js/validation.js";
import { mergeNotebookStates, syncWithGitHubGist, saveLocalState, loadLocalState, saveSettings, loadSettings } from "../js/sync.js";
import { generateDocxBlob, extractTextFromDocx } from "../js/word-io.js";
const verb = () => structuredClone(OFFLINE_DICTIONARY.prendre);
test("all offline entries satisfy external-data schema", () => {
  assert.equal(Object.keys(OFFLINE_DICTIONARY).length, 154);
  Object.values(OFFLINE_DICTIONARY).forEach(v => validateVerb(v));
});
test("individual third-person subjects and reflexives resolve", () => {
  for (const input of ["il est", "elle est", "ils sont", "elles sont", "on est"]) assert.equal(lookupOfflineVerb(input).verb.infinitive, "être");
  assert.equal(lookupOfflineVerb("je me rends").verb.infinitive, "se rendre");
  assert.equal(lookupOfflineVerb("__proto__").ok, false);
});
test("all 28 audited pairs are complete and switchable offline in either direction", () => {
  const pairs = {
    aider: "s'aider", attendre: "s'attendre", casser: "se casser", connaître: "se connaître",
    couper: "se couper", croire: "se croire", décider: "se décider", devoir: "se devoir",
    dire: "se dire", donner: "se donner", essayer: "s'essayer", expliquer: "s'expliquer",
    laisser: "se laisser", montrer: "se montrer", mouiller: "se mouiller", offrir: "s'offrir",
    ouvrir: "s'ouvrir", parler: "se parler", porter: "se porter", poser: "se poser",
    prendre: "se prendre", présenter: "se présenter", ranger: "se ranger", rencontrer: "se rencontrer",
    réserver: "se réserver", retourner: "se retourner", revoir: "se revoir", tourner: "se tourner"
  };
  for (const [base, other] of Object.entries(pairs)) {
    assert.equal(validateVerb(lookupOfflineVerb(base).verb).infinitive, base);
    const form = validateVerb(lookupOfflineVerb(other).verb);
    assert.equal(form.infinitive, other);
    assert.equal(form.auxiliary, "être");
    assert.equal(form.isReflexive, true);
    assert.equal(getReflexiveCounterpart(base), other);
    assert.equal(getReflexiveCounterpart(other), base);
    assert.equal(form.quiz.sentence.replace("____", form.quiz.answer), form.duolingoContext.fr);
  }
  assert.equal(lookupOfflineVerb("s’attendre à").verb.infinitive, "s'attendre");
  assert.equal(lookupOfflineVerb("se prendre pour un expert").verb.infinitive, "se prendre");
  assert.equal(lookupOfflineVerb("se presenter").verb.infinitive, "se présenter");
  assert.equal(lookupOfflineVerb("elles se sont parlé").verb.infinitive, "se parler");
  assert.equal(lookupOfflineVerb("nous nous reverrons").verb.infinitive, "se revoir");
});

test("audited compound forms keep the right agreement for the usage", () => {
  const plural = form => lookupOfflineVerb(form).verb.tenses.passeCompose[5].replace(/\*/g, "");
  const expected = {
    "se parler": "parlé", "se dire": "dit", "se donner": "donné", "s'offrir": "offert",
    "se réserver": "réservé", "se casser": "cassé", "se laisser": "laissé",
    "se couper": "coupé(e)s", "se rencontrer": "rencontré(e)s",
    "se prendre": "pris / prises", "se devoir": "dus / dues"
  };
  for (const [form, participle] of Object.entries(expected)) {
    assert.equal(plural(form), `ils/elles se sont ${participle}`);
  }
});
test("Word extraction never fabricates unknown irregulars", () => {
  assert.deepEqual(extractOfflineVerbsFromText("acquérir (to acquire)"), []);
  assert.equal(extractOfflineVerbsFromText("prendre (to take)")[0].infinitive, "prendre");
});
test("malformed backups rejected, including counterparts and nested fields", () => {
  for (const malformed of [null, {verbs:[null]}, {verbs:[{...verb(),tenses:{present:42}}]}, {verbs:[{...verb(),quiz:{answer:42}}]}, {verbs:[],tombstones:{prendre:"yesterday"}}, {verbs:[{...verb(),counterpartData:{infinitive:"bad"}}]}]) assert.throws(() => validateState(malformed));
});
test("merge preserves notes/counterparts and latest deletions", () => {
  const old = {...verb(),note:"old",updatedAt:10};
  const restored = {...verb(),note:"restored",updatedAt:20,counterpartData:structuredClone(OFFLINE_DICTIONARY.boire)};
  const result=mergeNotebookStates({verbs:[old],tombstones:{}},{verbs:[restored],tombstones:{}});
  assert.equal(result.verbs[0].note,"restored");
  assert.equal(result.verbs[0].counterpartData.infinitive,"boire");
  assert.equal(mergeNotebookStates(result,{verbs:[],tombstones:{prendre:20}}).verbs.length,0);
});
test("invalid, missing, public, truncated remote notebooks never PATCH", async () => {
  for (const gist of [{files:{}},{public:true,files:{}},{files:{"carnet-de-verbes-sync.json":{content:"broken"}}},{files:{"carnet-de-verbes-sync.json":{truncated:true,content:'{"verbs":[]}'}}}]) {
    let writes=0;
    globalThis.fetch=async (url,options={})=>{if(options.method) writes++; return {ok:true,json:async()=>gist};};
    await assert.rejects(syncWithGitHubGist({verbs:[],tombstones:{}},{githubToken:"mock",gistId:"123"}));
    assert.equal(writes,0);
  }
});
test("remote edits during merge abort upload", async () => {
  let reads=0,writes=0;
  globalThis.fetch=async(url,options={})=>{if(options.method) writes++; return {ok:true,json:async()=>({files:{"carnet-de-verbes-sync.json":{content:JSON.stringify({verbs:[],tombstones:reads++ ? {prendre:1}: {}})}}})};};
  await assert.rejects(syncWithGitHubGist({verbs:[],tombstones:{}},{githubToken:"mock",gistId:"123"}),/another device/);
  assert.equal(writes,0);
});
test("Word export round-trips accents and notes", async()=>{
  const v={...verb(),note:"École & <bonjour>"};
  const text=await extractTextFromDocx(generateDocxBlob([v]));
  assert.match(text,/École & <bonjour>/);
  assert.match(text,/prendre/);
});
function storage(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}}
test("storage failure is surfaced and corrupted notebook is not reset",()=>{
  globalThis.localStorage={getItem:()=>"broken",setItem:()=>{throw Error("quota")}};
  assert.throws(()=>loadLocalState(),/could not be read/);
  assert.throws(()=>saveLocalState([]),/could not be saved/);
});
test("startup keeps the first counterpart, drops deeper copies, and preserves the original", () => {
  const counterpart = {...lookupOfflineVerb("se rendre").verb, note: "Keep this counterpart note"};
  const entry = {...OFFLINE_DICTIONARY.rendre, note: "Keep this verb note"};
  const original = {
    verbs: [{...entry, counterpartData: {...counterpart, counterpartData: entry}}, verb()],
    tombstones: {boire: 42}
  };
  const raw = JSON.stringify(original);
  globalThis.localStorage = storage();
  localStorage.setItem("carnet_de_verbes_state_v1", raw);

  assert.deepEqual(loadLocalState(), {
    verbs: [{...entry, counterpartData: counterpart}, verb()],
    tombstones: original.tombstones
  });
  assert.equal(localStorage.getItem("carnet_de_verbes_state_v1"), raw);
  assert.equal(localStorage.getItem("carnet_de_verbes_before_compatibility"), raw);
});
test("credentials are session-only unless explicitly remembered",()=>{
  globalThis.localStorage=storage();globalThis.sessionStorage=storage();
  const state = {geminiKey: "test-key", groqKey: "test-groq", githubToken: "test-token", rememberCredentials: false};
  const key = "carnet_de_verbes_settings_v1";
  saveSettings(state);
  assert.equal(JSON.parse(localStorage.getItem(key)).geminiKey, undefined);
  assert.equal(JSON.parse(localStorage.getItem(key)).groqKey, undefined);
  assert.equal(loadSettings().geminiKey, state.geminiKey);
  assert.equal(loadSettings().groqKey, state.groqKey);
  saveSettings({...state, rememberCredentials: true});
  assert.equal(JSON.parse(localStorage.getItem(key)).geminiKey, state.geminiKey);
  assert.equal(JSON.parse(localStorage.getItem(key)).groqKey, state.groqKey);
  assert.equal(sessionStorage.getItem(key), null);
});

test("Gemini key validation rejects false success and keeps keys out of URLs", async()=>{
  const {testGeminiKey}=await import("../js/ai.js");
  let request;
  globalThis.fetch=async(url,options)=>{request={url,options};return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"ok":false}'}]}}]})};};
  await assert.rejects(testGeminiKey("mock-key"),/verification/);
  assert.ok(!request.url.includes("mock-key"));
  assert.equal(request.options.headers["x-goog-api-key"],"mock-key");
});
test("Gemini rejects malformed and auxiliary-inconsistent learning entries",async()=>{
  const {lookupVerbWithAI}=await import("../js/ai.js");
  for(const v of [{infinitive:"test"},{...verb(),auxiliary:"être"}]) {
    globalThis.fetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({isValidFrenchVerb:true,verb:v})}]}}]})});
    // prendre is normalized to avoir, so use an inherently être verb to detect a mismatched table.
    if(v.tenses) v.infinitive="aller";
    await assert.rejects(lookupVerbWithAI("mock","mock-key"));
  }
});

test("Gemini accepts a correct aller entry including vous êtes", async (t) => {
  const {lookupVerbWithAI} = await import("../js/ai.js");
  const entry = OFFLINE_DICTIONARY.aller;
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      candidates: [{content: {parts: [{text: JSON.stringify({isValidFrenchVerb: true, verb: entry})}]}}]
    })
  }));

  const result = await lookupVerbWithAI("aller", "mock-key");
  assert.equal(result.ok, true);
  assert.match(result.verb.tenses.passeCompose[4], /^vous êtes allé/);
});

test("offline lookup recognizes reflexive-only infinitives without generating a bare form", () => {
  for (const input of ["souvenir", "se souvenir", "mefier", "se méfier"]) {
    const result = lookupOfflineVerb(input);
    assert.equal(result.ok, true);
    assert.match(result.verb.infinitive, /^se /);
  }
  assert.equal(lookupOfflineVerb("se être").ok, false);
});

test("Gemini refuses unrelated or omitted counterparts when discovering both forms", async (t) => {
  const {lookupVerbWithAI} = await import("../js/ai.js");
  const result = {isValidFrenchVerb: true, verb: OFFLINE_DICTIONARY.disputer};
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      candidates: [{content: {parts: [{text: JSON.stringify(result)}]}}]
    })
  }));
  const options = {includeCounterpart: true};
  await assert.rejects(lookupVerbWithAI("disputer", "test-key", options), /did not finish/);
  result.counterpart = lookupOfflineVerb("s'occuper").verb;
  await assert.rejects(lookupVerbWithAI("disputer", "test-key", options), /different verbs/);
});

function legacyNotebook() {
  const verbs=Object.values(OFFLINE_DICTIONARY).filter(v=>v.infinitive!=="retourner").map(v=>({...structuredClone(v),updatedAt:1}));
  while(verbs.length<159) verbs.push({...verb(),infinitive:`legacy-${verbs.length}`,note:`original note ${verbs.length}`,updatedAt:1});
  verbs.push({...structuredClone(OFFLINE_DICTIONARY.retourner), note:"original note 159", updatedAt:1});
  verbs[159].tenses.passeCompose=[...verbs[159].tenses.passeCompose,...verbs[159].tenses.passeCompose];
  return {verbs,tombstones:{}};
}
test("legacy 160-verb notebook loads without discarding extended tense arrays or notes",()=>{
  const original=legacyNotebook();
  assert.throws(()=>validateVerb(original.verbs[159]),/passeCompose/);
  const loaded=validateState(original);
  assert.equal(loaded.verbs.length,160);
  assert.deepEqual(loaded,original);
  assert.equal(loaded.verbs[159].tenses.passeCompose.length,12);
  globalThis.localStorage=storage();
  const raw=JSON.stringify(original);
  localStorage.setItem("carnet_de_verbes_state_v1",raw);
  assert.equal(loadLocalState().verbs.length,160);
  assert.equal(localStorage.getItem("carnet_de_verbes_state_v1"),raw);
  assert.equal(localStorage.getItem("carnet_de_verbes_before_compatibility"),raw);
});
test("sync recovers all 160 remote entries into a 69-entry client and retains exact remote original",async()=>{
  const remote=legacyNotebook(),raw=JSON.stringify(remote);
  let patch;
  globalThis.fetch=async(url,options={})=>{
    if(options.method==="PATCH") {patch=JSON.parse(options.body);return {ok:true,json:async()=>({})};}
    return {ok:true,json:async()=>({public:false,files:{"carnet-de-verbes-sync.json":{content:raw}}})};
  };
  const result=await syncWithGitHubGist({verbs:remote.verbs.slice(0,69),tombstones:{}},{githubToken:"mock",gistId:"mock"});
  assert.equal(result.merged.verbs.length,160);
  assert.equal(result.merged.verbs.find(v=>v.infinitive==="retourner").tenses.passeCompose.length,12);
  assert.equal(patch.files["carnet-de-verbes-before-compatibility.json"].content,raw);
  assert.equal(JSON.parse(patch.files["carnet-de-verbes-sync.json"].content).verbs.length,160);
});

test("truncated Gist preview downloads full notebook before merge and conflict check",async()=>{
 const remote=legacyNotebook();let writes=0,rawReads=0;
 const content=JSON.stringify(remote);
 globalThis.fetch=async(url,options={})=>{
  if(String(url).startsWith("https://gist.githubusercontent.com/")){rawReads++;assert.equal(options.headers,undefined);return {ok:true,text:async()=>content};}
  if(options.method==="PATCH"){writes++;assert.equal(JSON.parse(JSON.parse(options.body).files["carnet-de-verbes-sync.json"].content).verbs.length,160);return {ok:true,json:async()=>({})};}
  return {ok:true,json:async()=>({files:{"carnet-de-verbes-sync.json":{truncated:true,content:content.slice(0,100),raw_url:"https://gist.githubusercontent.com/test/id/raw/version/notebook.json"}}})};
 };
 const result=await syncWithGitHubGist({verbs:remote.verbs.slice(0,69),tombstones:{}},{githubToken:"mock",gistId:"id"});
 assert.equal(result.merged.verbs.length,160);assert.equal(writes,1);assert.equal(rawReads,2);
});
test("failed full Gist download never writes",async()=>{
 let writes=0;
 globalThis.fetch=async(url,options={})=>{
  if(options.method==="PATCH")writes++;
  if(String(url).startsWith("https://gist.githubusercontent.com/"))return {ok:false,status:503};
  return {ok:true,json:async()=>({files:{"carnet-de-verbes-sync.json":{truncated:true,raw_url:"https://gist.githubusercontent.com/test/id/raw/version/notebook.json"}}})};
 };
 await assert.rejects(syncWithGitHubGist({verbs:[],tombstones:{}},{githubToken:"mock",gistId:"id"}),/download failed/);assert.equal(writes,0);
});
