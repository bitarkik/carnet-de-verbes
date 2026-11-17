import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { OFFLINE_DICTIONARY } from "../js/french-engine.js";
const stateKey="carnet_de_verbes_state_v1";
test.beforeEach(async ({page}) => { page.on("pageerror", error => console.log("PAGE ERROR:",error.stack)); });
test("add, persist, backup restore notes, delete and undo",async({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/"); await expect(page.locator("html")).toHaveAttribute("data-ready","true");
  await page.getByRole("textbox",{name:"French verb",exact:true}).fill("elle est");
  await page.getByRole("button",{name:"Add",exact:true}).click();
  await expect(page.getByRole("button",{name:"être",exact:true})).toBeVisible();
  await page.getByRole("textbox",{name:"Note for être"}).fill("original note");
  await page.reload();
  await expect(page.getByRole("textbox",{name:"Note for être"})).toHaveValue("original note");
  const backup={verbs:[{...OFFLINE_DICTIONARY['être'],note:"restored note"}],tombstones:{}};
  await page.locator("#import-json-file-input").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(backup))});
  await expect(page.getByRole("textbox",{name:"Note for être"})).toHaveValue("restored note");
  await page.getByRole("button",{name:"Delete verb"}).click();
  await expect(page.locator("#verb-count-label")).toHaveText("0 verbs saved");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.locator("#verb-count-label")).toHaveText("1 verb saved");
  expect(errors).toEqual([]);
});
test("flashcard front, reveal and audio use the same shuffled verb",async({page})=>{
  await page.addInitScript(({stateKey,verbs})=>{localStorage.setItem(stateKey,JSON.stringify({verbs,tombstones:{}})); Math.random=()=>0;},{stateKey,verbs:[OFFLINE_DICTIONARY.prendre,OFFLINE_DICTIONARY.boire]});
  await page.goto("/"); await expect(page.locator("html")).toHaveAttribute("data-ready","true");
  await page.getByRole("button",{name:"Menu and settings"}).click();
  await page.getByRole("button",{name:/Open Practice Drills/}).click();
  await page.getByRole("button",{name:"Switch to Flashcards"}).click();
  await expect(page.locator("#flashcard-main-text")).toHaveText(OFFLINE_DICTIONARY.boire.meaning);
  await page.locator("#flashcard-stage").focus();await page.keyboard.press("Enter");
  await expect(page.locator("#flashcard-main-text")).toContainText("boire");
});
test("keyboard overlays, accessibility and mobile layout",async({page})=>{
  await page.goto("/"); await expect(page.locator("html")).toHaveAttribute("data-ready","true");await page.getByRole("button",{name:"Load 3 Starter Verbs"}).click();
  await page.getByRole("button",{name:"Menu and settings"}).click();
  await expect(page.getByRole("button",{name:"Close menu"})).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await page.locator("#settings-drawer").evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button",{name:"Menu and settings"})).toBeFocused();
  await page.getByRole("button",{name:"Add from screenshot"}).click();
  await expect(page.getByRole("button",{name:"Close screenshot dialog"})).toBeFocused();
  await page.keyboard.press("Escape");
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test("offline reload retains notebook and core assets",async({page,context})=>{
  await page.goto("/"); await expect(page.locator("html")).toHaveAttribute("data-ready","true");await page.getByRole("button",{name:"Load 3 Starter Verbs"}).click();
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();await context.setOffline(true);await page.reload();
  await expect(page.locator("#verb-count-label")).toHaveText("3 verbs saved");
});

test("sync preserves edits made while GitHub is responding",async({page})=>{
  await page.addInitScript(({stateKey,v})=>{
    localStorage.setItem(stateKey,JSON.stringify({verbs:[{...v,updatedAt:1}],tombstones:{}}));
    localStorage.setItem("carnet_de_verbes_settings_v1",JSON.stringify({gistId:"mock-gist",githubToken:"mock-token",rememberCredentials:true}));
    const originalFetch=window.fetch.bind(window);
    window.syncGate={started:false,release:null,writes:[]};
    window.fetch=async(url,options={})=>{
      if(!String(url).startsWith("https://api.github.com/")) return originalFetch(url,options);
      if(options.method === "PATCH") {window.syncGate.writes.push(JSON.parse(options.body));return new Response("{}");}
      if(!window.syncGate.started) {window.syncGate.started=true; await new Promise(resolve=>window.syncGate.release=resolve);}
      return new Response(JSON.stringify({public:false,files:{"carnet-de-verbes-sync.json":{content:JSON.stringify({verbs:[{...v,updatedAt:1}],tombstones:{}})}}}));
    };
  },{stateKey,v:OFFLINE_DICTIONARY.prendre});
  await page.goto("/");await expect(page.locator("html")).toHaveAttribute("data-ready","true");
  await expect.poll(()=>page.evaluate(()=>window.syncGate.started)).toBe(true);
  await page.getByRole("textbox",{name:"Note for prendre"}).fill("typed during sync");
  await page.evaluate(()=>window.syncGate.release());
  await expect(page.getByRole("textbox",{name:"Note for prendre"})).toHaveValue("typed during sync");
  await expect.poll(()=>page.evaluate(stateKey=>JSON.parse(localStorage.getItem(stateKey)).verbs[0].note,stateKey)).toBe("typed during sync");
});

test("dark theme and open overlays pass accessibility checks",async({page},testInfo)=>{
  await page.goto("/");await expect(page.locator("html")).toHaveAttribute("data-ready","true");
  await page.getByRole("button",{name:"Load 3 Starter Verbs"}).click();
  await page.getByRole("button",{name:"Menu and settings"}).click();
  await page.locator("#drawer-theme-btn").click();
  let results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)}))).toEqual([]);
  await page.keyboard.press("Escape");
  await page.screenshot({path:`test-results/notebook-${testInfo.project.name}.png`,fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"Add from screenshot"}).click();
  results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)}))).toEqual([]);
});

