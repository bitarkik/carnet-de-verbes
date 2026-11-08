// ==========================================================================
// Validated Offline French Verb Engine (~75 Core Duolingo Verbs + Strict Check)
// ==========================================================================

const PRONOUNS = ["je", "tu", "il/elle", "nous", "vous", "ils/elles"];
const REFL_PRONOUNS = ["me", "te", "se", "nous", "vous", "se"];
const VOWEL_RE = /^[aeiouhàâéèêëîïôùûœ]/i;
const IMP_ENDINGS = ["ais", "ais", "ait", "ions", "iez", "aient"];
const FUT_ENDINGS = ["ai", "as", "a", "ons", "ez", "ont"];

// Dr. & Mrs. Vandertramp verbs that take être in Passé Composé
const ETRE_VERBS = new Set([
  "aller", "venir", "devenir", "revenir", "arriver", "partir", "sortir",
  "entrer", "rentrer", "monter", "descendre", "tomber", "rester",
  "naître", "mourir", "retourner", "passer"
]);

function formatPronounVerb(index, form, isReflexive, markIrreg = false) {
  const p = PRONOUNS[index];
  const suffix = markIrreg ? "*" : "";
  if (!isReflexive) {
    if (p === "je" && VOWEL_RE.test(form)) {
      return `j'${form}${suffix}`;
    }
    return `${p} ${form}${suffix}`;
  }
  const rp = REFL_PRONOUNS[index];
  const elide = (rp === "me" || rp === "te" || rp === "se") && VOWEL_RE.test(form);
  return elide ? `${p} ${rp[0]}'${form}${suffix}` : `${p} ${rp} ${form}${suffix}`;
}

function buildFromSpec(infinitive, spec) {
  let raw = infinitive.toLowerCase().trim();
  let isReflexive = false;
  let base = raw;
  if (raw.startsWith("se ")) {
    isReflexive = true;
    base = raw.slice(3);
  } else if (raw.startsWith("s'")) {
    isReflexive = true;
    base = raw.slice(2);
  }

  const aux = isReflexive || spec.aux === "être" || ETRE_VERBS.has(base) ? "être" : "avoir";
  const auxPres = aux === "être"
    ? ["suis", "es", "est", "sommes", "êtes", "sont"]
    : ["ai", "as", "a", "avons", "avez", "ont"];

  let presForms = spec.pres;
  let impStem = spec.impStem;
  let futStem = spec.futStem;
  let pp = spec.pp;
  let group = spec.group;
  let isIrregular = !!spec.irreg;
  let irregPresMask = spec.presMark || [false, false, false, false, false, false];
  let irregFut = !!spec.futMark;

  if (!presForms) {
    if (base.endsWith("er")) {
      const stem = base.slice(0, -2);
      let nousStem = stem;
      if (stem.endsWith("g")) nousStem = stem + "e";
      else if (stem.endsWith("c")) nousStem = stem.slice(0, -1) + "ç";
      presForms = [stem + "e", stem + "es", stem + "e", nousStem + "ons", stem + "ez", stem + "ent"];
      irregPresMask = [false, false, false, nousStem !== stem, false, false];
      impStem = nousStem;
      futStem = base;
      pp = stem + "é";
      group = group || (isReflexive ? "Reflexive -er (1st group)" : "Regular -er (1st group)");
    } else if (base.endsWith("ir")) {
      const stem = base.slice(0, -2);
      presForms = [stem + "is", stem + "is", stem + "it", stem + "issons", stem + "issez", stem + "issent"];
      irregPresMask = [false, false, false, true, true, true];
      impStem = stem + "iss";
      futStem = base;
      pp = stem + "i";
      group = group || "Regular -ir (2nd group)";
    } else if (base.endsWith("re")) {
      const stem = base.slice(0, -2);
      presForms = [stem + "s", stem + "s", stem, stem + "ons", stem + "ez", stem + "ent"];
      impStem = stem;
      futStem = base.slice(0, -1);
      pp = stem + "u";
      group = group || "Regular -re (3rd group)";
    }
  }

  // Impersonal verbs (falloir, pleuvoir)
  if (spec.impersonal) {
    return {
      infinitive: raw,
      meaning: spec.m,
      group: spec.group || "Impersonal Irregular",
      isIrregular: true,
      isReflexive: false,
      auxiliary: "avoir",
      pastParticiple: pp,
      duolingoContext: { fr: spec.ex[0], en: spec.ex[1] },
      duolingoTips: {
        auxiliaryNote: spec.tipAux || `Impersonal verb: only conjugates with 'il' (il a ${pp}).`,
        preposition: spec.tipPrep || "Followed directly by an infinitive or 'que' + Subjonctif.",
        homophone: spec.tipHomo || "Spoken smoothly as a two-syllable impersonal expression.",
        extra: spec.tipExtra || "Never used with je, tu, nous, vous, or ils."
      },
      tenses: {
        present: ["—", "—", `il ${presForms[2]}*`, "—", "—", "—"],
        passeCompose: ["—", "—", `il a ${pp}*`, "—", "—", "—"],
        imparfait: ["—", "—", `il ${impStem}ait*`, "—", "—", "—"],
        futur: ["—", "—", `il ${futStem}a*`, "—", "—", "—"],
        conditionnel: ["—", "—", `il ${futStem}ait*`, "—", "—", "—"]
      },
      examples: [
        { fr: spec.ex[0], en: spec.ex[1] },
        { fr: spec.ex2 ? spec.ex2[0] : `Il ${futStem}ait le faire bientôt.`, en: spec.ex2 ? spec.ex2[1] : "Conditional everyday usage." }
      ],
      quiz: spec.quiz || {
        tense: "Présent",
        sentence: `Il ____ (${raw}) faire attention.`,
        en: `Practice impersonal '${raw}'.`,
        answer: presForms[2],
        altAnswers: [`il ${presForms[2]}`],
        explanation: `${raw} only conjugates with 'il': il ${presForms[2]}.`
      }
    };
  }

  const present = presForms.map((f, i) => formatPronounVerb(i, f, isReflexive, isIrregular || irregPresMask[i]));
  const imparfait = IMP_ENDINGS.map((end, i) => formatPronounVerb(i, impStem + end, isReflexive, false));
  const futur = FUT_ENDINGS.map((end, i) => formatPronounVerb(i, futStem + end, isReflexive, irregFut));
  const conditionnel = IMP_ENDINGS.map((end, i) => formatPronounVerb(i, futStem + end, isReflexive, irregFut));

  const agreeSuffix = aux === "être"
    ? ["(e)", "(e)", "(e)", "(e)s", "(e)(s)", "(e)s"]
    : ["", "", "", "", "", ""];

  const passeCompose = auxPres.map((af, i) => {
    const left = formatPronounVerb(i, af, isReflexive, false);
    const mark = (aux === "être" || isIrregular) ? "*" : "";
    return `${left} ${pp}${agreeSuffix[i]}${mark}`;
  });

  const defaultQuizForm = presForms[3]; // nous form in présent
  const cleanNous = formatPronounVerb(3, defaultQuizForm, isReflexive, false).replace(/^nous\s+/, "");

  return {
    infinitive: raw,
    meaning: spec.m,
    group: group || (isIrregular ? "3rd group · Irregular" : "Regular"),
    isIrregular,
    isReflexive,
    auxiliary: aux,
    pastParticiple: pp,
    duolingoContext: { fr: spec.ex[0], en: spec.ex[1] },
    duolingoTips: {
      auxiliaryNote: spec.tipAux || (aux === "être"
        ? `Uses être in Passé Composé! Add -e (feminine) and -s (plural) to ${pp}.`
        : `Uses avoir in Passé Composé with past participle '${pp}' (j'ai ${pp}).`),
      preposition: spec.tipPrep || "Takes a direct object or check context for à / de before an infinitive.",
      homophone: spec.tipHomo || (base.endsWith("er")
        ? `je -e, tu -es, il -e, and ils -ent all sound 100% identical out loud!`
        : `Singular endings (-s, -t, -d) are silent in spoken French.`),
      extra: spec.tipExtra || (isReflexive
        ? `Reflexive verb: keep the reflexive pronoun (me, te, se, nous, vous, se) in every tense.`
        : `Imparfait stem comes from nous (${impStem}-); future stem is ${futStem}-.`)
    },
    tenses: { present, passeCompose, imparfait, futur, conditionnel },
    examples: [
      { fr: spec.ex[0], en: spec.ex[1] },
      spec.ex2
        ? { fr: spec.ex2[0], en: spec.ex2[1] }
        : { fr: `Hier, ${passeCompose[3].replace(/\*/g, "").replace(/\(e\)/g, "")}.`, en: `Past tense example (${raw}).` }
    ],
    quiz: spec.quiz || {
      tense: "Présent",
      sentence: `Aujourd'hui, nous ____ (${raw}) ensemble.`,
      en: `Conjugate '${raw}' (${spec.m}) for 'nous' in Présent.`,
      answer: cleanNous,
      altAnswers: [`nous ${cleanNous}`],
      explanation: `In Présent, '${raw}' with 'nous' is 'nous ${cleanNous}'.`
    }
  };
}

