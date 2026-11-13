/**
 * Temple Relay — Lambda Handler
 *
 * Routes:
 *   POST /submit  — Append a new ordinance row to the Google Sheet
 *   GET  /stats   — Return aggregated stats (totals, random male/female, sheet URL)
 *   GET  /people  — Return each person's ordinance progression, grouped by
 *                   FamilySearch ID (preferred) or normalized name
 *
 * Environment variables (set in Lambda console or via deployment script):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — The full JSON content of your service account key
 *   SPREADSHEET_ID               — The Google Sheet ID (from its URL)
 *   SHEET_NAME                   — The tab/sheet name (default: "Ordinances")
 *   SPREADSHEET_URL              — Public URL of the sheet (shown to users)
 */

const { google } = require('googleapis');

// ---------------------------------------------------------------------------
// CORS headers — allow requests from any origin.
// After deploying, you can tighten this to your CloudFront domain:
//   'Access-Control-Allow-Origin': 'https://your-cloudfront-domain.net'
// ---------------------------------------------------------------------------
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json',
};

// Column order in the sheet (0-indexed, matching the header row)
// A=Timestamp, B=Name, C=Gender, D=Ordinance, E=Date, F=FamilySearchID, G=Type
const COL = {
  TIMESTAMP: 0,
  NAME: 1,
  GENDER: 2,
  ORDINANCE: 3,
  DATE: 4,
  FAMILY_SEARCH_ID: 5,
  TYPE: 6, // "external" | "unavailable" | "reserved" | "" (empty = normal)
};

// Valid Type values (column G).  Empty string means a normal submission.
const TYPE_EXTERNAL    = 'external';
const TYPE_UNAVAILABLE = 'unavailable';
const TYPE_RESERVED    = 'reserved';

// ---------------------------------------------------------------------------
// Build an authenticated Google Sheets client from the service account JSON
// stored in the environment variable.
// ---------------------------------------------------------------------------
function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.');

  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ---------------------------------------------------------------------------
