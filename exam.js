// =====================================================================
// exam.js  -  THE EXAM APPLICATION
// ---------------------------------------------------------------------
// Screens, in order:
//   Welcome (student form) -> Lobby (attempt status) -> Exam -> Results
//
// Key rules this file enforces:
//   * An attempt is COUNTED the moment it starts, and saved at once.
//   * The timer uses a fixed deadline (a clock time), so refreshing or
//     closing the page never gives extra time.
//   * Reopening the site resumes an unfinished attempt automatically;
//     if its deadline passed meanwhile, it is submitted automatically.
//   * Answers and explanations are decoded only after submission.
// =====================================================================

(function () {
  "use strict";

  // ---- Shortcuts to the other scripts ----
  const CFG = window.EXAM_CONFIG;
  const { LocalStore, Backend, toResultRow, rowsToCsv, downloadText, formatDuration } = window.ExamStore;
  const QUESTIONS = window.PCEP_QUESTIONS || [];

  // Must match KEY_SALT in build_questions.py
  const KEY_SALT = "AUF-CCS-PCEP";

  // Remembers which student has an exam open, so a refresh can resume it
  const ACTIVE_KEY = "pcepExam:active:" + CFG.examVersion;

  // Look up a question quickly by its id
  const QUESTION_BY_ID = {};
  QUESTIONS.forEach((q) => (QUESTION_BY_ID[q.id] = q));

  const LETTERS = ["A", "B", "C", "D", "E", "F"];
  const SECTION_NAMES = {
    1: "Computer Programming & Python Fundamentals",
    2: "Control Flow: Conditional Blocks & Loops",
    3: "Data Collections: Lists, Tuples, Dictionaries, Strings",
    4: "Functions & Exceptions",
  };

  // ---- Everything the app is working on right now ----
  const state = {
    student: null,       // { no, name, record }  record = what LocalStore holds
    attempt: null,       // the attempt being taken or just finished
    index: 0,            // which question (position in attempt.order) is showing
    timerId: null,       // id of the 1-second timer, so it can be stopped
    announced: {},       // which time warnings were already read aloud
    remoteUsed: 0,       // attempts the central server says are used
    remoteResults: [],   // results the central server knows about
  };

  // Shorthand: get an element by its id
  const $ = (id) => document.getElementById(id);

  // ===================================================================
  // 1. SMALL UTILITIES
  // ===================================================================

  // Shuffle a copy of an array (Fisher-Yates method)
  function shuffled(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));   // random index 0..i
      [copy[i], copy[j]] = [copy[j], copy[i]];          // swap two items
    }
    return copy;
  }

  // Reverse the scramble done by build_questions.py and return {a, e}
  //   a = index of the correct option, e = explanation text
  function unscramble(q) {
    const binary = atob(q.k);                                    // base64 -> bytes
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const key = new TextEncoder().encode(KEY_SALT + ":" + q.id); // same key as Python
    const plain = bytes.map((b, i) => b ^ key[i % key.length]);  // undo the XOR
    return JSON.parse(new TextDecoder().decode(plain));          // bytes -> object
  }

  // Show exactly one screen and hide the rest
  function showScreen(id) {
    ["screenWelcome", "screenLobby", "screenExam", "screenResults"].forEach((s) => {
      $(s).hidden = s !== id;
    });
    // The student / timer box in the header is visible only during the exam
    $("examStatus").hidden = id !== "screenExam";
    document.body.dataset.screen = id;
    window.scrollTo(0, 0);
  }

  // Seconds -> "39:05" (or "1:02:03" for very long exams)
  function clockText(totalSec) {
    totalSec = Math.max(0, Math.ceil(totalSec));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return (h ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
  }

  // ISO date -> readable local date and time
  function niceDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString();
  }

  // Read the screen-reader announcer text
  function announce(text) {
    $("srLive").textContent = text;
  }

  // ===================================================================
  // 2. SAVING
  // ===================================================================

  // Save the current student's record (with the current attempt inside it)
  function persist() {
    if (!state.student) return;
    LocalStore.putStudent(state.student.no, state.student.record);
  }

  function setActive(studentNo) {
    try { localStorage.setItem(ACTIVE_KEY, studentNo); } catch (e) { /* storage blocked */ }
  }
  function clearActive() {
    try { localStorage.removeItem(ACTIVE_KEY); } catch (e) { /* storage blocked */ }
  }
  function getActive() {
    try { return localStorage.getItem(ACTIVE_KEY); } catch (e) { return null; }
  }

  // Number of attempts used: local ones (finished OR in progress) or the
  // server's count, whichever is larger
  function attemptsUsed() {
    const local = state.student ? state.student.record.attempts.length : 0;
    return Math.max(local, state.remoteUsed);
  }

  function inProgressAttempt(record) {
    return (record.attempts || []).find((a) => a.status === "in_progress") || null;
  }

  // ===================================================================
  // 3. WELCOME SCREEN
  // ===================================================================

  function fillConfigText() {
    $("brandInstitution").textContent = CFG.institution;
    $("brandTitle").textContent = CFG.examTitle;
    $("welcomeDept").textContent = CFG.department;
    $("welcomeTitle").textContent = CFG.examTitle;
    $("welcomeInstructor").textContent = CFG.instructorName;
    $("factItems").textContent = QUESTIONS.length;
    $("factTime").textContent = CFG.durationMinutes + " min";
    $("factPass").textContent = CFG.passingPercent + "%";
    $("factAttempts").textContent = CFG.maxAttempts;
    $("inNumber").placeholder = CFG.studentNumberExample || "";
    $("dlgStartMin").textContent = CFG.durationMinutes;
    $("resPassMark").textContent = CFG.passingPercent + "%";
  }

  // Show a message under a form field (or hide it when text is "")
  function fieldError(id, text) {
    $(id).textContent = text;
    $(id).hidden = !text;
  }

  async function onContinue(event) {
    event.preventDefault();                         // stop the page reloading

    // --- read and tidy the inputs ---
    const name = $("inName").value.trim().replace(/\s+/g, " ");
    const number = $("inNumber").value.trim().toUpperCase();
    const pattern = new RegExp(CFG.studentNumberPattern);

    // --- check them ---
    let ok = true;
    fieldError("errName", name.length >= 3 ? "" : "Please enter your full name.");
    if (name.length < 3) ok = false;
    const numberOk = pattern.test(number);
    fieldError("errNumber", numberOk ? "" : "Enter a valid student number (" + (CFG.studentNumberExample || "letters, digits and dashes") + ").");
    if (!numberOk) ok = false;
    fieldError("errAgree", $("inAgree").checked ? "" : "Please tick the box to continue.");
    if (!$("inAgree").checked) ok = false;
    if (!ok) return;

    // --- load (or create) this student's record ---
    let record = LocalStore.getStudent(number);
    let nameNote = "";
    if (!record) {
      record = { name, attempts: [] };
      LocalStore.putStudent(number, record);
    } else if (record.name.toLowerCase() !== name.toLowerCase()) {
      // Same number, different name: keep the name first registered
      nameNote = "This student number is registered as " + record.name + ". ";
    }
    state.student = { no: number, name: record.name, record };

    // --- ask the central server, if one is set up ---
    state.remoteUsed = 0;
    state.remoteResults = [];
    if (Backend.enabled) {
      const btn = $("btnContinue");
      btn.disabled = true;
      btn.textContent = "Checking attempts…";
      try {
        const info = await Backend.status(number);
        state.remoteUsed = Number(info.attemptsUsed) || 0;
        state.remoteResults = info.results || [];
      } catch (e) {
        // Fail closed: without the server we cannot enforce the limit
        btn.disabled = false;
        btn.textContent = "Continue";
        showStorageNotice("Cannot reach the exam server. Check your internet connection and try again.");
        return;
      }
      btn.disabled = false;
      btn.textContent = "Continue";
    }

    openLobby(nameNote);
  }

  function showStorageNotice(text) {
    $("storageNotice").textContent = text;
    $("storageNotice").hidden = !text;
  }

  // ===================================================================
  // 4. LOBBY (attempt status)
  // ===================================================================

  function openLobby(extraNote) {
    const s = state.student;
    const used = attemptsUsed();
    const unfinished = inProgressAttempt(s.record);
    const btn = $("btnStart");

    $("lobbyHeading").textContent = "Hello, " + s.name;
    renderHistory();

    if (unfinished) {
      // An attempt was started earlier and not submitted
      $("lobbyMessage").textContent = (extraNote || "") +
        "You have an unfinished attempt (" + unfinished.attemptNo + " of " + CFG.maxAttempts +
        "). Its timer kept running while you were away.";
      btn.textContent = "Resume Attempt " + unfinished.attemptNo;
      btn.hidden = false;
      btn.onclick = () => resumeAttempt(unfinished);
    } else if (used >= CFG.maxAttempts) {
      // Limit reached: no more attempts
      $("lobbyMessage").textContent = (extraNote || "") +
        "You have used all " + CFG.maxAttempts + " attempts for this practice exam. No further attempts are allowed. If you think this is a mistake, please contact your instructor.";
      btn.hidden = true;
    } else {
      const next = used + 1;
      $("lobbyMessage").textContent = (extraNote || "") +
        "You are about to take attempt " + next + " of " + CFG.maxAttempts + ". " +
        (CFG.maxAttempts - used === 1 ? "This is your last attempt." : "");
      btn.textContent = "Start Attempt " + next;
      btn.hidden = false;
      btn.onclick = () => confirmStart(next);
    }
    showScreen("screenLobby");
  }

  // Combine local results with any the server knows about (other devices)
  function completedResults() {
    const rows = state.student.record.attempts
      .filter((a) => a.status === "submitted")
      .map((a) => toResultRow(state.student.no, state.student.name, a));
    const seen = new Set(rows.map((r) => String(r.attemptNumber)));
    state.remoteResults.forEach((r) => {
      if (!seen.has(String(r.attemptNumber))) rows.push(r);
    });
    return rows.sort((a, b) => Number(a.attemptNumber) - Number(b.attemptNumber));
  }

  function renderHistory() {
    const rows = completedResults();
    const body = $("historyBody");
    body.textContent = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      [r.attemptNumber, r.score + " / " + r.totalItems, r.percentage + "%", r.status, niceDate(r.completedAt)]
        .forEach((value, i) => {
          const td = document.createElement("td");
          td.textContent = value;
          if (i === 3) td.className = r.status === "PASSED" ? "pass" : "fail";
          tr.appendChild(td);
        });
      body.appendChild(tr);
    });
    $("historyBox").hidden = rows.length === 0;
  }

  function confirmStart(attemptNo) {
    $("dlgStartNo").textContent = attemptNo;
    $("dlgStartOk").onclick = async () => {
      $("dlgStartOk").disabled = true;
      await startAttempt(attemptNo);
      $("dlgStartOk").disabled = false;
      $("dlgStart").close();
    };
    $("dlgStart").showModal();
  }

  // ===================================================================
  // 5. STARTING / RESUMING AN ATTEMPT
  // ===================================================================

  async function startAttempt(attemptNo) {
    const s = state.student;

    // Server check first (if used): it is the final authority
    if (Backend.enabled) {
      try {
        const reply = await Backend.startAttempt(s.no, s.name, attemptNo);
        if (!reply.ok) {
          state.remoteUsed = Number(reply.attemptsUsed) || CFG.maxAttempts;
          $("dlgStart").close();
          openLobby(reply.message ? reply.message + " " : "");
          return;
        }
        attemptNo = Number(reply.attemptNo) || attemptNo;
        state.remoteUsed = attemptNo;
      } catch (e) {
        $("dlgStart").close();
        openLobby("Cannot reach the exam server, so the attempt was not started. ");
        return;
      }
    }

    // Build the attempt: question order and option order for THIS attempt
    const ids = QUESTIONS.map((q) => q.id);
    const order = CFG.shuffleQuestions ? shuffled(ids) : ids;
    const optOrder = {};
    QUESTIONS.forEach((q) => {
      const positions = q.options.map((_, i) => i);      // [0, 1, 2, 3]
      optOrder[q.id] = CFG.shuffleOptions ? shuffled(positions) : positions;
    });

    const now = Date.now();
    const attempt = {
      attemptNo,
      status: "in_progress",
      startedAt: new Date(now).toISOString(),
      startedMs: now,
      deadlineMs: now + CFG.durationMinutes * 60 * 1000,   // fixed end time
      order,
      optOrder,
      answers: {},     // question id -> ORIGINAL option index chosen
      flags: {},       // question id -> true when flagged
      current: 0,
    };

    // Save IMMEDIATELY so this attempt counts even if the page closes now
    s.record.attempts.push(attempt);
    persist();
    setActive(s.no);

    beginExam(attempt);
  }

  function resumeAttempt(attempt) {
    setActive(state.student.no);
    if (Date.now() >= attempt.deadlineMs) {
      // Time ran out while the student was away
      state.attempt = attempt;
      submitAttempt(true);
      return;
    }
    beginExam(attempt);
  }

  function beginExam(attempt) {
    state.attempt = attempt;
    state.index = Math.min(attempt.current || 0, attempt.order.length - 1);
    state.announced = {};

    $("statusName").textContent = state.student.name;
    $("statusAttempt").textContent = "Attempt " + attempt.attemptNo + " of " + CFG.maxAttempts;

    buildPalette();
    renderQuestion();
    showScreen("screenExam");
    startTimer();
    window.addEventListener("beforeunload", warnBeforeLeaving);
  }

  // Browser's built-in "Leave site?" warning while the exam is open
  function warnBeforeLeaving(event) {
    event.preventDefault();
    event.returnValue = "";    // older browsers need this line
    return "";
  }

  // ===================================================================
  // 6. TIMER
  // ===================================================================

  function startTimer() {
    stopTimer();
    tick();                                     // update the display right away
    state.timerId = setInterval(tick, 1000);    // then once per second
  }

  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  function tick() {
    const a = state.attempt;
    if (!a || a.status !== "in_progress") return stopTimer();

    const leftSec = (a.deadlineMs - Date.now()) / 1000;
    $("timerValue").textContent = clockText(leftSec);

    // Colour warnings: amber at 5 minutes, red at 1 minute
    const timer = $("timer");
    timer.classList.toggle("is-warn", leftSec <= 300 && leftSec > 60);
    timer.classList.toggle("is-danger", leftSec <= 60);

    // Spoken warnings for screen-reader users (once each)
    if (leftSec <= 300 && !state.announced.five) { state.announced.five = true; announce("5 minutes remaining."); }
    if (leftSec <= 60 && !state.announced.one) { state.announced.one = true; announce("1 minute remaining."); }

    if (leftSec <= 0) submitAttempt(true);      // time is up
  }

  // ===================================================================
  // 7. SHOWING A QUESTION
  // ===================================================================

  function currentQuestion() {
    return QUESTION_BY_ID[state.attempt.order[state.index]];
  }

  function renderQuestion() {
    const a = state.attempt;
    const q = currentQuestion();
    const total = a.order.length;
    const position = state.index + 1;

    // Progress text and bar
    $("progressText").textContent = "Question " + position + " of " + total;
    $("progressFill").style.width = (position / total) * 100 + "%";
    updateAnsweredCount();

    // Question number, text and (optional) code
    $("qNumber").textContent = "Question " + position;
    $("qPrompt").textContent = q.prompt;
    const codeBox = $("qCode");
    codeBox.hidden = !q.code;
    codeBox.querySelector("code").textContent = q.code || "";

    // Flag button
    const flagged = Boolean(a.flags[q.id]);
    $("btnFlag").setAttribute("aria-pressed", String(flagged));
    $("btnFlag").classList.toggle("is-on", flagged);
    $("btnFlag").textContent = flagged ? "⚑ Flagged" : "⚑ Flag for review";

    // Answer choices, in this attempt's shuffled order
    const box = $("qOptions");
    box.querySelectorAll(".opt, .clear-link").forEach((el) => el.remove());
    a.optOrder[q.id].forEach((originalIndex, shownIndex) => {
      const label = document.createElement("label");
      label.className = "opt";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "answer";
      radio.value = String(originalIndex);
      radio.checked = a.answers[q.id] === originalIndex;
      radio.addEventListener("change", () => chooseAnswer(q.id, originalIndex));

      const letter = document.createElement("span");
      letter.className = "opt-letter";
      letter.textContent = LETTERS[shownIndex];

      // Code-style options use <pre> so line breaks and spaces show
      const text = document.createElement(q.mono ? "pre" : "span");
      text.className = "opt-text" + (q.mono ? " mono" : "");
      text.textContent = q.options[originalIndex];

      label.append(radio, letter, text);
      label.classList.toggle("is-selected", radio.checked);
      box.appendChild(label);
    });

    // "Clear selection" link, only when something is chosen
    if (a.answers[q.id] !== undefined) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "clear-link";
      clear.textContent = "Clear my answer";
      clear.addEventListener("click", () => chooseAnswer(q.id, undefined));
      box.appendChild(clear);
    }

    // Previous / Next buttons
    $("btnPrev").disabled = state.index === 0;
    const last = state.index === total - 1;
    $("btnNext").textContent = last ? "Review & Submit" : "Next ›";

    refreshPalette();
  }

  function chooseAnswer(questionId, originalIndex) {
    if (state.attempt.status !== "in_progress") return;
    if (originalIndex === undefined) delete state.attempt.answers[questionId];
    else state.attempt.answers[questionId] = originalIndex;
    persist();                      // save every click: safe on refresh
    renderQuestion();
  }

  function updateAnsweredCount() {
    const n = Object.keys(state.attempt.answers).length;
    $("answeredText").textContent = n + " of " + state.attempt.order.length + " answered";
  }

  function goTo(newIndex) {
    const total = state.attempt.order.length;
    state.index = Math.max(0, Math.min(total - 1, newIndex));
    state.attempt.current = state.index;
    persist();
    renderQuestion();
    closePalette();
    $("questionCard").focus({ preventScroll: true });
    // Bring the question into view on small screens
    if (window.innerWidth < 900) $("questionCard").scrollIntoView({ block: "start" });
  }

  function toggleFlag() {
    const q = currentQuestion();
    if (state.attempt.flags[q.id]) delete state.attempt.flags[q.id];
    else state.attempt.flags[q.id] = true;
    persist();
    renderQuestion();
  }

  // ===================================================================
  // 8. QUESTION PALETTE
  // ===================================================================

  function buildPalette() {
    const grid = $("paletteGrid");
    grid.textContent = "";
    state.attempt.order.forEach((_, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pal";
      b.textContent = i + 1;
      b.addEventListener("click", () => goTo(i));
      grid.appendChild(b);
    });
  }

  function refreshPalette() {
    const a = state.attempt;
    $("paletteGrid").querySelectorAll(".pal").forEach((b, i) => {
      const id = a.order[i];
      const answered = a.answers[id] !== undefined;
      const flagged = Boolean(a.flags[id]);
      b.classList.toggle("is-answered", answered);
      b.classList.toggle("is-flagged", flagged);
      b.classList.toggle("is-current", i === state.index);
      // Screen readers hear the status too, not just the colour
      b.setAttribute("aria-label", "Question " + (i + 1) + ", " +
        (answered ? "answered" : "not answered") + (flagged ? ", flagged" : ""));
      if (i === state.index) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
  }

  // Mobile: the palette slides in as a panel
  function openPalette() {
    document.body.classList.add("palette-open");
    $("btnPalette").setAttribute("aria-expanded", "true");
  }
  function closePalette() {
    document.body.classList.remove("palette-open");
    $("btnPalette").setAttribute("aria-expanded", "false");
  }

  // ===================================================================
  // 9. SUBMITTING
  // ===================================================================

  function askToSubmit() {
    const a = state.attempt;
    const total = a.order.length;
    const answered = Object.keys(a.answers).length;
    const flagged = Object.keys(a.flags).length;
    $("dlgSubmitSummary").textContent = "You have answered " + answered + " of " + total + " questions.";

    const warnings = [];
    if (answered < total) warnings.push((total - answered) + " unanswered (they will be marked wrong)");
    if (flagged) warnings.push(flagged + " flagged for review");
    $("dlgSubmitWarn").textContent = warnings.length ? "Still open: " + warnings.join(" and ") + "." : "";
    $("dlgSubmitWarn").hidden = !warnings.length;

    $("dlgSubmit").showModal();
  }

  // Grade the attempt, save it, and show the results.
  //   auto = true when the timer ran out
  async function submitAttempt(auto) {
    const a = state.attempt;
    if (!a || a.status !== "in_progress") return;   // never submit twice

    stopTimer();
    window.removeEventListener("beforeunload", warnBeforeLeaving);

    // --- grading: decode each key now, after the exam is over ---
    let correct = 0, unanswered = 0;
    const sectionScores = {};
    a.order.forEach((id) => {
      const q = QUESTION_BY_ID[id];
      const key = unscramble(q);
      const chosen = a.answers[id];
      const sec = (sectionScores[q.section] = sectionScores[q.section] || { correct: 0, total: 0 });
      sec.total++;
      if (chosen === undefined) unanswered++;
      else if (chosen === key.a) { correct++; sec.correct++; }
    });

    const total = a.order.length;
    const now = Date.now();
    // Time used never exceeds the limit (the auto-submit may run a moment late)
    const endMs = Math.min(now, a.deadlineMs);

    Object.assign(a, {
      status: "submitted",
      submittedAt: new Date(now).toISOString(),
      score: correct,
      total,
      incorrect: total - correct - unanswered,
      unanswered,
      percent: Math.round((correct / total) * 10000) / 100,   // 2 decimals
      passed: (correct / total) * 100 >= CFG.passingPercent,
      autoSubmitted: Boolean(auto),
      timeUsedSec: Math.round((endMs - a.startedMs) / 1000),
      sectionScores,
      passingPercent: CFG.passingPercent,
      synced: false,
    });
    persist();
    clearActive();

    // Close any dialog that may still be open
    ["dlgSubmit", "dlgStart"].forEach((d) => { if ($(d).open) $(d).close(); });

    renderResults();
    showScreen("screenResults");
    if (auto) $("dlgTimeUp").showModal();

    // Send to the central server (if used). Local copy is already safe.
    if (Backend.enabled) {
      try {
        await Backend.submitResult(toResultRow(state.student.no, state.student.name, a));
        a.synced = true;
        persist();
        setSyncNote("Your result was recorded on the exam server.");
      } catch (e) {
        setSyncNote("Your result is saved on this device but could not be sent to the server. Please download it and give it to your instructor.");
      }
    }
  }

  function setSyncNote(text) {
    $("resSyncNote").textContent = text;
    $("resSyncNote").hidden = !text;
  }

  // ===================================================================
  // 10. RESULTS AND REVIEW
  // ===================================================================

  function renderResults() {
    const a = state.attempt;

    // Big verdict
    $("verdictBadge").textContent = a.passed ? "PASSED" : "NOT YET PASSED";
    $("verdict").classList.toggle("is-pass", a.passed);
    $("verdict").classList.toggle("is-fail", !a.passed);
    $("resPercent").textContent = a.percent + "%";
    $("resPassMark").textContent = (a.passingPercent || CFG.passingPercent) + "%";
    $("resAutoNote").hidden = !a.autoSubmitted;

    // Numbers
    $("resScore").textContent = a.score + " / " + a.total;
    $("resCorrect").textContent = a.score;
    $("resIncorrect").textContent = a.incorrect;
    $("resUnanswered").textContent = a.unanswered;
    $("resTime").textContent = formatDuration(a.timeUsedSec);
    $("resAttempt").textContent = a.attemptNo + " of " + CFG.maxAttempts;
    $("resMeta").textContent = state.student.name + " · " + state.student.no +
      " · completed " + niceDate(a.submittedAt);
    setSyncNote("");

    // Per-section bars
    const box = $("resSections");
    box.textContent = "";
    Object.keys(a.sectionScores).sort().forEach((sec) => {
      const s = a.sectionScores[sec];
      const pct = Math.round((s.correct / s.total) * 100);
      const row = document.createElement("div");
      row.className = "sec-row";
      row.innerHTML =
        '<div class="sec-label"><b></b><span></span></div>' +
        '<div class="sec-bar"><div></div></div>' +
        '<div class="sec-num"></div>';
      row.querySelector("b").textContent = "Section " + sec;
      row.querySelector("span").textContent = SECTION_NAMES[sec] || "";
      row.querySelector(".sec-bar div").style.width = pct + "%";
      row.querySelector(".sec-bar div").classList.toggle("low", pct < CFG.passingPercent);
      row.querySelector(".sec-num").textContent = s.correct + "/" + s.total;
      box.appendChild(row);
    });

    // Next-attempt button only if an attempt remains
    const remaining = CFG.maxAttempts - attemptsUsed();
    $("btnNextAttempt").hidden = remaining <= 0;
    $("btnNextAttempt").textContent = "Start Attempt " + (attemptsUsed() + 1);

    renderReview("all");
  }

  function renderReview(filter) {
    const a = state.attempt;
    const list = $("reviewList");
    list.textContent = "";
    $("reviewBox").hidden = !CFG.showReview;
    if (!CFG.showReview) return;

    document.querySelectorAll(".seg-btn").forEach((b) =>
      b.classList.toggle("is-on", b.dataset.filter === filter));

    let shown = 0;
    a.order.forEach((id, position) => {
      const q = QUESTION_BY_ID[id];
      const key = unscramble(q);
      const chosen = a.answers[id];
      const isRight = chosen === key.a;
      if (filter === "wrong" && isRight) return;
      shown++;

      const order = a.optOrder[id];
      const letterOf = (orig) => LETTERS[order.indexOf(orig)];

      const item = document.createElement("article");
      item.className = "rv " + (isRight ? "rv-right" : chosen === undefined ? "rv-skip" : "rv-wrong");

      // Header: number, verdict, topic
      const head = document.createElement("div");
      head.className = "rv-head";
      const num = document.createElement("b");
      num.textContent = "Question " + (position + 1);
      const tag = document.createElement("span");
      tag.className = "rv-tag";
      tag.textContent = isRight ? "Correct" : chosen === undefined ? "Unanswered" : "Incorrect";
      const topic = document.createElement("span");
      topic.className = "rv-topic";
      topic.textContent = "PCEP " + q.objective + " · " + q.topic + " · " + q.level;
      head.append(num, tag, topic);
      item.appendChild(head);

      const prompt = document.createElement("p");
      prompt.textContent = q.prompt;
      item.appendChild(prompt);

      if (q.code) {
        const pre = document.createElement("pre");
        pre.className = "q-code";
        pre.textContent = q.code;
        item.appendChild(pre);
      }

      // All options with markers for "yours" and "correct"
      const ul = document.createElement("ul");
      ul.className = "rv-opts";
      order.forEach((orig, shownIndex) => {
        const li = document.createElement("li");
        if (orig === key.a) li.classList.add("is-key");
        if (orig === chosen && orig !== key.a) li.classList.add("is-mine-wrong");
        const letter = document.createElement("span");
        letter.className = "opt-letter";
        letter.textContent = LETTERS[shownIndex];
        const text = document.createElement(q.mono ? "pre" : "span");
        text.className = "opt-text" + (q.mono ? " mono" : "");
        text.textContent = q.options[orig];
        const marks = document.createElement("span");
        marks.className = "rv-mark";
        marks.textContent = (orig === key.a ? "Correct answer" : "") +
          (orig === chosen ? (orig === key.a ? " · your answer" : "Your answer") : "");
        li.append(letter, text, marks);
        ul.appendChild(li);
      });
      item.appendChild(ul);

      const summary = document.createElement("p");
      summary.className = "rv-summary";
      summary.textContent = chosen === undefined
        ? "You did not answer. Correct answer: " + letterOf(key.a) + "."
        : "Your answer: " + letterOf(chosen) + ". Correct answer: " + letterOf(key.a) + ".";
      item.appendChild(summary);

      const ex = document.createElement("div");
      ex.className = "box-explain";
      const exLabel = document.createElement("div");
      exLabel.className = "lbl";
      exLabel.textContent = "Explanation";
      const exText = document.createElement("p");
      exText.textContent = key.e;
      ex.append(exLabel, exText);
      item.appendChild(ex);

      list.appendChild(item);
    });

    if (!shown) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Nothing to show: every question was answered correctly.";
      list.appendChild(p);
    }
  }

  function downloadMine() {
    const row = toResultRow(state.student.no, state.student.name, state.attempt);
    const safeNo = state.student.no.replace(/[^A-Za-z0-9-]/g, "");
    downloadText("PCEP-result-" + safeNo + "-attempt" + state.attempt.attemptNo + ".csv", rowsToCsv([row]));
  }

  function finish() {
    state.student = null;
    state.attempt = null;
    $("studentForm").reset();
    showScreen("screenWelcome");
  }

  // ===================================================================
  // 11. START-UP
  // ===================================================================

  function wireEvents() {
    $("studentForm").addEventListener("submit", onContinue);
    $("btnLobbyBack").addEventListener("click", finish);
    $("dlgStartCancel").addEventListener("click", () => $("dlgStart").close());

    $("btnPrev").addEventListener("click", () => goTo(state.index - 1));
    $("btnNext").addEventListener("click", () => {
      if (state.index === state.attempt.order.length - 1) askToSubmit();
      else goTo(state.index + 1);
    });
    $("btnFlag").addEventListener("click", toggleFlag);
    $("btnSubmit").addEventListener("click", askToSubmit);
    $("btnPalette").addEventListener("click", openPalette);
    $("btnPaletteClose").addEventListener("click", closePalette);

    $("dlgSubmitCancel").addEventListener("click", () => $("dlgSubmit").close());
    $("dlgSubmitOk").addEventListener("click", () => submitAttempt(false));
    $("dlgTimeUpOk").addEventListener("click", () => $("dlgTimeUp").close());

    $("btnDownloadMine").addEventListener("click", downloadMine);
    $("btnPrint").addEventListener("click", () => window.print());
    $("btnFinish").addEventListener("click", finish);
    $("btnNextAttempt").addEventListener("click", () => openLobby(""));
    document.querySelectorAll(".seg-btn").forEach((b) =>
      b.addEventListener("click", () => renderReview(b.dataset.filter)));

    // If the computer slept, the 1-second timer pauses: re-check on return
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.attempt && state.attempt.status === "in_progress") tick();
    });
  }

  function init() {
    // A hidden "announcer" that screen readers read aloud
    const live = document.createElement("div");
    live.id = "srLive";
    live.className = "sr-only";
    live.setAttribute("aria-live", "assertive");
    document.body.appendChild(live);

    fillConfigText();
    wireEvents();

    // Stop if the question file did not load
    if (!QUESTIONS.length) {
      showStorageNotice("The question file could not be loaded. Please contact your instructor.");
      $("btnContinue").disabled = true;
      return;
    }

    // Without localStorage, attempts could be reset by refreshing: block
    if (!LocalStore.available) {
      showStorageNotice("Your browser is blocking site storage (common in private or incognito windows). Please open this page in a normal browser window to take the exam.");
      $("btnContinue").disabled = true;
      return;
    }

    // Resume an exam that was open before a refresh / reopen
    const activeNo = getActive();
    if (activeNo) {
      const record = LocalStore.getStudent(activeNo);
      const unfinished = record && inProgressAttempt(record);
      if (unfinished) {
        state.student = { no: activeNo, name: record.name, record };
        resumeAttempt(unfinished);
        return;
      }
      clearActive();
    }
    showScreen("screenWelcome");
  }

  init();
})();
