# PCEP-30-02 Practice Examination

A timed, 30-item practice exam modeled on the Python Institute's **PCEP™ – Certified Entry-Level Python Programmer (PCEP-30-02)** exam, for students of the Angeles University Foundation College of Computer Studies.

It is a plain HTML/CSS/JavaScript site. There is nothing to install: it runs on GitHub Pages and in any modern browser, on desktop or phone.

> PCEP™ is a trademark of the Python Institute. This practice exam is not affiliated with or endorsed by the Python Institute, and its questions are original.

---

## What it does

| Feature | Default |
|---|---|
| Items | 30 multiple choice, 7 / 8 / 7 / 8 across the four PCEP-30-02 sections |
| Time limit | 40 minutes, with automatic submission at 0:00 |
| Passing score | 70% |
| Attempts | 2 per student number |
| Order | Questions and answer choices shuffled for every attempt |
| Results | Score, correct / incorrect / unanswered, percentage, pass/fail, per-section breakdown, full answer review with explanations |

During the exam, students see one question at a time, Previous/Next buttons, a question palette (answered, unanswered, flagged), a progress bar and a countdown that turns amber at 5 minutes and red at 1 minute. Correct answers and explanations appear **only after submission**.

---

## Files

```
pcep-practice-exam/          (all files side by side, no folders)
├── index.html          the exam (students open this)
├── instructor.html     results page for the instructor (PIN protected)
├── style.css           all styling (AUF red/gold)
├── config.js           ALL SETTINGS — the file you edit most
├── storage.js          saving attempts, CSV export, optional server
├── exam.js             the exam logic (timer, navigation, grading)
├── instructor.js       the instructor page logic
├── questions.js        question data, answers scrambled (generated — do not edit by hand)
├── backend-Code.gs     optional Google Sheets backend
├── BACKEND-SETUP.md    how to switch the backend on
└── .nojekyll           optional; tells GitHub Pages to serve files as they are
```

---

## Changing settings

Open `config.js`, change a value, and upload the file. For example:

```js
durationMinutes: 40,   // exam length in minutes
passingPercent: 70,    // pass mark
maxAttempts: 2,        // attempts per student number
shuffleQuestions: true,
shuffleOptions: true,
showReview: true,      // false = hide answers/explanations after submitting
```

**New semester / new batch?** Change `examVersion` (for example to `"pcep-30-02-practice-2027s1"`). Attempts are counted per version, so everyone starts again with fresh attempts.

---

## Updating questions

The master question list, **with the answer key in plain text**, is kept in a separate private folder, `pcep-exam-private/`, that is **never uploaded** to this public repository. Keep it on your own computer or a private drive.

1. Edit `pcep-exam-private/questions_src.py`. Each question has a prompt, optional code, four options, the index of the correct option (`answer`: 0 = first option), and an explanation.
2. Run:
   ```
   python3 pcep-exam-private/build_questions.py pcep-practice-exam
   ```
   The script **runs every code snippet** and stops with a message if the keyed answer is not what Python actually prints, or if a wrong option happens to match. Conceptual questions are marked `check="manual"`.
3. Upload only the new `questions.js` to GitHub.

If you add or remove questions, the exam adapts automatically. Keep option texts unique.

---

## Viewing student results

### Without a backend (default)
Each result is saved in the browser where the exam was taken. So:

- **Shared lab computers:** open `instructor.html` on each computer and press **Export CSV**.
- **Students' own phones/laptops:** students press **Download my result (CSV)** after submitting and send you the file. On `instructor.html`, press **Import CSV files**, select all of them at once, then **Export CSV** to get one combined spreadsheet.

The CSV includes: student name, student number, attempt, score, total items, percentage, PASSED/FAILED, correct, incorrect, unanswered, auto-submitted, time used, start and completion date/time, and exam version.

### With the Google Sheets backend
Every start and every result is written to your Google Sheet automatically. See `BACKEND-SETUP.md`.

### Instructor PIN
`instructor.html` asks for a PIN. Only a SHA-256 hash of it is stored in `config.js`. To change it, sign in, use **Make a new PIN**, and paste the line it produces into `config.js`.

---

## The two-attempt rule: what works where

| | Browser storage only (default) | With Google Sheets backend |
|---|---|---|
| Refresh / close / reopen the page | ✅ Cannot reset attempts; unfinished attempt resumes with the timer still running | ✅ Same |
| Leave mid-exam and come back after time is up | ✅ Submitted automatically on return | ✅ Same |
| Same browser, any student number | ✅ Limit enforced | ✅ Limit enforced |
| Different device, browser, or incognito window | ❌ Gets a fresh count | ✅ Limit enforced by the server |
| Student clears browser data / uses DevTools | ❌ Can reset | ✅ Server still counts |
| All results in one place | ❌ Export per device / import CSVs | ✅ One Google Sheet |
| Setup and cost | None | ~10 minutes, free Google account |

Private/incognito windows that block storage are refused with a message, so the exam cannot be taken in a mode where refreshing would reset it.

**Answer key:** a static website must send the answers to the browser in order to grade. They are scrambled, not readable in plain view, but a student who knows JavaScript could recover them with DevTools. This is fine for a practice exam; for a graded, high-stakes exam, use a proctored platform with server-side grading.

---

## Deploying on GitHub Pages

1. Create a **public** repository named `pcep-practice-exam` on GitHub.
2. **Add file → Upload files**, select every file in this folder, and commit. There are no subfolders, so any upload method works.
3. **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)`. Save.
4. After 1–2 minutes the site is live at
   `https://<your-username>.github.io/pcep-practice-exam/`
   and the instructor page at `.../pcep-practice-exam/instructor.html`.

To update later, upload the changed file(s) to the same place and commit; Pages republishes within a minute or two.

---

## Tested

Automated browser tests (headless Chromium, desktop 1280 px and phone 390 px) covered: form validation, scoring (25 correct / 3 wrong / 2 blank → 25/30, 83.33%, PASSED), review answers matching the key for all 30 items, submit confirmation and cancel, 5-minute and 1-minute warnings, auto-submit at 0:00, time-used capped at the limit, refresh mid-exam (answers kept, timer not reset), the leave-page warning, attempt 1 → 2 → blocked (also after reload), abandoned attempts still counting, an attempt that expired while away being auto-submitted on return, student and instructor CSV export, CSV import with duplicate removal, per-device reset, no horizontal scrolling on phones, and the backend mode against a mock of `Code.gs` (limit enforced across fresh browser profiles, results synced, server-down refused).

Prepared by Dr. James A. Esquivel · AUF College of Computer Studies
