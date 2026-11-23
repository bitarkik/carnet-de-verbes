import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { OFFLINE_DICTIONARY, lookupOfflineVerb } from "../js/french-engine.js";
const stateKey="carnet_de_verbes_state_v1";
test.beforeEach(async ({page}) => { page.on("pageerror", error => console.log("PAGE ERROR:",error.stack)); });
test("add, persist, backup restore notes, delete and undo",async({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("/"); await expect(page.locator("html")).toHaveAttribute("data-ready","true");
  await page.getByRole("searchbox",{name:"French verb",exact:true}).fill("elle est");
  await page.getByRole("searchbox",{name:"French verb",exact:true}).press("Enter");
  await expect(page.getByRole("button",{name:"être",exact:true})).toBeVisible();
  await page.getByRole("textbox",{name:"Note for être"}).fill("original note");
  await page.reload();
  await expect(page.getByRole("textbox",{name:"Note for être"})).toHaveValue("original note");
  const backup={verbs:[{...OFFLINE_DICTIONARY['être'],note:"restored note"}],tombstones:{}};
  await page.locator("#import-json-file-input").setInputFiles({name:"backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(backup))});
  await expect(page.getByRole("textbox",{name:"Note for être"})).toHaveValue("restored note");
  const deleteButton = page.getByRole("button", {name: "Delete verb", exact: true});
  const confirmation = page.getByRole("dialog", {name: "Delete verb?"});
  await deleteButton.click();
  await expect(confirmation).toContainText("être");
  await expect(confirmation.getByRole("button", {name: "Cancel"})).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(deleteButton).toBeFocused();
  await deleteButton.click();
  await confirmation.getByRole("button", {name: "Cancel"}).click();
  await expect(page.locator("#verb-count-label")).toHaveText("1 verb saved");
  await deleteButton.click();
  await confirmation.getByRole("button", {name: "Delete verb"}).click();
  await expect(page.locator("#verb-count-label")).toHaveText("0 verbs saved");
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.locator("#verb-count-label")).toHaveText("1 verb saved");
  expect(errors).toEqual([]);
});
test("a closed added card stays closed when sync finishes and the message disappears", async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem("carnet_de_verbes_settings_v1", JSON.stringify({
      gistId: "mock-gist", githubToken: "mock-token", rememberCredentials: true
    }));
  });
  let releaseSync;
  const syncGate = new Promise(resolve => { releaseSync = resolve; });
  await page.route("https://api.github.com/gists/mock-gist", async route => {
    await syncGate;
    await route.fulfill({json: {public: false, files: {
      "carnet-de-verbes-sync.json": {content: JSON.stringify({verbs: [], tombstones: {}})}
    }}});
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  const input = page.getByRole("searchbox", {name: "French verb", exact: true});
  await input.fill("prendre");
  await input.press("Enter");
  const heading = page.getByRole("button", {name: "prendre", exact: true});
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  await heading.click();
  await expect(heading).toHaveAttribute("aria-expanded", "false");
  releaseSync();
  await expect(page.locator("#drawer-sync-status")).toContainText("Last synced:");
  await expect(page.locator("#status-msg")).toBeHidden({timeout: 6500});
  await expect(heading).toHaveAttribute("aria-expanded", "false");
});

test("adding a saved verb opens its full header without calling Gemini", async ({page}) => {
  const verbs = Object.values(OFFLINE_DICTIONARY).slice(0, 18);
  const target = "prendre";
  await page.addInitScript(({stateKey, verbs}) => {
    localStorage.setItem(stateKey, JSON.stringify({verbs, tombstones: {}}));
    sessionStorage.setItem("carnet_de_verbes_settings_v1", JSON.stringify({geminiKey: "mock-key"}));
  }, {stateKey, verbs});
  let calls = 0;
  await page.route("https://generativelanguage.googleapis.com/**", async route => {
    calls++;
    await route.fulfill({json: {candidates: [{content: {parts: [{text: JSON.stringify({
      isValidFrenchVerb: true, verb: OFFLINE_DICTIONARY.prendre, counterpart: null
    })}]}}]}});
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  const input = page.getByRole("searchbox", {name: "French verb", exact: true});
  const card = page.locator(`[data-card-inf="${target}"]`);
  const heading = card.getByRole("button", {name: target, exact: true});
  for (const typed of ["prendre", "prends"]) {
    await input.fill(typed);
    await input.press("Enter");
    await expect(page.locator("#status-msg-text")).toContainText("already in your notebook");
    await expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(calls).toBe(0);
    if (typed === "prendre") await heading.click();
  }
  await expect(page.locator("#status-msg")).toBeHidden({timeout: 6500});
  await expect(card.locator(".card-head")).toBeInViewport({ratio: 1});
  await expect(page.locator("#verb-count-label")).toHaveText("18 verbs saved");
});

test("saved conjugations show grouped subject pronouns only in the row labels", async ({page}) => {
  const entry = lookupOfflineVerb("s'inquiéter").verb;
  entry.tenses.present = [
    "je m'inquiète*", "tu t'inquiètes*", "il/elle/on s'inquiète*",
    "nous nous inquiétons", "vous vous inquiétez", "ils / elles s'inquiètent*"
  ];
  await page.addInitScript(({stateKey, entry}) => {
    localStorage.setItem(stateKey, JSON.stringify({verbs: [entry], tombstones: {}}));
    window.speechSynthesis.speak = utterance => { window.lastSpoken = utterance.text; };
  }, {stateKey, entry});
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  const cells = page.locator(".conj-cell");
  await expect(cells.locator(".conj-verb")).toHaveText([
    "m'inquiète", "t'inquiètes", "s'inquiète", "nous inquiétons", "vous inquiétez", "s'inquiètent"
  ]);
  await expect(cells.nth(2).locator(".conj-pronoun")).toHaveText("il / elle");
  await expect(cells.nth(2).locator(".stem-highlight")).toHaveText("s'inquiète");
  await cells.nth(2).click();
  expect(await page.evaluate(() => window.lastSpoken)).toBe("il s'inquiète");
});

test("dispute and occupe add offline with switchable reflexive forms", async ({page, context}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await context.setOffline(true);
  const input = page.getByRole("searchbox", {name: "French verb", exact: true});

  for (const [typed, base, reflexive, vousForm] of [
    ["dispute", "disputer", "se disputer", "vous vous êtes disputé(e)(s)*"],
    ["occupe", "occuper", "s'occuper", "vous vous êtes occupé(e)(s)*"]
  ]) {
    await input.fill(typed);
    await input.press("Enter");
    const card = page.locator(`[data-card-inf="${base}"]`);
    await expect(card.getByRole("heading", {name: base, exact: true})).toBeVisible();
    const saved = await page.evaluate(({stateKey, base}) =>
      JSON.parse(localStorage.getItem(stateKey)).verbs.find(v => v.infinitive === base), {stateKey, base});
    expect(saved.counterpartData.infinitive).toBe(reflexive);
    await card.getByRole("button", {name: reflexive, exact: true}).click();
    await expect(card.getByRole("heading", {name: reflexive, exact: true})).toBeVisible();
    await card.getByRole("button", {name: "Passé composé", exact: true}).click();
    await expect(card.locator(`[data-speak="${vousForm}"]`)).toBeVisible();
  }

  await expect(page.locator("#verb-count-label")).toHaveText("2 verbs saved");
});
for (const startWithReflexive of [false, true]) {
  const first = startWithReflexive ? "se réconcilier" : "réconcilier";
  const second = startWithReflexive ? "réconcilier" : "se réconcilier";
  test(`Gemini discovers both forms starting from ${first}`, async ({page}) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("carnet_de_verbes_settings_v1", JSON.stringify({geminiKey: "test-key"}));
    });
    const fixture = (infinitive, template) => ({
      ...template,
      infinitive,
      meaning: template.isReflexive ? "to make up" : "to reconcile",
      pastParticiple: "réconcilié",
      tenses: Object.fromEntries(Object.entries(template.tenses).map(([tense, forms]) =>
        [tense, forms.map(form => form.replaceAll("disput", "réconcili"))]))
    });
    const base = fixture("réconcilier", OFFLINE_DICTIONARY.disputer);
    const reflexive = fixture("se réconcilier", lookupOfflineVerb("se disputer").verb);
    const onlyReflexive = {
      ...OFFLINE_DICTIONARY["se souvenir"],
      infinitive: "s'enfuir",
      pastParticiple: "enfui",
      tenses: {
        ...OFFLINE_DICTIONARY["se souvenir"].tenses,
        passeCompose: OFFLINE_DICTIONARY["se souvenir"].tenses.passeCompose.map(form => form.replace("souvenu", "enfui"))
      }
    };
    let calls = 0;
    await page.route("https://generativelanguage.googleapis.com/**", async route => {
      calls++;
      const prompt = route.request().postDataJSON().contents[0].parts[0].text;
      const isOnlyReflexive = prompt.includes(`Analyze the user's input: "enfuir"`);
      const result = isOnlyReflexive ? {verb: onlyReflexive, counterpart: null} : {
        verb: startWithReflexive ? reflexive : base,
        counterpart: startWithReflexive ? base : reflexive
      };
      await route.fulfill({json: {candidates: [{content: {parts: [{
        text: JSON.stringify({isValidFrenchVerb: true, ...result})
      }]}}]}});
    });
    const input = page.getByRole("searchbox", {name: "French verb", exact: true});
    const add = async value => { await input.fill(value); await input.press("Enter"); };

    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
    await add(first);
    await expect(page.getByRole("heading", {name: first, exact: true})).toBeVisible();
    await expect(page.locator("#verb-count-label")).toHaveText("1 verb saved");
    expect(calls).toBe(1);
    await page.getByRole("textbox", {name: `Note for ${first}`}).fill("Keep my note");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
    await add(second);
    await expect(page.getByRole("heading", {name: second, exact: true})).toBeVisible();
    await expect(page.getByRole("textbox", {name: `Note for ${first}`})).toHaveValue("Keep my note");
    await expect(page.locator("#verb-count-label")).toHaveText("1 verb saved");
    expect(calls).toBe(1);

    await add("enfuir");
    const onlyCard = page.locator(`[data-card-inf="s'enfuir"]`);
    await expect(onlyCard.getByRole("heading", {name: "s'enfuir", exact: true})).toBeVisible();
    await expect(onlyCard.locator(".variant-switch")).toHaveCount(0);
    await expect(page.locator("#verb-count-label")).toHaveText("2 verbs saved");
    expect(calls).toBe(2);
  });
}

