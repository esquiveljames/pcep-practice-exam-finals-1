// =====================================================================
// config.js  -  ALL EXAM SETTINGS IN ONE PLACE
// ---------------------------------------------------------------------
// This is the only file you normally need to edit. Change a value,
// save, and upload the file to GitHub. Students get the new setting
// the next time they open the page.
// =====================================================================

window.EXAM_CONFIG = {
  // ---- Text shown on the welcome screen and header ----
  examTitle: "PCEP-30-02 Practice Examination",          // big title
  institution: "Angeles University Foundation",            // top line
  department: "College of Computer Studies",               // second line
  instructorName: "Dr. James A. Esquivel",                 // shown on the welcome screen

  // ---- Timing and scoring ----
  durationMinutes: 40,     // exam length in minutes (official PCEP is 40)
  passingPercent: 70,      // minimum percentage needed to pass
  maxAttempts: 2,          // how many attempts each student number gets

  // ---- Question display ----
  shuffleQuestions: true,  // true = each attempt gets a different question order
  shuffleOptions: true,    // true = answer choices A-D are mixed per attempt
  showReview: true,        // true = show correct answers + explanations after submitting

  // ---- Student number format ----
  // A "regular expression" that a valid student number must match.
  // Default: 4 to 20 characters, letters, digits or dashes (e.g. 21-0123-456).
  studentNumberPattern: "^[A-Za-z0-9-]{4,20}$",
  studentNumberExample: "e.g. 21-0123-456",

  // ---- Change this name if you ever run a NEW version of the exam ----
  // Attempts are counted per examVersion. Changing it gives every
  // student a fresh set of attempts (useful for a new semester).
  examVersion: "pcep-30-02-practice-v1",

  // ---- Instructor results page (instructor.html) ----
  // This is a SHA-256 hash of the PIN, not the PIN itself, so the PIN
  // is never written in this public file. To change the PIN, open
  // instructor.html, use the "Make a new PIN" box, and paste the hash
  // it produces here. Use a long PIN (10+ characters): short ones can
  // be guessed from the hash.
  instructorPinHash: "c714b97a6dd22f451be77578febb9eeed92b33f5aceb3effca92b7f35783f7be",

  // ---- OPTIONAL central backend (Google Sheets + Apps Script) ----
  // Leave as "" to use browser storage only (works on GitHub Pages
  // with no setup, but attempts are counted per browser).
  // Paste your Apps Script Web App URL here to count attempts on a
  // central server and collect every result in one Google Sheet.
  // See BACKEND-SETUP.md for the 10-minute setup.
  backendUrl: "",
};
