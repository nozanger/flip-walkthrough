const ADMIN_EMAIL = 'nozanger@gmail.com';
const FROM_EMAIL  = 'alerts@zanco.app';

async function alertAdmin(functionName, error, context = '') {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const subject = `🚨 Zanco alert: ${functionName} failed`;
  const body = `
    <div style="font-family:Arial,sans-serif;max-width:600px;padding:24px">
      <h2 style="color:#dc3545;margin-top:0">⚠️ Notification function failed</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;font-weight:bold;color:#555;width:140px">Function</td><td style="padding:8px">${functionName}</td></tr>
        <tr style="background:#f8f9fa"><td style="padding:8px;font-weight:bold;color:#555">Error</td><td style="padding:8px;color:#dc3545;font-family:monospace">${String(error?.message || error)}</td></tr>
        ${context ? `<tr><td style="padding:8px;font-weight:bold;color:#555">Context</td><td style="padding:8px">${context}</td></tr>` : ''}
        <tr style="background:#f8f9fa"><td style="padding:8px;font-weight:bold;color:#555">Time</td><td style="padding:8px">${new Date().toLocaleString('en-US',{timeZone:'America/Chicago'})}</td></tr>
      </table>
      <p style="margin-top:20px;font-size:13px;color:#888">
        This usually means the Firebase service account key needs to be updated in Netlify.<br>
        Go to Firebase Console → Project Settings → Service Accounts → Generate new key → update <code>FIREBASE_SERVICE_ACCOUNT</code> in Netlify → redeploy.
      </p>
    </div>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: ADMIN_EMAIL, subject, html: body }),
    });
  } catch (e) {
    console.error('Failed to send alert email:', e.message);
  }
}

module.exports = { alertAdmin };
