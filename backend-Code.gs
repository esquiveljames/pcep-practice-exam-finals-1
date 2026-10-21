/**
 * =====================================================================
 * Code.gs  -  OPTIONAL CENTRAL BACKEND (Google Apps Script)
 * ---------------------------------------------------------------------
 * Paste this whole file into a Google Apps Script project that is
 * attached to a Google Sheet (see BACKEND-SETUP.md). It gives the
 * exam a free central server that:
 *   * counts attempts per student number on ANY device or browser
 *   * refuses a new attempt when the limit is reached
 *   * writes every start and every result as a row in the Sheet
 *
 * The exam talks to it with three requests:
 *   GET  ?action=status&sn=...&version=...   -> attempts used + results
 *   POST {action:"start",  sn, name, attemptNo, version}
 *   POST {action:"result", sn, row, version}
 * =====================================================================
 */

// ---- Settings: keep MAX_ATTEMPTS equal to maxAttempts in config.js ----
var MAX_ATTEMPTS = 2;
var SHEET_NAME = 'Attempts';

// Column titles, in order (row 1 of the sheet)
var HEADERS = [
  'Logged At', 'Event', 'Exam Version', 'Student Number', 'Student Name', 'Attempt',
  'Score', 'Total Items', 'Percentage', 'Status', 'Correct', 'Incorrect', 'Unanswered',
  'Auto-submitted', 'Time Used (m:ss)', 'Started At', 'Completed At'
];

/** Get the "Attempts" sheet, creating it (with headers) the first time. */
function getSheet_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Send a JavaScript object back to the browser as JSON text. */
function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Tidy a student number the same way the exam does (trim + capitals). */
function cleanNo_(value) {
  return String(value || '').trim().toUpperCase().slice(0, 20);
}

/** Stop spreadsheet formula injection: a cell starting with = + - @ */
function safeText_(value) {
  var text = String(value === undefined || value === null ? '' : value).slice(0, 120);
  return /^[=+\-@]/.test(text) && isNaN(Number(text)) ? "'" + text : text;
}

/** Read every row for one student and exam version. */
function rowsFor_(sn, version) {
  var values = getSheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {           // skip the header row
    var r = values[i];
    if (cleanNo_(r[3]) === sn && String(r[2]) === version) out.push(r);
  }
  return out;
}

/** Count starts and collect results for one student. */
function summary_(sn, version) {
  var rows = rowsFor_(sn, version);
  var starts = 0;
  var results = [];
  rows.forEach(function (r) {
    if (r[1] === 'start') starts++;
    if (r[1] === 'result') {
      results.push({
        studentNumber: r[3], studentName: r[4], attemptNumber: r[5],
        score: r[6], totalItems: r[7], percentage: r[8], status: r[9],
        correct: r[10], incorrect: r[11], unanswered: r[12],
        autoSubmitted: r[13], timeUsed: r[14], startedAt: r[15], completedAt: r[16],
        examVersion: r[2]
      });
    }
  });
  return { attemptsUsed: starts, results: results };
}

/** GET request: how many attempts has this student used? */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'status') return reply_({ ok: false, message: 'Unknown action.' });
  var sn = cleanNo_(p.sn);
  if (!sn) return reply_({ ok: false, message: 'Missing student number.' });
  var info = summary_(sn, String(p.version || ''));
  return reply_({ ok: true, attemptsUsed: info.attemptsUsed, results: info.results, maxAttempts: MAX_ATTEMPTS });
}

/** POST request: start an attempt, or record a result. */
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ ok: false, message: 'Bad request.' });
  }
  var sn = cleanNo_(data.sn);
  var version = String(data.version || '');
  if (!sn) return reply_({ ok: false, message: 'Missing student number.' });

  // A lock makes two quick requests from the same student wait in line,
  // so they can never both slip past the attempt limit.
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var info = summary_(sn, version);

    if (data.action === 'start') {
      if (info.attemptsUsed >= MAX_ATTEMPTS) {
        return reply_({ ok: false, attemptsUsed: info.attemptsUsed,
          message: 'The server shows all ' + MAX_ATTEMPTS + ' attempts are already used.' });
      }
      var attemptNo = info.attemptsUsed + 1;            // the SERVER decides the number
      sheet.appendRow([new Date(), 'start', version, sn, safeText_(data.name), attemptNo,
        '', '', '', 'IN PROGRESS', '', '', '', '', '', new Date().toISOString(), '']);
      return reply_({ ok: true, attemptNo: attemptNo });
    }

    if (data.action === 'result') {
      var r = data.row || {};
      // Ignore a duplicate result for the same attempt
      var already = info.results.some(function (x) { return String(x.attemptNumber) === String(r.attemptNumber); });
      if (!already) {
        sheet.appendRow([new Date(), 'result', version, sn, safeText_(r.studentName), Number(r.attemptNumber) || '',
          Number(r.score), Number(r.totalItems), Number(r.percentage), safeText_(r.status),
          Number(r.correct), Number(r.incorrect), Number(r.unanswered), safeText_(r.autoSubmitted),
          "'" + safeText_(r.timeUsed)  /* ' keeps 20:34 as text, not a clock time */, safeText_(r.startedAt), safeText_(r.completedAt)]);
      }
      return reply_({ ok: true });
    }

    return reply_({ ok: false, message: 'Unknown action.' });
  } finally {
    lock.releaseLock();
  }
}
