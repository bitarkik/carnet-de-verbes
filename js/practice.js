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

  function ensureQuizSpec(v) {
    if (v.quiz && v.quiz.sentence && v.quiz.answer) return v.quiz;
    const pp = v.pastParticiple || v.infinitive;
    return {
      tense: "Passé Composé",
      sentence: `Hier, nous ${v.auxiliary === "être" ? "sommes" : "avons"} ____ (${v.infinitive}).`,
      en: `Practice the past participle of ${v.infinitive} (${v.meaning}).`,
      answer: pp,
      altAnswers: [pp + "s"],
      explanation: `The past participle of ${v.infinitive} is ${pp}.`
    };
  }

  function render() {
    const verbs = getVerbs();
    const emptyEl = $("practice-empty-state");
    const activeEl = $("practice-active-card");

    if (!verbs.length) {
      emptyEl.classList.remove("hidden");
      activeEl.classList.add("hidden");
      return;
    }

    emptyEl.classList.add("hidden");
    activeEl.classList.remove("hidden");

    const v = verbs[index % verbs.length];
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
      .replace(/\s+/g, " ");
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

    const v = verbs[index % verbs.length];
    const q = ensureQuizSpec(v);
    const valid = [q.answer, ...(q.altAnswers || [])].map(normalizeAns);
    const isRight = valid.includes(userVal);

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
    index = (index + 1) % verbs.length;
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
      renderFlashcard(verbs[index % verbs.length]);
    });

    $("flashcard-speak-btn")?.addEventListener("click", () => {
      const verbs = getVerbs();
      if (!verbs.length) return;
      speakFrench(verbs[index % verbs.length].infinitive);
    });

    $("flashcard-next-btn")?.addEventListener("click", next);
    $("practice-go-notebook-btn")?.addEventListener("click", onSwitchToNotebook);
  }

  bindEvents();
  return { render };
}
