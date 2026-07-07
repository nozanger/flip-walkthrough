const DB = 'https://zanco-e2a3f-default-rtdb.firebaseio.com';

async function fbGet(path) {
  const secret = process.env.FIREBASE_DB_SECRET;
  const res = await fetch(`${DB}/${path}.json?auth=${secret}`);
  if (!res.ok) throw new Error(`Firebase read failed: ${res.status}`);
  return res.json();
}

async function fbUpdate(path, data) {
  const secret = process.env.FIREBASE_DB_SECRET;
  const res = await fetch(`${DB}/${path}.json?auth=${secret}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase write failed: ${res.status}`);
}

function parseDollar(val) {
  if (!val || val === '-' || val === '–') return 0;
  return parseFloat(String(val).replace(/[$,\s]/g, '')) || 0;
}

function parseCSVLine(line) {
  const cells = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { cells.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cells.push(cur.trim());
  return cells;
}

async function syncOne(propId, sheetId, tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const sheetsRes = await fetch(url, { redirect: 'follow' });

  if (!sheetsRes.ok) throw new Error(`Could not fetch sheet (${sheetsRes.status})`);

  const csv = await sheetsRes.text();
  if (!csv || csv.includes('<!DOCTYPE')) throw new Error('Sheet is not publicly accessible');

  const rows = csv.trim().split('\n').map(parseCSVLine);

  let categoryCol = -1, amountCol = -1, headerRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map(c => c.toLowerCase());
    const catIdx = r.findIndex(c => c.includes('category'));
    const amtIdx = r.findIndex(c => c.includes('amount'));
    if (catIdx !== -1 && amtIdx !== -1) {
      categoryCol = catIdx; amountCol = amtIdx; headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) throw new Error(`No header row with "Category" and "Amount" in tab "${tabName}"`);

  let materialsSpent = 0, laborSpent = 0, otherSpent = 0;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const category = String(row[categoryCol] || '').trim().toLowerCase();
    const amount = parseDollar(row[amountCol]);
    if (category === 'materials') materialsSpent += amount;
    else if (category === 'labor') laborSpent += amount;
    else if (category === 'other') otherSpent += amount;
  }

  materialsSpent = Math.round(materialsSpent * 100) / 100;
  laborSpent     = Math.round(laborSpent * 100) / 100;
  otherSpent     = Math.round(otherSpent * 100) / 100;

  await fbUpdate(`projects/${propId}/budget`, {
    materialsSpent, laborSpent, otherSpent,
    lastSync: Date.now(), sheetId, sheetTab: tabName,
  });

  return { materialsSpent, laborSpent, otherSpent };
}

exports.handler = async (event) => {
  const isCron = !event.httpMethod || event.httpMethod === 'GET';

  // Manual sync from app (POST)
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body); } catch {
      return { statusCode: 400, body: 'Invalid JSON' };
    }
    const { propId, sheetId, tabName } = body;
    if (!propId || !sheetId || !tabName) {
      return { statusCode: 400, body: 'Missing propId, sheetId, or tabName' };
    }
    try {
      const result = await syncOne(propId, sheetId, tabName);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 502, body: e.message };
    }
  }

  // Scheduled auto-sync — find all properties with a sheetId and sync them
  try {
    const projectIds = await fbGet('projects?shallow=true');
    if (!projectIds) return { statusCode: 200, body: 'No projects' };

    const results = [];
    await Promise.all(Object.keys(projectIds).map(async propId => {
      try {
        const budget = await fbGet(`projects/${propId}/budget`);
        if (!budget?.sheetId || !budget?.sheetTab) return;
        await syncOne(propId, budget.sheetId, budget.sheetTab);
        results.push({ propId, ok: true });
        console.log(`Auto-synced ${propId}`);
      } catch (e) {
        results.push({ propId, ok: false, error: e.message });
        console.error(`Auto-sync failed for ${propId}:`, e.message);
      }
    }));

    return { statusCode: 200, body: JSON.stringify({ synced: results.length, results }) };
  } catch (e) {
    console.error('Auto-sync error:', e);
    return { statusCode: 500, body: e.message };
  }
};
