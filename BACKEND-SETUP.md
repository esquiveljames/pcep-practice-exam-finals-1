# Optional backend: Google Sheets + Apps Script (free)

Use this when you need the two-attempt limit to hold **across devices and browsers**, and want every result collected in **one Google Sheet** automatically. It takes about 10 minutes and costs nothing.

## 1. Create the Sheet and script
1. Go to <https://sheets.google.com> and create a blank spreadsheet, e.g. *PCEP Practice Results*.
2. In the sheet: **Extensions → Apps Script**.
3. Delete the sample code, paste the whole of `backend-Code.gs`, and click **Save**.
4. Check `MAX_ATTEMPTS` at the top of the script matches `maxAttempts` in `config.js`.

## 2. Publish it as a web app
1. **Deploy → New deployment**. Click the gear icon and choose **Web app**.
2. *Description*: PCEP exam. *Execute as*: **Me**. *Who has access*: **Anyone**.
   ("Anyone" is needed so students can reach it without signing in. They can only start attempts and send results; they cannot read the sheet.)
3. Click **Deploy**, then **Authorize access** and allow the permissions (Google shows a warning because it is your own unverified script: *Advanced → Go to project*).
4. Copy the **Web app URL** (it ends in `/exec`).

## 3. Connect the exam
In `config.js` set:
```js
backendUrl: "https://script.google.com/macros/s/XXXXXXXX/exec",
```
Upload `config.js` to GitHub.

## 4. Check it
Take one test attempt with a made-up student number. A sheet named **Attempts** appears with a `start` row and, after submitting, a `result` row. Delete those test rows afterwards.

## How it behaves
- The server, not the browser, decides each attempt number and refuses a third start.
- If the exam cannot reach the server, students are told so and **cannot start** (it fails closed, so the limit cannot be bypassed by going offline).
- If a result cannot be sent at the end, it is still saved on the device and the student is asked to download and send it to you.
- To give a student another attempt, delete their `start` rows (and result rows) for that exam version in the sheet.

## If you change Code.gs later
**Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.** The URL stays the same.

Note: this backend was tested against a local mock that copies its behaviour; please do the check in step 4 once on the real Google deployment.