// Helper: pick a random item from an array (returns undefined if empty)
// ---------------------------------------------------------------------------
function randomItem(arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Helper: format a row array into a structured object
// ---------------------------------------------------------------------------
function rowToEntry(row) {
  // Normalise the Type value: lowercase, trim, default to empty string.
  const rawType = (row[COL.TYPE] || '').trim().toLowerCase();
    const type = [TYPE_EXTERNAL, TYPE_UNAVAILABLE, TYPE_RESERVED].includes(rawType) ? rawType : '';

  return {
    timestamp: row[COL.TIMESTAMP] || '',
    name: row[COL.NAME] || '',
    gender: row[COL.GENDER] || '',
    ordinance: row[COL.ORDINANCE] || '',
    date: row[COL.DATE] || '',
    familySearchId: row[COL.FAMILY_SEARCH_ID] || null,
    type, // '' | 'external' | 'unavailable' | 'reserved'
  };
}

// ---------------------------------------------------------------------------
// Ordered ordinance stages — the canonical progression sequence.
// A person is "ready for" the first stage in this list they haven't completed.
// ---------------------------------------------------------------------------
const STAGES = [
  'Baptism & Confirmation',
  'Initiatory',
  'Endowment',
  'Sealing to Parents',
  'Sealing to Spouse',
];

// ---------------------------------------------------------------------------
// POST /submit
// Body: { name, gender, ordinance, date, familySearchId }
// ---------------------------------------------------------------------------
async function handleSubmit(body) {
  const { name, gender, ordinance, date, familySearchId } = body;

  // Server-side validation
  if (!name || !gender || !ordinance || !date) {
    return response(400, { error: 'Missing required fields: name, gender, ordinance, date.' });
  }

  const validOrdinances = [
    'Baptism & Confirmation',
    'Initiatory',
    'Endowment',
    'Sealing to Spouse',
    'Sealing to Parents',
  ];
  if (!validOrdinances.includes(ordinance)) {
    return response(400, { error: 'Invalid ordinance value.' });
  }

  const validGenders = ['Male', 'Female'];
  if (!validGenders.includes(gender)) {
    return response(400, { error: 'Gender must be Male or Female.' });
  }

  const sheets = getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || 'Ordinances';

  // Append a new row: [Timestamp, Name, Gender, Ordinance, Date, FamilySearchID, Type]
  // Type is left blank for normal user submissions.
  const timestamp = new Date().toISOString();
  const values = [[timestamp, name.trim(), gender, ordinance, date, familySearchId || '', '']];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:G`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  return response(200, { success: true, message: 'Ordinance recorded.' });
}

// ---------------------------------------------------------------------------
// GET /stats
// Returns: { totalOrdinances, byOrdinance, randomMale, randomFemale, sheetUrl }
// ---------------------------------------------------------------------------
async function handleStats() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || 'Ordinances';

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    // Start at row 2 to skip the header row
    range: `${sheetName}!A2:G`,
  });

  const rows = result.data.values || [];
  const entries = rows
    .filter((row) => row.length >= 4) // must have at least name, gender, ordinance, date
    .map(rowToEntry);

  // Only count normal submissions (not external completions or unavailable markers)
  const countableEntries = entries.filter((e) => e.type === '');

  // Total count — only normal submissions
  const totalOrdinances = countableEntries.length;

  // Breakdown by ordinance type — only normal submissions
  const byOrdinance = countableEntries.reduce((acc, entry) => {
    if (entry.ordinance) {
      acc[entry.ordinance] = (acc[entry.ordinance] || 0) + 1;
    }
    return acc;
  }, {});

  // Random male and female — only normal submissions with a FamilySearch ID.
  const males = countableEntries.filter((e) => e.gender === 'Male' && e.familySearchId);
  const females = countableEntries.filter((e) => e.gender === 'Female' && e.familySearchId);

  const randomMale = randomItem(males) || null;
  const randomFemale = randomItem(females) || null;

  return response(200, {
    totalOrdinances,
    byOrdinance,
    randomMale,
    randomFemale,
    sheetUrl: process.env.SPREADSHEET_URL || null,
  });
}

// ---------------------------------------------------------------------------
// GET /people
// Returns each unique person with their completed stages, skipped stages,
// and the next stage they are ready for.
//
// Grouping strategy:
//   1. If a row has a non-empty FamilySearch ID, use that as the primary key.
//   2. Otherwise fall back to the lowercased, trimmed name.
//
// Type column (G) behaviour:
//   ''            — normal completion; counts in stats, advances pipeline.
//   'external'    — completed outside the tracker; advances pipeline, invisible
//                   to stats. Rendered identically to a normal completion.
//   'unavailable' — this ordinance does not apply to this person; shown as a
//                   greyed-out N/A bubble in the pipeline. readyFor skips it.
//                   "All complete" means all non-unavailable stages are done.
//   'reserved'    - this ordinance is reserved by someone. so it is not done.
//                   readyFor should not skip it. Should show up as a different
//                   color in the pipeline.
//
// Response shape:
// {
//   people: [
//     {
//       name: "John Smith",
//       gender: "Male",
//       familySearchId: "LZXX-XXX" | null,
//       completedStages: ["Baptism & Confirmation", "Initiatory"],
//       reservedStages:  ["Endowment"],
//       skippedStages:   ["Sealing to Spouse"],
//       readyFor: "Endowment"   // null if all applicable stages complete
//     },
//     ...
//   ]
// }
// ---------------------------------------------------------------------------
async function handlePeople() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheetName = process.env.SHEET_NAME || 'Ordinances';

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:G`,  // Now reads through column G
  });

  const rows = result.data.values || [];

  // Map keyed by a canonical ID string → person record
  const byFsId = {};   // fsId  → person record
  const byName = {};   // normalizedName → person record

  for (const row of rows) {
    if (row.length < 4) continue; // skip malformed rows

    const entry = rowToEntry(row);
    if (!entry.name && !entry.familySearchId) continue;

    const fsId = entry.familySearchId ? entry.familySearchId.trim() : null;
    const normalizedName = entry.name.trim().toLowerCase();

    // --- find or create the person record ---
    let person = null;

    if (fsId) {
      person = byFsId[fsId];
      if (!person) {
        person = byName[normalizedName];
        if (person) {
          person.familySearchId = fsId;
          byFsId[fsId] = person;
        } else {
          person = {
            name: entry.name.trim(),
            gender: entry.gender || '',
            familySearchId: fsId,
            completedStages: [],
            reservedStages: [],
            skippedStages: [],
          };
          byFsId[fsId] = person;
          byName[normalizedName] = person;
        }
      }
    } else {
      person = byName[normalizedName];
      if (!person) {
        person = {
          name: entry.name.trim(),
          gender: entry.gender || '',
          familySearchId: null,
          completedStages: [],
          reservedStages: [],
          skippedStages: [],
        };
        byName[normalizedName] = person;
      }
    }

    // --- merge this ordinance into the person record ---
    if (entry.ordinance && STAGES.includes(entry.ordinance)) {
      if (entry.type === TYPE_UNAVAILABLE) {
        // Mark as unavailable (N/A bubble) — takes precedence over completions
        if (!person.skippedStages.includes(entry.ordinance)) {
          person.skippedStages.push(entry.ordinance);
        }
      } else {
        if (entry.type == TYPE_RESERVED) {
          if (!person.reservedStages.includes(entry.ordinance)) {
            person.reservedStages.push(entry.ordinance);
	  }
	} else {
          // Both '' (normal) and 'external' advance the pipeline
          if (!person.completedStages.includes(entry.ordinance)) {
            person.completedStages.push(entry.ordinance);
          }
        }
      }
    }

    // Keep the most recent non-empty name/gender
    if (entry.name.trim()) person.name = entry.name.trim();
    if (entry.gender) person.gender = entry.gender;
  }

  // Collect unique person records (byFsId and byName may share references)
  const seen = new Set();
  const people = [];
  for (const p of [...Object.values(byFsId), ...Object.values(byName)]) {
    if (!seen.has(p)) {
      seen.add(p);

      // Sort completed stages in canonical order
      p.completedStages.sort((a, b) => STAGES.indexOf(a) - STAGES.indexOf(b));
      p.skippedStages.sort((a, b) => STAGES.indexOf(a) - STAGES.indexOf(b));
      p.reservedStages.sort((a,b) => STAGES.indexOf(a) - STAGES.indexOf(b));

      // Determine the next stage the person is ready for.
      //
      // A stage is "applicable" if it is not in skippedStages.
      // readyFor is the first applicable stage (in canonical order) that
      // has not been completed yet.
      //
      // If all applicable stages are complete, readyFor is null
      // (triggers the "All ordinances complete 🎉" badge).
      const applicableStages = STAGES.filter((s) => !p.skippedStages.includes(s));

      let readyFor = null;
      if (applicableStages.length === 0) {
        // All stages marked unavailable — treat as complete
        readyFor = null;
      } else if (p.completedStages.length === 0) {
        // Nothing done yet — ready for the first applicable stage
        readyFor = applicableStages[0];
      } else {
        // Find the first applicable stage that hasn't been completed
        readyFor = applicableStages.find((s) => !p.completedStages.includes(s)) || null;
      }
      p.readyFor = readyFor;

      people.push(p);
    }
  }

  // Sort: incomplete first (by how far along in STAGES their readyFor is),
  // then complete, then alphabetically within each group.
  people.sort((a, b) => {
    const aIdx = a.readyFor ? STAGES.indexOf(a.readyFor) : STAGES.length;
    const bIdx = b.readyFor ? STAGES.indexOf(b.readyFor) : STAGES.length;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.name.localeCompare(b.name);
  });

  return response(200, { people });
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------
function response(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Main Lambda handler
// Expects API Gateway proxy integration (event.httpMethod + event.path)
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  // Handle CORS preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const method = event.httpMethod;
    const path = event.path || '/';

    if (method === 'POST' && path.endsWith('/submit')) {
      const body = JSON.parse(event.body || '{}');
      return await handleSubmit(body);
    }

    if (method === 'GET' && path.endsWith('/stats')) {
      return await handleStats();
    }

    if (method === 'GET' && path.endsWith('/people')) {
      return await handlePeople();
    }

    return response(404, { error: 'Not found.' });
  } catch (err) {
    console.error('Unhandled error:', err);
    return response(500, { error: 'Internal server error.' });
  }
};