// Curated specs for ~75 high-frequency Duolingo French verbs
const SPECS = {
  // Core Irregulars
  "être": {
    m: "to be", irreg: true, group: "Irregular Auxiliary", pp: "été",
    pres: ["suis", "es", "est", "sommes", "êtes", "sont"], impStem: "ét", futStem: "ser", futMark: true,
    tipAux: "Surprisingly uses avoir in Passé Composé: j'ai été (I was / have been)!",
    tipPrep: "être à + person = to belong to (Ce livre est à moi).",
    tipHomo: "tu es and il est both sound like /ɛ/ in everyday French.",
    tipExtra: "Only French verb with an irregular Imparfait stem: ét- (j'étais).",
    ex: ["Nous sommes prêts pour la leçon.", "We are ready for the lesson."],
    ex2: ["J'étais très fatigué hier soir.", "I was very tired last night."]
  },
  "avoir": {
    m: "to have", irreg: true, group: "Irregular Auxiliary", pp: "eu",
    pres: ["ai", "as", "a", "avons", "avez", "ont"], impStem: "av", futStem: "aur", futMark: true,
    tipAux: "Uses avoir + tiny past participle eu — pronounced /y/ (like French 'u')!",
    tipPrep: "avoir besoin de (need) · avoir envie de (feel like) · avoir peur de (be afraid of).",
    tipHomo: "tu as and il a both sound like /a/; ils ont (/ilzɔ̃/) vs. ils sont (/ilsɔ̃/) — listen for the z/s!",
    tipExtra: "Used for age, hunger, thirst, and heat/cold in French: j'ai faim, j'ai vingt ans!",
    ex: ["J'ai deux chats et un chien.", "I have two cats and a dog."],
    ex2: ["Est-ce que tu as eu le temps ?", "Did you have time?"]
  },
  "aller": {
    m: "to go", irreg: true, aux: "être", group: "Irregular (3rd group)", pp: "allé",
    pres: ["vais", "vas", "va", "allons", "allez", "vont"], impStem: "all", futStem: "ir", futMark: true,
    tipPrep: "aller à + place (au / à la / aux) · aller chez + person/business.",
    tipHomo: "tu vas and il va sound identical (/va/).",
    tipExtra: "aller + infinitive builds Futur Proche: Je vais étudier = I'm going to study.",
    ex: ["Nous allons au supermarché ce soir.", "We are going to the supermarket tonight."],
    ex2: ["Elle est allée à Lyon le mois dernier.", "She went to Lyon last month."]
  },
  "faire": {
    m: "to do / to make", irreg: true, pp: "fait",
    pres: ["fais", "fais", "fait", "faisons", "faites", "font"], impStem: "fais", futStem: "fer", futMark: true,
    tipPrep: "faire du / de la + sport or activity (faire du vélo, faire la cuisine).",
    tipHomo: "faisons is pronounced /fəzɔ̃/ (like 'feuzon'), NOT 'fai-zons'! And vous faites (not faisez).",
    tipExtra: "Also used for weather: Il fait beau (It's nice out), Il fait froid (It's cold).",
    ex: ["Qu'est-ce que vous faites ce week-end ?", "What are you doing this weekend?"],
    ex2: ["Il fait très beau aujourd'hui.", "The weather is very nice today."]
  },
  "pouvoir": {
    m: "can / to be able to", irreg: true, group: "Irregular -oir", pp: "pu",
    pres: ["peux", "peux", "peut", "pouvons", "pouvez", "peuvent"], impStem: "pouv", futStem: "pourr", futMark: true,
    tipPrep: "Followed directly by an infinitive with NO preposition: Je peux venir.",
    tipHomo: "peux and peut sound identical (/pø/).",
    tipExtra: "In polite questions with inversion, je peux becomes puis-je (Puis-je vous aider ?).",
    ex: ["Tu peux m'aider une minute ?", "Can you help me for a minute?"],
    ex2: ["Je pourrais avoir l'addition, s'il vous plaît ?", "Could I have the check, please?"]
  },
  "vouloir": {
    m: "to want", irreg: true, group: "Irregular -oir", pp: "voulu",
    pres: ["veux", "veux", "veut", "voulons", "voulez", "veulent"], impStem: "voul", futStem: "voudr", futMark: true,
    tipPrep: "Direct infinitive (Je veux partir) — no 'à' or 'de'!",
    tipHomo: "veux and veut sound identical (/vø/).",
    tipExtra: "Use Conditionnel 'je voudrais' ('I would like') when ordering politely instead of 'je veux'!",
    ex: ["Je voudrais un café et un croissant.", "I would like a coffee and a croissant."],
    ex2: ["Ils veulent apprendre le français.", "They want to learn French."]
  },
  "devoir": {
    m: "must / to have to / to owe", irreg: true, group: "Irregular -oir", pp: "dû",
    pres: ["dois", "dois", "doit", "devons", "devez", "doivent"], impStem: "dev", futStem: "devr", futMark: true,
    tipAux: "Past participle dû keeps a circumflex accent (masculine singular) to distinguish it from 'du'!",
    tipPrep: "Direct infinitive with no preposition: Je dois travailler.",
    tipExtra: "In Conditionnel (je devrais, tu devrais), devoir means 'should'!",
    ex: ["Je dois partir avant huit heures.", "I have to leave before eight o'clock."],
    ex2: ["Tu devrais te reposer un peu.", "You should rest a bit."]
  },
  "savoir": {
    m: "to know (a fact / how to)", irreg: true, group: "Irregular -oir", pp: "su",
    pres: ["sais", "sais", "sait", "savons", "savez", "savent"], impStem: "sav", futStem: "saur", futMark: true,
    tipPrep: "savoir + infinitive = to know HOW to do something (Je sais nager — never add 'comment'!).",
    tipHomo: "je sais, tu sais, il sait all sound like /sɛ/.",
    tipExtra: "Savoir = facts & skills; Connaître = people & places!",
    ex: ["Elle sait très bien cuisiner.", "She knows how to cook very well."],
    ex2: ["Je ne sais pas où sont mes clés.", "I don't know where my keys are."]
  },
  "connaître": {
    m: "to know (a person or place)", irreg: true, group: "Irregular -re", pp: "connu",
    pres: ["connais", "connais", "connaît", "connaissons", "connaissez", "connaissent"], impStem: "connaiss", futStem: "connaîtr", futMark: true,
    tipPrep: "Always takes a noun directly (connaître Paris, connaître Marie) — never followed by a verb or 'que'!",
    ex: ["Tu connais un bon restaurant ici ?", "Do you know a good restaurant here?"]
  },
  "prendre": {
    m: "to take (also 'to have' food/drink)", irreg: true, group: "Irregular -re", pp: "pris",
    pres: ["prends", "prends", "prend", "prenons", "prenez", "prennent"], impStem: "pren", futStem: "prendr",
    tipPrep: "prendre le train/bus (transport) · prendre un café / le petit-déjeuner (food & drink).",
    tipExtra: "Never say 'j'ai un café' when ordering — French always uses 'je prends'!",
    ex: ["Nous avons pris le métro ce matin.", "We took the subway this morning."]
  },
  "apprendre": {
    m: "to learn", irreg: true, group: "Irregular -re (prendre family)", pp: "appris",
    pres: ["apprends", "apprends", "apprend", "apprenons", "apprenez", "apprennent"], impStem: "appren", futStem: "apprendr",
    tipPrep: "Takes À before a verb: apprendre à parler français.",
    ex: ["J'apprends à parler français tous les jours.", "I learn to speak French every day."]
  },
  "comprendre": {
    m: "to understand", irreg: true, group: "Irregular -re (prendre family)", pp: "compris",
    pres: ["comprends", "comprends", "comprend", "comprenons", "comprenez", "comprennent"], impStem: "compren", futStem: "comprendr",
    ex: ["Est-ce que vous comprenez la question ?", "Do you understand the question?"]
  },
  "boire": {
    m: "to drink", irreg: true, group: "Irregular -re", pp: "bu",
    pres: ["bois", "bois", "boit", "buvons", "buvez", "boivent"], impStem: "buv", futStem: "boir",
    tipPrep: "boire du / de la / de l' (partitive) or boire un verre de...",
    tipExtra: "Watch the 3 stems in Présent: boi- (singular), buv- (nous/vous), boiv- (ils/elles).",
    ex: ["Nous buvons du thé vert le matin.", "We drink green tea in the morning."]
  },
  "voir": {
    m: "to see", irreg: true, group: "Irregular -oir", pp: "vu",
    pres: ["vois", "vois", "voit", "voyons", "voyez", "voient"], impStem: "voy", futStem: "verr", futMark: true,
    tipExtra: "Double 'r' in Future & Conditional: je verrai, nous verrons!",
    ex: ["On se voit demain soir ?", "Shall we see each other tomorrow evening?"]
  },
  "venir": {
    m: "to come", irreg: true, aux: "être", group: "Irregular -ir", pp: "venu",
    pres: ["viens", "viens", "vient", "venons", "venez", "viennent"], impStem: "ven", futStem: "viendr", futMark: true,
    tipPrep: "venir de + place (from) · venir de + verb = 'to have JUST done' (Je viens de finir)!",
    ex: ["Je viens de terminer ma leçon.", "I just finished my lesson."]
  },
  "devenir": {
    m: "to become", irreg: true, aux: "être", group: "Irregular -ir (venir family)", pp: "devenu",
    pres: ["deviens", "deviens", "devient", "devenons", "devenez", "deviennent"], impStem: "deven", futStem: "deviendr", futMark: true,
    ex: ["C'est devenu beaucoup plus facile.", "It became much easier."]
  },
  "revenir": {
    m: "to come back", irreg: true, aux: "être", group: "Irregular -ir (venir family)", pp: "revenu",
    pres: ["reviens", "reviens", "revient", "revenons", "revenez", "reviennent"], impStem: "reven", futStem: "reviendr", futMark: true,
    ex: ["Je reviens dans cinq minutes.", "I'll be back in five minutes."]
  },
  "se souvenir": {
    m: "to remember", irreg: true, aux: "être", group: "Reflexive Irregular -ir", pp: "souvenu",
    pres: ["souviens", "souviens", "souvient", "souvenons", "souvenez", "souviennent"], impStem: "souven", futStem: "souviendr", futMark: true,
    tipPrep: "Always takes DE: se souvenir de quelque chose / quelqu'un!",
    ex: ["Je me souviens très bien de ce voyage.", "I remember that trip very well."]
  },
  "tenir": {
    m: "to hold", irreg: true, group: "Irregular -ir (venir family)", pp: "tenu",
    pres: ["tiens", "tiens", "tient", "tenons", "tenez", "tiennent"], impStem: "ten", futStem: "tiendr", futMark: true,
    tipPrep: "tenir à + noun/verb = to care deeply about / insist on.",
    ex: ["Tiens, voilà ton café !", "Here, here's your coffee!"]
  },
  // Tricky 3rd-group -ir verbs (NOT -issons!)
  "dormir": {
    m: "to sleep", irreg: true, group: "3rd group -ir (NOT -issons!)", pp: "dormi",
    pres: ["dors", "dors", "dort", "dormons", "dormez", "dorment"], impStem: "dorm", futStem: "dormir",
    tipExtra: "Trap alert: NO '-iss-'! Drops 'm' in singular (je dors) and keeps 'm' in plural (nous dormons).",
    ex: ["Tu as bien dormi cette nuit ?", "Did you sleep well last night?"]
  },
  "partir": {
    m: "to leave / depart", irreg: true, aux: "être", group: "3rd group -ir", pp: "parti",
    pres: ["pars", "pars", "part", "partons", "partez", "partent"], impStem: "part", futStem: "partir",
    tipPrep: "partir pour + destination (leave for) · partir en vacances.",
    ex: ["Le train part dans dix minutes.", "The train leaves in ten minutes."]
  },
  "sortir": {
    m: "to go out / exit", irreg: true, aux: "être", group: "3rd group -ir", pp: "sorti",
    pres: ["sors", "sors", "sort", "sortons", "sortez", "sortent"], impStem: "sort", futStem: "sortir",
    tipAux: "Uses être when going out (je suis sorti), but avoir if taking an object out (j'ai sorti le chien)!",
    ex: ["On sort dîner vendredi soir ?", "Shall we go out for dinner Friday night?"]
  },
  "sentir": {
    m: "to feel / to smell", irreg: true, group: "3rd group -ir", pp: "senti",
    pres: ["sens", "sens", "sent", "sentons", "sentez", "sentent"], impStem: "sent", futStem: "sentir",
    ex: ["Ça sent vraiment bon dans la cuisine !", "It smells really good in the kitchen!"]
  },
  "servir": {
    m: "to serve", irreg: true, group: "3rd group -ir", pp: "servi",
    pres: ["sers", "sers", "sert", "servons", "servez", "servent"], impStem: "serv", futStem: "servir",
    ex: ["Le petit-déjeuner est servi jusqu'à dix heures.", "Breakfast is served until 10 AM."]
  },
  "ouvrir": {
    m: "to open", irreg: true, group: "3rd group -ir (-er endings!)", pp: "ouvert",
    pres: ["ouvre", "ouvres", "ouvre", "ouvrons", "ouvrez", "ouvrent"], impStem: "ouvr", futStem: "ouvrir",
    tipExtra: "Ends in -ir, but conjugates just like an -er verb in Présent (j'ouvre, tu ouvres) + past participle ouvert!",
    ex: ["Le magasin ouvre à neuf heures.", "The shop opens at nine o'clock."]
  },
  "offrir": {
    m: "to offer / give (a gift)", irreg: true, group: "3rd group -ir (-er endings!)", pp: "offert",
    pres: ["offre", "offres", "offre", "offrons", "offrez", "offrent"], impStem: "offr", futStem: "offrir",
    tipExtra: "Conjugates like ouvrir: j'offre (present) and j'ai offert (past participle).",
    ex: ["Elle m'a offert un beau livre.", "She gave me a lovely book."]
  },
  "courir": {
    m: "to run", irreg: true, group: "Irregular -ir", pp: "couru",
    pres: ["cours", "cours", "court", "courons", "courez", "courent"], impStem: "cour", futStem: "courr", futMark: true,
    tipExtra: "Double 'r' in Future/Conditional (je courrai) and past participle couru!",
    ex: ["Je cours dans le parc tous les matins.", "I run in the park every morning."]
  },
  "mourir": {
    m: "to die", irreg: true, aux: "être", group: "Irregular -ir", pp: "mort",
    pres: ["meurs", "meurs", "meurt", "mourons", "mourez", "meurent"], impStem: "mour", futStem: "mourr", futMark: true,
    ex: ["Je meurs de faim !", "I'm starving (dying of hunger)!"]
  },
  // More Essential Irregulars
  "mettre": {
    m: "to put / to put on (clothes)", irreg: true, group: "Irregular -re", pp: "mis",
    pres: ["mets", "mets", "met", "mettons", "mettez", "mettent"], impStem: "mett", futStem: "mettr",
    tipExtra: "Single 't' in singular (je mets, il met), double 'tt' in plural (nous mettons).",
    ex: ["Mets ton manteau, il fait froid.", "Put on your coat, it's cold."]
  },
  "promettre": {
    m: "to promise", irreg: true, group: "Irregular -re (mettre family)", pp: "promis",
    pres: ["promets", "promets", "promet", "promettons", "promettez", "promettent"], impStem: "promett", futStem: "promettr",
    tipPrep: "promettre de + infinitive (Je promets de venir).",
    ex: ["Je te promets d'être à l'heure.", "I promise you to be on time."]
  },
  "dire": {
    m: "to say / to tell", irreg: true, group: "Irregular -re", pp: "dit",
    pres: ["dis", "dis", "dit", "disons", "dites", "disent"], impStem: "dis", futStem: "dir",
    tipPrep: "dire à qqn de faire qqch (tell someone to do something).",
    tipExtra: "Watch out for 'vous dites' (NOT 'disez' — just like vous faites)!",
    ex: ["Comment dit-on cela en français ?", "How do you say that in French?"]
  },
  "lire": {
    m: "to read", irreg: true, group: "Irregular -re", pp: "lu",
    pres: ["lis", "lis", "lit", "lisons", "lisez", "lisent"], impStem: "lis", futStem: "lir",
    ex: ["Je lis un roman français avant de dormir.", "I read a French novel before sleeping."]
  },
  "écrire": {
    m: "to write", irreg: true, group: "Irregular -re", pp: "écrit",
    pres: ["écris", "écris", "écrit", "écrivons", "écrivez", "écrivent"], impStem: "écriv", futStem: "écrir",
    tipExtra: "Adds a 'v' in plural forms: nous écrivons, vous écrivez, ils écrivent.",
    ex: ["J'écris les nouveaux verbes dans mon carnet.", "I write new verbs in my notebook."]
  },
  "croire": {
    m: "to believe / think", irreg: true, group: "Irregular -re", pp: "cru",
    pres: ["crois", "crois", "croit", "croyons", "croyez", "croient"], impStem: "croy", futStem: "croir",
    ex: ["Je crois qu'il va pleuvoir.", "I think it's going to rain."]
  },
  "suivre": {
    m: "to follow / to take (a course)", irreg: true, group: "Irregular -re", pp: "suivi",
    pres: ["suis", "suis", "suit", "suivons", "suivez", "suivent"], impStem: "suiv", futStem: "suivr",
    tipHomo: "'je suis' means BOTH 'I am' (être) AND 'I follow' (suivre) — context tells them apart!",
    ex: ["Je suis un cours de français en ligne.", "I am taking an online French course."]
  },
  "vivre": {
    m: "to live (be alive / experience)", irreg: true, group: "Irregular -re", pp: "vécu",
    pres: ["vis", "vis", "vit", "vivons", "vivez", "vivent"], impStem: "viv", futStem: "vivr",
    ex: ["Elle a vécu trois ans à Montréal.", "She lived in Montreal for three years."]
  },
  "rire": {
    m: "to laugh", irreg: true, group: "Irregular -re", pp: "ri",
    pres: ["ris", "ris", "rit", "rions", "riez", "rient"], impStem: "ri", futStem: "rir",
    ex: ["Ce film nous a fait beaucoup rire.", "That movie made us laugh a lot."]
  },
  "recevoir": {
    m: "to receive", irreg: true, group: "Irregular -oir", pp: "reçu",
    pres: ["reçois", "reçois", "reçoit", "recevons", "recevez", "reçoivent"], impStem: "recev", futStem: "recevr", futMark: true,
    ex: ["J'ai reçu ton message ce matin.", "I received your message this morning."]
  },
  "s'asseoir": {
    m: "to sit down", irreg: true, aux: "être", group: "Reflexive Irregular -oir", pp: "assis",
    pres: ["assieds", "assieds", "assied", "asseyons", "asseyez", "asseyent"], impStem: "assey", futStem: "assiér", futMark: true,
    ex: ["Asseyez-vous, je vous en prie.", "Have a seat, please."]
  },
  "falloir": {
    m: "to be necessary / must ('il faut')", impersonal: true, pp: "fallu",
    pres: ["", "", "faut", "", "", ""], impStem: "fall", futStem: "faudr",
    tipPrep: "il faut + infinitive (Il faut partir) OR il faut que + Subjonctif.",
    tipExtra: "'Il faudrait' (Conditionnel) softens 'must' into a polite 'we should / ought to'.",
    ex: ["Il faut réserver une table à l'avance.", "You have to book a table in advance."],
    ex2: ["Il faudrait partir bientôt.", "We ought to leave soon."]
  },
  "pleuvoir": {
    m: "to rain ('il pleut')", impersonal: true, pp: "plu",
    pres: ["", "", "pleut", "", "", ""], impStem: "pleuv", futStem: "pleuvr",
    ex: ["Il pleut beaucoup cet automne.", "It is raining a lot this autumn."],
    ex2: ["Il a plu toute la nuit.", "It rained all night."]
  },
  // Stem-changing -er & Reflexive Duolingo Favorites
  "lever": {
    m: "to lift / to raise", irreg: false, group: "Stem-changing -er", pp: "levé",
    pres: ["lève", "lèves", "lève", "levons", "levez", "lèvent"],
    presMark: [true, true, true, false, false, true], impStem: "lev", futStem: "lèver", futMark: true,
    ex: ["Lève la main si tu as une question.", "Raise your hand if you have a question."]
  },
  "se lever": {
    m: "to get up / stand up", irreg: false, aux: "être", group: "Reflexive stem-changing -er", pp: "levé",
    pres: ["lève", "lèves", "lève", "levons", "levez", "lèvent"],
    presMark: [true, true, true, false, false, true], impStem: "lev", futStem: "lèver", futMark: true,
    ex: ["Je me lève à sept heures tous les jours.", "I get up at seven o'clock every day."]
  },
  "acheter": {
    m: "to buy", irreg: false, group: "Stem-changing -er", pp: "acheté",
    pres: ["achète", "achètes", "achète", "achetons", "achetez", "achètent"],
    presMark: [true, true, true, false, false, true], impStem: "achet", futStem: "achèter", futMark: true,
    ex: ["Nous achetons du pain frais à la boulangerie.", "We buy fresh bread at the bakery."]
  },
  "appeler": {
    m: "to call", irreg: false, group: "Stem-changing -er (ll)", pp: "appelé",
    pres: ["appelle", "appelles", "appelle", "appelons", "appelez", "appellent"],
    presMark: [true, true, true, false, false, true], impStem: "appel", futStem: "appeller", futMark: true,
    ex: ["Je t'appelle dès que j'arrive.", "I'll call you as soon as I arrive."]
  },
  "s'appeler": {
    m: "to be named / called", irreg: false, aux: "être", group: "Reflexive stem-changing -er", pp: "appelé",
    pres: ["appelle", "appelles", "appelle", "appelons", "appelez", "appellent"],
    presMark: [true, true, true, false, false, true], impStem: "appel", futStem: "appeller", futMark: true,
    ex: ["Comment vous appelez-vous ?", "What is your name?"]
  },
  "rappeler": {
    m: "to call back / remind", irreg: false, group: "Stem-changing -er", pp: "rappelé",
    pres: ["rappelle", "rappelles", "rappelle", "rappelons", "rappelez", "rappellent"],
    presMark: [true, true, true, false, false, true], impStem: "rappel", futStem: "rappeller", futMark: true,
    tipExtra: "With 'se' (se rappeler), it means 'to remember' and takes NO 'de': Je me rappelle son nom!",
    ex: ["Je vous rappelle cet après-midi.", "I'll call you back this afternoon."]
  },
  "préférer": {
    m: "to prefer", irreg: false, group: "Stem-changing -er (é → è)", pp: "préféré",
    pres: ["préfère", "préfères", "préfère", "préférons", "préférez", "préfèrent"],
    presMark: [true, true, true, false, false, true], impStem: "préfér", futStem: "préférer",
    ex: ["Je préfère le thé au café.", "I prefer tea to coffee."]
  },
  "espérer": {
    m: "to hope", irreg: false, group: "Stem-changing -er (é → è)", pp: "espéré",
    pres: ["espère", "espères", "espère", "espérons", "espérez", "espèrent"],
    presMark: [true, true, true, false, false, true], impStem: "espér", futStem: "espérer",
    ex: ["J'espère que tout va bien !", "I hope everything is going well!"]
  },
  "essayer": {
    m: "to try / to try on", irreg: false, group: "Stem-changing -ayer", pp: "essayé",
    pres: ["essaie", "essaies", "essaie", "essayons", "essayez", "essaient"],
    presMark: [true, true, true, false, false, true], impStem: "essay", futStem: "essaier", futMark: true,
    tipPrep: "essayer DE + infinitive (J'essaie de comprendre).",
    ex: ["J'essaie de pratiquer un peu chaque soir.", "I try to practice a bit each evening."]
  },
  "payer": {
    m: "to pay (for)", irreg: false, group: "Stem-changing -ayer", pp: "payé",
    pres: ["paie", "paies", "paie", "payons", "payez", "paient"],
    presMark: [true, true, true, false, false, true], impStem: "pay", futStem: "paier", futMark: true,
    tipPrep: "No 'pour' needed! 'Je paie le café' already means 'I pay FOR the coffee'.",
    ex: ["On peut payer par carte ici ?", "Can we pay by card here?"]
  },
  "se coucher": {
    m: "to go to bed", ex: ["Je me couche vers minuit.", "I go to bed around midnight."]
  },
  "s'habiller": {
    m: "to get dressed", ex: ["Les enfants s'habillent vite.", "The kids get dressed quickly."]
  },
  "se réveiller": {
    m: "to wake up", ex: ["Elle se réveille sans réveil.", "She wakes up without an alarm."]
  },
  // High-Frequency Regular -er, -ir, -re Verbs
  "parler": { m: "to speak / talk", tipPrep: "parler à qqn (to someone) · parler de qqch (about something).", ex: ["Vous parlez très bien français !", "You speak French very well!"] },
  "manger": { m: "to eat", tipExtra: "Spelling rule: keeps 'e' in nous mangeons so the 'g' stays soft!", ex: ["Nous mangeons ensemble à midi.", "We eat together at noon."] },
  "commencer": { m: "to start / begin", tipPrep: "commencer à + verb (Il commence à neiger).", tipExtra: "Spelling rule: 'c' becomes 'ç' in nous commençons!", ex: ["Le film commence à vingt heures.", "The movie starts at 8 PM."] },
  "voyager": { m: "to travel", tipExtra: "Keeps 'e' in nous voyageons so the 'g' stays soft.", ex: ["Nous voyageons souvent en train.", "We often travel by train."] },
  "aimer": { m: "to like / to love", tipExtra: "Alone with a person = love (Je t'aime); with bien = like (J'aime bien Paul)!", ex: ["J'aime écouter de la musique française.", "I like listening to French music."] },
  "adorer": { m: "to love / adore", ex: ["Elle adore le chocolat noir.", "She loves dark chocolate."] },
  "détester": { m: "to hate", ex: ["Il déteste être en retard.", "He hates being late."] },
  "habiter": { m: "to live (reside in)", tipPrep: "habiter à + city · habiter en/au + country.", ex: ["J'habite dans un quartier calme.", "I live in a quiet neighborhood."] },
  "travailler": { m: "to work", ex: ["Elle travaille de la maison le vendredi.", "She works from home on Fridays."] },
  "étudier": { m: "to study", ex: ["Nous étudions la grammaire française.", "We are studying French grammar."] },
  "chercher": { m: "to look for", tipPrep: "No 'pour'! 'Je cherche mes clés' = I'm looking FOR my keys.", ex: ["Qu'est-ce que tu cherches ?", "What are you looking for?"] },
  "penser": { m: "to think", tipPrep: "penser À (think about/have in mind) vs. penser DE (have an opinion about)!", ex: ["Qu'est-ce que tu penses de ce film ?", "What do you think of this movie?"] },
  "jouer": { m: "to play", tipPrep: "jouer À + sport/game (jouer au foot) vs. jouer DE + instrument (jouer du piano)!", ex: ["Il joue de la guitare depuis cinq ans.", "He has played guitar for five years."] },
  "regarder": { m: "to watch / look at", tipPrep: "No 'at'! 'Regarde la photo' = Look AT the photo.", ex: ["Nous regardons une série française.", "We are watching a French series."] },
  "écouter": { m: "to listen to", tipPrep: "No 'à'! 'J'écoute un podcast' = I listen TO a podcast.", ex: ["J'écoute la radio dans la voiture.", "I listen to the radio in the car."] },
  "marcher": { m: "to walk / to work (function)", tipExtra: "'Ça marche !' is super common in French for 'That works / Sounds good!'", ex: ["Nous marchons le long de la rivière.", "We walk along the river."] },
  "cuisiner": { m: "to cook", ex: ["J'aime cuisiner pour mes amis.", "I love cooking for my friends."] },
  "demander": { m: "to ask (for)", tipPrep: "demander À qqn DE faire qqch.", ex: ["Je vais demander l'addition.", "I'm going to ask for the bill."] },
  "donner": { m: "to give", ex: ["Peux-tu me donner un coup de main ?", "Can you give me a hand?"] },
  "trouver": { m: "to find", ex: ["J'ai enfin trouvé mon passeport !", "I finally found my passport!"] },
  "aider": { m: "to help", tipPrep: "aider qqn À faire qqch (Elle m'aide à réviser).", ex: ["Merci de m'avoir aidé !", "Thank you for helping me!"] },
  "oublier": { m: "to forget", tipPrep: "oublier DE + verb (N'oublie pas d'appeler).", ex: ["J'ai oublié mon parapluie.", "I forgot my umbrella."] },
  "arriver": { m: "to arrive / to happen", aux: "être", tipPrep: "arriver à + verb = to manage to do something!", ex: ["Nous sommes arrivés à l'heure.", "We arrived on time."] },
  "rester": { m: "to stay", aux: "être", tipExtra: "False friend: rester means TO STAY, never 'to rest' (that's se reposer)!", ex: ["On est restés à la maison dimanche.", "We stayed home on Sunday."] },
  "entrer": { m: "to enter", aux: "être", ex: ["Elle est entrée dans la salle.", "She entered the room."] },
  "rentrer": { m: "to return home", aux: "être", ex: ["À quelle heure tu rentres ce soir ?", "What time are you coming home tonight?"] },
  "monter": { m: "to go up / get on", aux: "être", ex: ["Nous sommes montés au dernier étage.", "We went up to the top floor."] },
  "descendre": { m: "to go down / get off", aux: "être", ex: ["Je descends à la prochaine station.", "I get off at the next station."] },
  "tomber": { m: "to fall", aux: "être", ex: ["La neige est tombée toute la matinée.", "Snow fell all morning."] },
  "finir": { m: "to finish", tipPrep: "finir DE + verb (J'ai fini de lire).", ex: ["Ils finissent leurs devoirs avant le dîner.", "They finish their homework before dinner."] },
  "choisir": { m: "to choose", tipPrep: "choisir DE + verb.", ex: ["Elle a choisi la table près de la fenêtre.", "She chose the table by the window."] },
  "réussir": { m: "to succeed / pass (an exam)", tipPrep: "réussir un examen (no 'à'!) · réussir À faire qqch.", ex: ["Il a réussi son examen de français !", "He passed his French exam!"] },
  "remplir": { m: "to fill (out)", ex: ["Veuillez remplir ce formulaire.", "Please fill out this form."] },
  "attendre": { m: "to wait (for)", tipPrep: "False friend: attendre = to WAIT for (to attend = assister à)! No 'pour' needed.", ex: ["J'attends le bus depuis dix minutes.", "I've been waiting for the bus for ten minutes."] },
  "vendre": { m: "to sell", ex: ["Ils vendent des fruits frais au marché.", "They sell fresh fruit at the market."] },
  "répondre": { m: "to answer / reply", tipPrep: "Always takes À: répondre à une question / répondre à Marie!", ex: ["Elle n'a pas encore répondu à mon e-mail.", "She hasn't replied to my email yet."] },
  "entendre": { m: "to hear", ex: ["Tu entends cette musique ?", "Do you hear that music?"] },
  "perdre": { m: "to lose / waste (time)", ex: ["Ne perdons pas de temps !", "Let's not waste time!"] },
  "rendre": { m: "to give back / return (an object)", tipExtra: "rendre visite à qqn = to visit a person (visiter is only for places!).", ex: ["Nous rendons visite à nos grands-parents.", "We are visiting our grandparents."] }
};

