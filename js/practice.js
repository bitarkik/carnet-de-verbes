// ==========================================================================
// 2-Minute Practice Engine (Fill-in-the-Blank + Flashcards on Saved Verbs)
// ==========================================================================

export function createPracticeController({ getVerbs, speakFrench, onSwitchToNotebook }) {
  let mode = "fill"; // "fill" | "flashcard"
  let index = 0;
  let correct = 0;
  let total = 0;
  let answered = false;
  let flipped = false;

  const $ = (id) => document.getElementById(id);

  let order = [];
  let signature = "";
  function shuffle(verbs) {
    const result = verbs.map((_, i) => i);
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function ensureOrder() {
    const verbs = getVerbs();
    if (signature !== JSON.stringify(verbs.map(v => v.infinitive))) {
      signature = JSON.stringify(verbs.map(v => v.infinitive));
      index = 0;
      order = shuffle(verbs);
    }
  }

  function ensureQuizSpec(v) {
    if (v.quiz && v.quiz.sentence && v.quiz.answer) return v.quiz;
    const form = (v.tenses.present[v.isImpersonal ? 2 : 3] || "").replace(/\*/g, "");
    const subject = v.isImpersonal ? "il" : "nous";
    const answer = form.replace(/^(nous|il\/elle|il)\s+/, "");
    return { tense: "Présent", sentence: `${subject} ____ (${v.infinitive})`,
      en: `Conjugate ${v.infinitive} for ${subject}.`, answer,
      altAnswers: [form], explanation: `Présent: ${form}.` };
  }

  function render() {
    const verbs = getVerbs();
    const emptyEl = $("practice-empty-card");
    const activeEl = $("practice-card");

    if (!verbs.length) {
      emptyEl?.classList.remove("hidden");
      activeEl?.classList.add("hidden");
      return;
    }

    ensureOrder();
    emptyEl?.classList.add("hidden");
    activeEl?.classList.remove("hidden");

    const vIdx = order[index % order.length] ?? 0;
    const v = verbs[vIdx] || verbs[0];
    $("quiz-score-badge").textContent = `Score: ${correct} / ${total}`;
    $("quiz-mode-toggle-btn").textContent = mode === "fill" ? "Switch to Flashcards" : "Switch to Fill-in-Blank";

    $("quiz-fill-container").classList.toggle("hidden", mode !== "fill");
    $("quiz-flashcard-container").classList.toggle("hidden", mode !== "flashcard");

    if (mode === "fill") {
      answered = false;
      const q = ensureQuizSpec(v);
      $("quiz-tense-label").textContent = q.tense;
      $("quiz-verb-hint").textContent = `${v.infinitive} — ${v.meaning}`;
      $("quiz-prompt-sentence").textContent = q.sentence;
      $("quiz-prompt-english").textContent = q.en;

      const input = $("quiz-answer-input");
      input.value = "";
      input.disabled = false;
      $("quiz-feedback-box").classList.add("hidden");
      setTimeout(() => input.focus(), 40);
    } else {
      renderFlashcard(v);
    }
  }

  function renderFlashcard(v) {
    if (!flipped) {
      $("flashcard-side-label").textContent = "English Meaning (Tap card to flip)";
      $("flashcard-main-text").textContent = v.meaning;
      $("flashcard-sub-text").textContent = `${v.group} · Tap to reveal French & conjugations`;
    } else {
      $("flashcard-side-label").textContent = "French Verb & Present Forms";
      $("flashcard-main-text").textContent = `${v.infinitive} (${v.auxiliary} + ${v.pastParticiple})`;
      $("flashcard-sub-text").textContent = (v.tenses?.present || [])
        .map((f) => f.replace(/\*/g, ""))
        .filter((f) => f !== "—")
        .join("  ·  ");
    }
  }

  function normalizeAns(s) {
    return String(s || "")
      .toLowerCase()
      .trim()
      .replace(/’/g, "'")
      .replace(/\s+/g, " ")
      .replace(/[.,!?«»"“”]/g, "");
  }

  function stripSubjectPronoun(s) {
    return normalizeAns(s)
      .replace(/^(je|tu|il|elle|on|nous|vous|ils|elles)\s+/i, "")
      .replace(/^j'/i, "")
      .trim();
  }

  function submitAnswer() {
    const verbs = getVerbs();
    if (!verbs.length) return;
    if (answered) {
      next();
      return;
    }

    const input = $("quiz-answer-input");
    const userVal = normalizeAns(input.value);
    if (!userVal) return;

    ensureOrder();
    const vIdx = order[index % order.length] ?? 0;
    const v = verbs[vIdx] || verbs[0];
    const q = ensureQuizSpec(v);
    const valid = [q.answer, ...(q.altAnswers || [])].map(normalizeAns);
    const validBares = valid.map(stripSubjectPronoun).filter(Boolean);
    const userBare = stripSubjectPronoun(userVal);

    // Tolerant match: accepts exact match or bare verb form if user omitted/included pronoun
    const isRight = valid.includes(userVal) || (userBare && validBares.includes(userBare));

    answered = true;
    total += 1;
    if (isRight) correct += 1;

    $("quiz-score-badge").textContent = `Score: ${correct} / ${total}`;
    input.disabled = true;

    const fb = $("quiz-feedback-box");
    fb.classList.remove("hidden");
    $("quiz-feedback-title").textContent = isRight
      ? `✓ Exact! "${q.answer}"`
      : `Almost — answer: "${q.answer}"`;
    $("quiz-feedback-detail").textContent = q.explanation || "";

    speakFrench(q.sentence.replace("____", q.answer));
  }

  function next() {
    const verbs = getVerbs();
    if (!verbs.length) return;
    flipped = false;
    index = index + 1;
    if (index >= order.length) {
      order = shuffle(verbs);
      index = 0;
    }
    render();
  }

  function bindEvents() {
    $("quiz-mode-toggle-btn")?.addEventListener("click", () => {
      mode = mode === "fill" ? "flashcard" : "fill";
      flipped = false;
      render();
    });

    $("quiz-check-btn")?.addEventListener("click", submitAnswer);
    $("quiz-answer-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitAnswer();
      }
    });

    $("quiz-next-btn")?.addEventListener("click", next);

    document.querySelectorAll(".accent-key").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = $("quiz-answer-input");
        if (!input || input.disabled) return;
        const ch = btn.dataset.accent || "";
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.value = input.value.slice(0, start) + ch + input.value.slice(end);
        input.focus();
        input.setSelectionRange(start + ch.length, start + ch.length);
      });
    });

    $("flashcard-stage")?.addEventListener("click", () => {
      const verbs = getVerbs();
      if (!verbs.length) return;
      flipped = !flipped;
      renderFlashcard(verbs[order[index % order.length] ?? 0]);
    });

    $("flashcard-speak-btn")?.addEventListener("click", () => {
      const verbs = getVerbs();
      if (!verbs.length) return;
      speakFrench(verbs[order[index % order.length] ?? 0].infinitive);
    });

    $("flashcard-next-btn")?.addEventListener("click", next);
    $("practice-go-notebook-btn")?.addEventListener("click", onSwitchToNotebook);
  }

  bindEvents();
  return { render };
}