test("storage failure stays visible and malformed restore is atomic",async({page})=>{
  await page.goto("/");await expect(page.locator("html")).toHaveAttribute("data-ready","true");
  await page.getByRole("button",{name:"Load 3 Starter Verbs"}).click();
  const bad={verbs:[{...OFFLINE_DICTIONARY.aller,note:"should not import"},{infinitive:"broken"}]};
  await page.locator("#import-json-file-input").setInputFiles({name:"broken.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(bad))});
  await expect(page.locator("#verb-count-label")).toHaveText("3 verbs saved");
  await expect(page.locator("#status-msg-text")).toContainText("Backup restore failed");
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==="carnet_de_verbes_state_v1")throw new DOMException("QuotaExceededError");return original.call(this,key,value)}});
  await page.getByRole("textbox",{name:"Note for prendre"}).fill("not saved");
  await expect(page.locator("#storage-warning")).toContainText("could not be saved");
});

test("legacy 160-entry notebook remains accessible after upgrade",async({page})=>{
  const verbs=Array.from({length:160},(_,i)=>({...structuredClone(OFFLINE_DICTIONARY.prendre),infinitive:i===159?"retourner":`legacy-${i}`,note:`note ${i}`,addedAt:i+1,updatedAt:i+1}));
  verbs[159].tenses.passeCompose.push(...verbs[159].tenses.passeCompose);
  await page.addInitScript(({stateKey,verbs})=>{if(!localStorage.getItem(stateKey))localStorage.setItem(stateKey,JSON.stringify({verbs,tombstones:{}}));},{stateKey,verbs});
  await page.goto("/");await expect(page.locator("html")).toHaveAttribute("data-ready","true");
  await expect(page.locator("#verb-count-label")).toHaveText("160 verbs saved");
  const raw=await page.evaluate(stateKey=>localStorage.getItem(stateKey),stateKey);
  expect(JSON.parse(raw).verbs[159].tenses.passeCompose).toHaveLength(12);
  await expect(page.getByRole("textbox",{name:"Note for legacy-0"})).toHaveValue("note 0");
  await page.reload();await expect(page.locator("#verb-count-label")).toHaveText("160 verbs saved");
  await page.getByRole("button",{name:"Menu and settings"}).click();
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Download original recovery copy"}).click();
  expect((await download).suggestedFilename()).toBe("carnet-de-verbes-before-restore.json");
});