test("a Groq key saved in Settings backs up lookups for déranger, divorcer and s’inquiéter", async ({page}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("carnet_de_verbes_settings_v1", JSON.stringify({geminiKey: "mock-gemini"}));
  });
  function fixture(template, from, to, infinitive, meaning, pastParticiple) {
    return {
      infinitive, meaning, pastParticiple, auxiliary: template.auxiliary, isReflexive: template.isReflexive,
      tenses: Object.fromEntries(Object.entries(template.tenses).map(([tense, forms]) => [
        tense, forms.map(form => form.replaceAll(from, to).replace(/^je inqui/, "j'inqui"))
      ]))
    };
  }
  const deranger = fixture(OFFLINE_DICTIONARY.manger, "mang", "dérang", "déranger", "to disturb", "dérangé");
  const seDeranger = fixture(lookupOfflineVerb("se disputer").verb, "disput", "dérang", "se déranger", "to go out of one's way", "dérangé");
  seDeranger.tenses.present[3] = "nous nous dérangeons";
  seDeranger.tenses.imparfait = seDeranger.tenses.imparfait.map(form => form.replace("dérangai", "dérangeai"));
  const divorcer = fixture(OFFLINE_DICTIONARY.commencer, "commen", "divor", "divorcer", "to get divorced", "divorcé");
  const inquieter = fixture(OFFLINE_DICTIONARY.regarder, "regard", "inquiét", "inquiéter", "to worry someone", "inquiété");
  inquieter.tenses.present = ["j'inquiète", "tu inquiètes", "il/elle inquiète", "nous inquiétons", "vous inquiétez", "ils/elles inquiètent"];
  const responses = {
    "derange": {verb: deranger, counterpart: seDeranger},
    "divorcent": {verb: divorcer, counterpart: null},
    "s’inquiéter": {verb: lookupOfflineVerb("s'inquiéter").verb, counterpart: inquieter}
  };

  let geminiAttempts = 0;
  const groqInputs = [];
  await page.route("https://generativelanguage.googleapis.com/**", async route => {
    geminiAttempts++;
    expect(route.request().headers()["x-goog-api-key"]).toBe("mock-gemini");
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({status: 503, json: {error: {message: "High demand"}}});
  });
  await page.route("https://api.groq.com/openai/v1/chat/completions", async route => {
    const request = route.request();
    expect(request.headers().authorization).toBe("Bearer mock-groq");
    expect(request.headers()["x-goog-api-key"]).toBeUndefined();
    const {model, messages} = request.postDataJSON();
    expect(model).toBe("openai/gpt-oss-20b");
    const input = Object.keys(responses).find(value => messages[0].content.includes(`input: ${JSON.stringify(value)}`));
    if (input) groqInputs.push(input);
    const result = input ? {isValidFrenchVerb: true, ...responses[input]} : {ok: true};
    await route.fulfill({json: {choices: [{message: {content: JSON.stringify(result)}, finish_reason: "stop"}]}});
  });

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", {name: "Menu and settings"}).click();
  await page.getByLabel("Groq API key", {exact: true}).fill("mock-groq");
  await page.getByRole("button", {name: "Save Groq API key"}).click();
  await expect(page.locator("#drawer-groq-status")).toHaveText("Groq key verified and saved.");
  await page.getByRole("button", {name: "Close menu"}).click();

  const field = page.getByRole("searchbox", {name: "French verb", exact: true});
  for (const [input, infinitive, counterpart, present] of [
    ["derange", "déranger", "se déranger", "dérange"],
    ["divorcent", "divorcer", null, "divorce"],
    ["s’inquiéter", "s'inquiéter", "inquiéter", "m'inquiète"]
  ]) {
    await field.fill(input);
    await field.press("Enter");
    const card = page.locator(`[data-card-inf="${infinitive}"]`);
    await expect(card.getByRole("heading", {name: infinitive, exact: true})).toBeVisible();
    await expect(card.locator(".conj-verb").first()).toHaveText(present);
    await expect(page.locator("#status-msg-text")).toContainText("Lookup completed using Groq.");
    if (counterpart) await expect(card.getByRole("button", {name: counterpart, exact: true})).toBeVisible();
    else await expect(card.locator(".variant-switch")).toHaveCount(0);
  }
  expect(groqInputs).toEqual(["derange", "divorcent", "s’inquiéter"]);
  expect(geminiAttempts).toBe(9);
  await expect(page.locator("#verb-count-label")).toHaveText("3 verbs saved");
});

