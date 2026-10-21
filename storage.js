// =====================================================================
// storage.js  -  WHERE ATTEMPTS AND RESULTS ARE SAVED
// ---------------------------------------------------------------------
// Two layers:
//   1. LocalStore  - the browser's localStorage. Always used. It keeps
//      every attempt (including one in progress) so a page refresh or
//      reopening the site cannot reset the attempt counter.
//   2. Backend     - OPTIONAL. Only used when EXAM_CONFIG.backendUrl is
//      filled in. A Google Apps Script web app that counts attempts
//      centrally and writes results to a Google Sheet.
// =====================================================================

(function () {
  "use strict";   // makes JavaScript report common mistakes as errors

  const CFG = window.EXAM_CONFIG;

  // One storage "drawer" per exam version, e.g. "pcepExam:pcep-30-02-practice-v1"
  const STORE_KEY = "pcepExam:" + CFG.examVersion;

  // ------------------------------------------------------------------
  // Small helper: is localStorage usable in this browser at all?
  // (It can be blocked in some private modes or by strict settings.)
  // ------------------------------------------------------------------
  function storageWorks() {
    try {
      const testKey = "__pcep_test__";
      window.localStorage.setItem(testKey, "1");   // try to write
      window.localStorage.removeItem(testKey);     // and clean up
      return true;
    } catch (e) {
      return false;                                // writing failed
    }
  }

  // ==================================================================
  // LocalStore
  // Shape of the saved data:
  // {
  //   students: {
  //     "21-0123-456": {
  //        name: "Juan Dela Cruz",
  //        attempts: [ { attemptNo, status, startedAt, deadline, ... } ]
  //     }
  //   }
  // }
  // ==================================================================
  const LocalStore = {
    available: storageWorks(),

    // Read everything from localStorage (or an empty structure)
    load() {
      if (!this.available) return { students: {} };
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        const data = raw ? JSON.parse(raw) : null;
        // Guard against damaged data: always return the right shape
        if (data && typeof data === "object" && data.students) return data;
      } catch (e) {
        console.warn("Saved exam data could not be read:", e);
      }
      return { students: {} };
    },

    // Write everything back to localStorage
    save(data) {
      if (!this.available) return false;
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
        return true;
      } catch (e) {
        console.warn("Exam data could not be saved:", e);
        return false;
      }
    },

    // Get one student's record, or null if this browser never saw them
    getStudent(studentNo) {
      return this.load().students[studentNo] || null;
    },

    // Create or update one student's record
    putStudent(studentNo, record) {
      const data = this.load();
      data.students[studentNo] = record;
      return this.save(data);
    },

    // Remove one student (instructor tool, e.g. on a shared lab PC)
    removeStudent(studentNo) {
      const data = this.load();
      delete data.students[studentNo];
      return this.save(data);
    },

    // Remove everything for this exam version (instructor tool)
    clearAll() {
      if (!this.available) return;
      window.localStorage.removeItem(STORE_KEY);
    },

    // Flatten all SUBMITTED attempts into simple rows for tables / CSV
    allResultRows() {
      const rows = [];
      const students = this.load().students;
      for (const studentNo of Object.keys(students)) {
        const s = students[studentNo];
        for (const a of s.attempts || []) {
          if (a.status === "submitted") rows.push(toResultRow(studentNo, s.name, a));
        }
      }
      return rows;
    },
  };

  // ------------------------------------------------------------------
  // Turn one attempt into the "result record" required by the spec
  // ------------------------------------------------------------------
  function toResultRow(studentNo, name, a) {
    return {
      studentName: name,
      studentNumber: studentNo,
      attemptNumber: a.attemptNo,
      score: a.score,
      totalItems: a.total,
      percentage: a.percent,
      status: a.passed ? "PASSED" : "FAILED",
      correct: a.score,
      incorrect: a.incorrect,
      unanswered: a.unanswered,
      autoSubmitted: a.autoSubmitted ? "Yes" : "No",
      timeUsed: formatDuration(a.timeUsedSec),
      startedAt: a.startedAt,
      completedAt: a.submittedAt,
      examVersion: CFG.examVersion,
    };
  }

  // 1234 seconds -> "20:34"
  function formatDuration(totalSec) {
    totalSec = Math.max(0, Math.round(totalSec || 0));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  // ==================================================================
  // CSV helpers (used by results page and instructor page)
  // ==================================================================
  const CSV_COLUMNS = [
    ["studentName", "Student Name"],
    ["studentNumber", "Student Number"],
    ["attemptNumber", "Attempt"],
    ["score", "Score"],
    ["totalItems", "Total Items"],
    ["percentage", "Percentage"],
    ["status", "Status"],
    ["correct", "Correct"],
    ["incorrect", "Incorrect"],
    ["unanswered", "Unanswered"],
    ["autoSubmitted", "Auto-submitted"],
    ["timeUsed", "Time Used (m:ss)"],
    ["startedAt", "Started At"],
    ["completedAt", "Completed At"],
    ["examVersion", "Exam Version"],
  ];

  // Wrap a value in quotes and double any quotes inside it (CSV rule)
  function csvCell(value) {
    let text = value === undefined || value === null ? "" : String(value);
    // Stop spreadsheet "formula injection": a cell starting with = + - @
    // could run as a formula when opened in Excel. A leading ' prevents it.
    if (/^[=+\-@]/.test(text) && isNaN(Number(text))) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function rowsToCsv(rows) {
    const header = CSV_COLUMNS.map((c) => csvCell(c[1])).join(",");
    const lines = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c[0]])).join(","));
    // ﻿ tells Excel the file is UTF-8 (so names with ñ display correctly)
    return "﻿" + [header].concat(lines).join("\r\n");
  }

  // Read a CSV made by rowsToCsv back into row objects (instructor import)
  function csvToRows(text) {
    text = text.replace(/^﻿/, "");             // drop the UTF-8 marker
    const records = parseCsv(text);
    if (records.length < 2) return [];
    const header = records[0];
    // Map each column title back to its field name
    const fieldFor = {};
    CSV_COLUMNS.forEach(([field, title]) => (fieldFor[title] = field));
    return records.slice(1).filter((r) => r.length > 1).map((cells) => {
      const row = {};
      header.forEach((title, i) => {
        const field = fieldFor[title];
        if (field) row[field] = (cells[i] || "").replace(/^'/, "");
      });
      return row;
    });
  }

  // Minimal CSV parser that understands quoted cells with commas/quotes
  function parseCsv(text) {
    const out = [];
    let row = [], cell = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }   // escaped quote
        else if (ch === '"') inQuotes = false;                          // closing quote
        else cell += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;                   // \r\n counts once
        row.push(cell); out.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); out.push(row); }
    return out;
  }

  // Make the browser download a text file
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  }

  // ==================================================================
  // Backend (optional Google Apps Script web app)
  // ==================================================================
  const Backend = {
    enabled: Boolean(CFG.backendUrl),

    // Ask the server how many attempts this student has used
    async status(studentNo) {
      const url = CFG.backendUrl + "?action=status&version=" +
        encodeURIComponent(CFG.examVersion) + "&sn=" + encodeURIComponent(studentNo);
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error("Server answered " + res.status);
      return res.json();          // { ok, attemptsUsed, results: [...] }
    },

    // Send something to the server. "text/plain" avoids an extra
    // browser permission check (CORS preflight) that Apps Script rejects.
    async post(payload) {
      const res = await fetch(CFG.backendUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ version: CFG.examVersion }, payload)),
      });
      if (!res.ok) throw new Error("Server answered " + res.status);
      return res.json();
    },

    // Register the start of an attempt; the server refuses if the limit is reached
    startAttempt(studentNo, name, attemptNo) {
      return this.post({ action: "start", sn: studentNo, name, attemptNo, maxAttempts: CFG.maxAttempts });
    },

    // Record a finished attempt
    submitResult(row) {
      return this.post({ action: "result", sn: row.studentNumber, row });
    },
  };

  // Make these available to the other scripts
  window.ExamStore = { LocalStore, Backend, toResultRow, rowsToCsv, csvToRows, downloadText, formatDuration, CSV_COLUMNS };
})();
