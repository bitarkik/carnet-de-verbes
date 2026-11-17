import test from "node:test";
import assert from "node:assert/strict";
import { OFFLINE_DICTIONARY, lookupOfflineVerb, extractOfflineVerbsFromText } from "../js/french-engine.js";
import { validateVerb, validateState } from "../js/validation.js";
import { mergeNotebookStates, syncWithGitHubGist, saveLocalState, loadLocalState, saveSettings, loadSettings } from "../js/sync.js";
import { generateDocxBlob, extractTextFromDocx } from "../js/word-io.js";
const verb = () => structuredClone(OFFLINE_DICTIONARY.prendre);
test("all 139 offline entries satisfy external-data schema", () => {
  assert.equal(Object.keys(OFFLINE_DICTIONARY).length, 139);
  Object.values(OFFLINE_DICTIONARY).forEach(v => validateVerb(v));
});
test("individual third-person subjects and reflexives resolve", () => {
  for (const input of ["il est", "elle est", "ils sont", "elles sont", "on est"]) assert.equal(lookupOfflineVerb(input).verb.infinitive, "être");
  assert.equal(lookupOfflineVerb("je me rends").verb.infinitive, "se rendre");
  assert.equal(lookupOfflineVerb("__proto__").ok, false);
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
test("credentials are session-only unless explicitly remembered",()=>{
  globalThis.localStorage=storage();globalThis.sessionStorage=storage();
  saveSettings({geminiKey:"test-key",githubToken:"test-token",rememberCredentials:false});
  assert.ok(!localStorage.getItem("carnet_de_verbes_settings_v1").includes("test-key"));
  assert.equal(loadSettings().geminiKey,"test-key");
  saveSettings({geminiKey:"test-key",githubToken:"test-token",rememberCredentials:true});
  assert.ok(localStorage.getItem("carnet_de_verbes_settings_v1").includes("test-key"));
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