// Build full offline dictionary + automatic reverse conjugated lookup index
const OFFLINE_DICTIONARY = {};
const CONJUGATED_INDEX = {};

for (const [inf, spec] of Object.entries(SPECS)) {
  const entry = buildFromSpec(inf, spec);
  OFFLINE_DICTIONARY[inf] = entry;

  for (const forms of Object.values(entry.tenses)) {
    for (const rawForm of forms) {
      if (rawForm.startsWith("—")) continue;
      const cleanFull = rawForm.replace(/\*/g, "").replace(/\(e\)|\(s\)/g, "").toLowerCase().trim();
      CONJUGATED_INDEX[cleanFull] = inf;

      // Also index bare verb token(s) without subject pronoun
      const withoutSubj = cleanFull
        .replace(/^(il\/elle|ils\/elles|nous|vous|tu|je)\s+/, "")
        .replace(/^j'/, "")
        .trim();
      if (withoutSubj && withoutSubj.length >= 2 && !CONJUGATED_INDEX[withoutSubj]) {
        CONJUGATED_INDEX[withoutSubj] = inf;
      }
    }
  }
  if (entry.pastParticiple && !CONJUGATED_INDEX[entry.pastParticiple]) {
    CONJUGATED_INDEX[entry.pastParticiple] = inf;
    CONJUGATED_INDEX[entry.pastParticiple + "e"] = inf;
    CONJUGATED_INDEX[entry.pastParticiple + "s"] = inf;
    CONJUGATED_INDEX[entry.pastParticiple + "es"] = inf;
  }
}

export function lookupOfflineVerb(rawInput) {
  const cleaned = rawInput
    .toLowerCase()
    .trim()
    .replace(/[.,!?«»"“”()]/g, "")
    .replace(/’/g, "'")
    .replace(/\s+/g, " ");

  if (!cleaned) return { ok: false, reason: "Please type a French verb first." };

  // 1. Direct infinitive match
  if (OFFLINE_DICTIONARY[cleaned]) {
    return {
      ok: true,
      verb: structuredClone(OFFLINE_DICTIONARY[cleaned]),
      detectedFrom: null
    };
  }

  // 2. Direct conjugated phrase match
  if (CONJUGATED_INDEX[cleaned]) {
    const inf = CONJUGATED_INDEX[cleaned];
    return {
      ok: true,
      verb: structuredClone(OFFLINE_DICTIONARY[inf]),
      detectedFrom: rawInput.trim()
    };
  }

  // 3. Scan 3-word, 2-word, and 1-word tokens inside a Duolingo phrase (e.g. "nous avons pris le train")
  const words = cleaned.split(" ");
  const STOP_AUX = new Set(["ai", "as", "a", "avons", "avez", "ont", "suis", "es", "est", "sommes", "êtes", "sont"]);

  for (let i = 0; i < words.length - 2; i++) {
    const triple = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    if (CONJUGATED_INDEX[triple]) {
      const inf = CONJUGATED_INDEX[triple];
      return { ok: true, verb: structuredClone(OFFLINE_DICTIONARY[inf]), detectedFrom: rawInput.trim() };
    }
  }

  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`;
    if (OFFLINE_DICTIONARY[pair]) {
      return { ok: true, verb: structuredClone(OFFLINE_DICTIONARY[pair]), detectedFrom: pair !== cleaned ? rawInput.trim() : null };
    }
    if (CONJUGATED_INDEX[pair]) {
      const inf = CONJUGATED_INDEX[pair];
      return { ok: true, verb: structuredClone(OFFLINE_DICTIONARY[inf]), detectedFrom: rawInput.trim() };
    }
  }

  for (const w of words) {
    const stripped = w.replace(/^(j'|m'|t'|s'|n'|l'|qu')/, "");
    for (const candidate of [w, stripped]) {
      if (!candidate || (words.length > 1 && STOP_AUX.has(candidate))) continue;
      if (OFFLINE_DICTIONARY[candidate]) {
        return { ok: true, verb: structuredClone(OFFLINE_DICTIONARY[candidate]), detectedFrom: words.length > 1 ? rawInput.trim() : null };
      }
      if (CONJUGATED_INDEX[candidate]) {
        const inf = CONJUGATED_INDEX[candidate];
        return { ok: true, verb: structuredClone(OFFLINE_DICTIONARY[inf]), detectedFrom: rawInput.trim() };
      }
    }
  }

  // Strictly reject unknown / fake words offline rather than fabricating conjugations!
  const looksVerbish = /^[a-zàâäéèêëîïôöùûüçœ' -]+$/.test(cleaned) && /(er|ir|re|oir)$/.test(cleaned);
  return {
    ok: false,
    needsAI: looksVerbish,
    reason: looksVerbish
      ? `“${rawInput.trim()}” isn't in the 75-verb offline starter pack yet — connect your free Gemini API key in Settings to generate any of 12,000+ French verbs!`
      : `“${rawInput.trim()}” doesn't look like a French verb (nothing fake saved!). Connect Gemini AI in Settings if it's a rare conjugated form.`
  };
}

export function extractOfflineVerbsFromText(text) {
  const found = [];
  const seen = new Set();
  const lines = text.split(/[\n\r,;•|—–-]+/);
  for (const line of lines) {
    const token = line.trim().toLowerCase().replace(/^\d+[.)]\s*/, "");
    if (!token || token.length > 35) continue;
    if (OFFLINE_DICTIONARY[token] && !seen.has(token)) {
      seen.add(token);
      found.push(structuredClone(OFFLINE_DICTIONARY[token]));
    } else {
      const firstWord = token.split(/\s+/)[0];
      if (OFFLINE_DICTIONARY[firstWord] && !seen.has(firstWord)) {
        seen.add(firstWord);
        found.push(structuredClone(OFFLINE_DICTIONARY[firstWord]));
      }
    }
  }
  return found;
}
