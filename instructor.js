// =====================================================================
// instructor.js  -  THE INSTRUCTOR RESULTS PAGE
// ---------------------------------------------------------------------
// * Asks for the PIN and compares its SHA-256 hash with config.js
// * Lists every completed attempt saved in this browser
// * Imports result CSV files that students downloaded on their devices
// * Exports everything shown as one CSV file
// * Resets one student, or clears all data, on this device only
// =====================================================================

(function () {
  "use strict";

  const CFG = window.EXAM_CONFIG;
  const { LocalStore, rowsToCsv, csvToRows, downloadText } = window.ExamStore;
  const IMPORT_KEY = "pcepExam:imported:" + CFG.examVersion;  // imported CSV rows
  const SESSION_KEY = "pcepExam:instructorOk";                // "signed in" for this tab
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------
  // Turn text into its SHA-256 hash (hex string), using the browser's
  // built-in crypto library
  // ------------------------------------------------------------------
  async function sha256(text) {
    if (!window.crypto || !crypto.subtle) throw new Error("Secure hashing is only available over https.");
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ------------------------------------------------------------------
  // Imported rows live in their own storage slot
  // ------------------------------------------------------------------
  function loadImported() {
    try { return JSON.parse(localStorage.getItem(IMPORT_KEY)) || []; } catch (e) { return []; }
  }
  function saveImported(rows) {
    try { localStorage.setItem(IMPORT_KEY, JSON.stringify(rows)); } catch (e) { /* storage blocked */ }
  }

  // Local + imported rows, without duplicates (same number + attempt)
  function allRows() {
    const out = [];
    const seen = new Set();
    const add = (row, source) => {
      const key = String(row.studentNumber).toUpperCase() + "#" + row.attemptNumber;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(Object.assign({ source }, row));
    };
    LocalStore.allResultRows().forEach((r) => add(r, "This device"));
    loadImported().forEach((r) => add(r, "Imported"));
    // Sort by student number, then attempt
    return out.sort((a, b) =>
      String(a.studentNumber).localeCompare(String(b.studentNumber)) ||
      Number(a.attemptNumber) - Number(b.attemptNumber));
  }

  // ------------------------------------------------------------------
  // Draw the table and the summary numbers
  // ------------------------------------------------------------------
  function render() {
    const query = $("search").value.trim().toLowerCase();
    const rows = allRows().filter((r) =>
      !query || String(r.studentName).toLowerCase().includes(query) ||
      String(r.studentNumber).toLowerCase().includes(query));

    const body = $("rows");
    body.textContent = "";
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      const cells = [
        r.studentName, r.studentNumber, r.attemptNumber,
        r.score + " / " + r.totalItems, r.percentage + "%", r.status,
        r.autoSubmitted, r.timeUsed,
        r.completedAt ? new Date(r.completedAt).toLocaleString() : "", r.source,
      ];
      cells.forEach((value, i) => {
        const td = document.createElement("td");
        td.textContent = value === undefined ? "" : value;
        if (i === 5) td.className = r.status === "PASSED" ? "pass" : "fail";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    $("emptyMsg").hidden = rows.length > 0;

    // Summary numbers
    const students = new Set(rows.map((r) => String(r.studentNumber).toUpperCase()));
    const passedStudents = new Set(rows.filter((r) => r.status === "PASSED").map((r) => String(r.studentNumber).toUpperCase()));
    const avg = rows.length ? rows.reduce((sum, r) => sum + Number(r.percentage || 0), 0) / rows.length : 0;
    $("stRows").textContent = rows.length;
    $("stStudents").textContent = students.size;
    $("stPassed").textContent = passedStudents.size + " / " + students.size;
    $("stAvg").textContent = Math.round(avg * 10) / 10 + "%";

    return rows;
  }

  // ------------------------------------------------------------------
  // Buttons
  // ------------------------------------------------------------------
  function exportCsv() {
    const rows = render();
    const stamp = new Date().toISOString().slice(0, 10);   // e.g. 2026-10-21
    downloadText("PCEP-results-" + stamp + ".csv", rowsToCsv(rows));
  }

  async function importFiles(event) {
    const files = Array.from(event.target.files || []);
    const imported = loadImported();
    let added = 0, skipped = 0;
    for (const file of files) {
      const rows = csvToRows(await file.text());
      rows.forEach((r) => {
        if (!r.studentNumber || !r.attemptNumber) { skipped++; return; }
        imported.push(r);
        added++;
      });
    }
    saveImported(imported);
    $("importMsg").textContent = "Read " + files.length + " file(s): " + added + " row(s) imported" +
      (skipped ? ", " + skipped + " row(s) skipped (not a result file)." : ".") +
      " Duplicates of the same student and attempt are shown once.";
    event.target.value = "";     // allow importing the same file again later
    render();
  }

  function resetStudent() {
    const no = $("resetNo").value.trim().toUpperCase();
    if (!no) return;
    if (!LocalStore.getStudent(no)) {
      $("resetMsg").textContent = "No attempts for " + no + " are stored in this browser.";
      return;
    }
    if (!confirm("Remove all attempts for " + no + " from this browser? Their results here will be deleted.")) return;
    LocalStore.removeStudent(no);
    try { localStorage.removeItem("pcepExam:active:" + CFG.examVersion); } catch (e) { /* ignore */ }
    $("resetMsg").textContent = no + " was reset on this device.";
    render();
  }

  function clearAll() {
    if (!confirm("Delete ALL exam attempts and results stored in this browser? Export a CSV first if you need them.")) return;
    LocalStore.clearAll();
    saveImported([]);
    try { localStorage.removeItem("pcepExam:active:" + CFG.examVersion); } catch (e) { /* ignore */ }
    $("resetMsg").textContent = "All exam data on this device was cleared.";
    render();
  }

  async function makeHash() {
    const pin = $("newPin").value;
    if (pin.length < 6) { $("hashOut").hidden = false; $("hashOut").textContent = "Use at least 6 characters (10+ recommended)."; return; }
    $("hashOut").hidden = false;
    $("hashOut").textContent = 'instructorPinHash: "' + (await sha256(pin)) + '",';
  }

  function openPanel() {
    $("gate").hidden = true;
    $("panel").hidden = false;
    $("backendNote").hidden = !CFG.backendUrl;
    render();
  }

  async function onPin(event) {
    event.preventDefault();
    try {
      const hash = await sha256($("pin").value);
      if (hash === CFG.instructorPinHash) {
        sessionStorage.setItem(SESSION_KEY, "1");   // stay signed in for this tab
        openPanel();
      } else {
        $("pinError").textContent = "Incorrect PIN.";
        $("pinError").hidden = false;
      }
    } catch (e) {
      $("pinError").textContent = e.message;
      $("pinError").hidden = false;
    }
  }

  // ------------------------------------------------------------------
  // Start-up
  // ------------------------------------------------------------------
  $("pinForm").addEventListener("submit", onPin);
  $("search").addEventListener("input", render);
  $("btnExport").addEventListener("click", exportCsv);
  $("importFiles").addEventListener("change", importFiles);
  $("btnClearImported").addEventListener("click", () => {
    if (confirm("Remove all imported results from this page?")) { saveImported([]); render(); }
  });
  $("btnReset").addEventListener("click", resetStudent);
  $("btnClearAll").addEventListener("click", clearAll);
  $("btnHash").addEventListener("click", makeHash);

  let alreadyIn = false;
  try { alreadyIn = sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) { /* ignore */ }
  if (alreadyIn) openPanel();
})();