test("an invalid screenshot result falls back to Hydrogen before saving a card", async ({page}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("carnet_de_verbes_settings_v1", JSON.stringify({geminiKey: "test-key"}));
  });
  const models = [];
  await page.route("https://generativelanguage.googleapis.com/**", async route => {
    const model = route.request().url().match(/\/models\/([^:]+):generateContent$/)[1];
    models.push(model);
    const verb = structuredClone(OFFLINE_DICTIONARY.aller);
    if (models.length === 1) verb.tenses.passeCompose.pop();
    await route.fulfill({json: {candidates: [{content: {parts: [{text: JSON.stringify({
      entries: [{spottedForm: "vous êtes allé", verb}]
    })}]}}]}});
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", {name: "Add from screenshot"}).click();
  await page.locator("#screenshot-file-input").setInputFiles("assets/icon-192.png");
  await page.getByRole("button", {name: "Extract Verbs with AI"}).click();
  await expect(page.getByRole("heading", {name: "aller", exact: true})).toBeVisible();
  await expect(page.locator("#verb-count-label")).toHaveText("1 verb saved");
  expect(models).toEqual(["gemini-3.8-flash", "gemini-4-hydrogen"]);
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

test("recovery page updates worker and preserves saved notebook",async({page})=>{
 await page.goto("/");await expect(page.locator("html")).toHaveAttribute("data-ready","true");
 await page.getByRole("button",{name:"Load 3 Starter Verbs"}).click();
 const original=await page.evaluate(key=>localStorage.getItem(key),stateKey);
 await page.goto("/recover.html");
 await page.getByRole("button",{name:"Update and open notebook"}).click();
 await expect(page.locator("#verb-count-label")).toHaveText("3 verbs saved");
 expect(await page.evaluate(key=>localStorage.getItem(key),stateKey)).toBe(original);
});
