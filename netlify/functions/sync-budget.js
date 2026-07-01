const DB = 'https://zanco-e2a3f-default-rtdb.firebaseio.com';

// Write a value to Firebase RTDB using the DB secret
async function fbUpdate(path, data) {
  const secret = process.env.FIREBASE_DB_SECRET;
  const res = await fetch(`${DB}/${path}.json?auth=${secret}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase write failed: ${res.status}`);
}

// Parse a dollar string like "$1,462.18" or "1462.18" or "-" to a number
function parseDollar(val) {
  if (!val || val === '-' || val === '–') return 0;
  return parseFloat(String(val).replace(/[$,\s]/g, '')) || 0;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { propId, sheetId, tabName } = body;
  if (!propId || !sheetId || !tabName) {
    return { statusCode: 400, body: 'Missing propId, sheetId, or tabName' };
  }

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  console.log('ENV KEYS:', Object.keys(process.env).filter(k=>k.startsWith('GOOGLE')));
  console.log('API KEY present:', !!apiKey, 'length:', apiKey?.length);
  if (!apiKey) return { statusCode: 500, body: `GOOGLE_SHEETS_API_KEY not set. Env keys: ${Object.keys(process.env).join(',')}` };

  // Fetch columns A–E from the tab (enough for Materials, Labor, Other, Closing)
  const range = encodeURIComponent(`${tabName}!A:E`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;
  const sheetsRes = await fetch(url);
  if (!sheetsRes.ok) {
    const err = await sheetsRes.text();
    return { statusCode: 502, body: `Sheets API error: ${err}` };
  }

  const { values } = await sheetsRes.json();
  if (!values) return { statusCode: 404, body: 'No data found in tab' };

  // Find the TOTAL row — first cell in column A equals "TOTAL" (case-insensitive)
  const totalRow = values.find(r => String(r[0] || '').trim().toUpperCase() === 'TOTAL');
  if (!totalRow) {
    return { statusCode: 404, body: `No TOTAL row found in tab "${tabName}"` };
  }

  // Column layout from the sheet: B=Materials, C=Labor, D=Other, E=Closing Cost
  const materialsSpent = parseDollar(totalRow[1]);
  const laborSpent     = parseDollar(totalRow[2]);
  const otherSpent     = parseDollar(totalRow[3]);
  const closingCost    = parseDollar(totalRow[4]);

  await fbUpdate(`projects/${propId}/budget`, {
    materialsSpent,
    laborSpent,
    otherSpent,
    closingCost,
    lastSync: Date.now(),
    sheetId,
    sheetTab: tabName,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materialsSpent, laborSpent, otherSpent, closingCost, lastSync: Date.now() }),
  };
};
