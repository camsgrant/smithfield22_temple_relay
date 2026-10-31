/**
 * Temple Relay — Lambda Handler
 *
 * Routes:
 *   POST /submit  — Append a new ordinance row to the Google Sheet
 *   GET  /stats   — Return aggregated stats (totals, random male/female, sheet URL)
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

// Column order in the sheet (1-indexed, matching the header row)
// A=Timestamp, B=Name, C=Gender, D=Ordinance, E=Date, F=FamilySearchID
const COL = {
  TIMESTAMP: 0,
  NAME: 1,
  GENDER: 2,
  ORDINANCE: 3,
  DATE: 4,
  FAMILY_SEARCH_ID: 5,
};

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
  return {
    timestamp: row[COL.TIMESTAMP] || '',
    name: row[COL.NAME] || '',
    gender: row[COL.GENDER] || '',
    ordinance: row[COL.ORDINANCE] || '',
    date: row[COL.DATE] || '',
    familySearchId: row[COL.FAMILY_SEARCH_ID] || null,
  };
}

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

  // Append a new row: [Timestamp, Name, Gender, Ordinance, Date, FamilySearchID]
  const timestamp = new Date().toISOString();
  const values = [[timestamp, name.trim(), gender, ordinance, date, familySearchId || '']];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:F`,
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
    range: `${sheetName}!A2:F`,
  });

  const rows = result.data.values || [];
  const entries = rows
    .filter((row) => row.length >= 4) // must have at least name, gender, ordinance, date
    .map(rowToEntry);

  // Total count
  const totalOrdinances = entries.length;

  // Breakdown by ordinance type
  const byOrdinance = entries.reduce((acc, entry) => {
    if (entry.ordinance) {
      acc[entry.ordinance] = (acc[entry.ordinance] || 0) + 1;
    }
    return acc;
  }, {});

  // Random male and female (only entries with a FamilySearch ID get a link,
  // but we still pick from all entries)
  const males = entries.filter((e) => e.gender === 'Male');
  const females = entries.filter((e) => e.gender === 'Female');

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

    return response(404, { error: 'Not found.' });
  } catch (err) {
    console.error('Unhandled error:', err);
    return response(500, { error: 'Internal server error.' });
  }
};
