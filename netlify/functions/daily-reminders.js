const { GoogleAuth } = require('google-auth-library');

const DB      = 'https://zanco-e2a3f-default-rtdb.firebaseio.com';
const APP_URL = 'https://zanco.netlify.app';
const FB_PROJECT = 'zanco-e2a3f';

// Get a short-lived OAuth2 token from the service account for FCM HTTP v1
async function getFCMAccessToken() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

async function sendPush(fcmToken, title, body, accessToken) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FB_PROJECT}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title, body },
        webpush: { fcm_options: { link: APP_URL } },
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
}

exports.handler = async () => {
  const SECRET    = process.env.FIREBASE_DB_SECRET;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const HAS_FCM   = !!process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!SECRET || !RESEND_KEY) {
    console.error('Missing env vars: FIREBASE_DB_SECRET or RESEND_API_KEY');
    return { statusCode: 500, body: 'Missing env vars' };
  }

  try {
    // Get FCM access token once (reuse for all messages)
    let fcmAccessToken = null;
    if (HAS_FCM) {
      try { fcmAccessToken = await getFCMAccessToken(); }
      catch(e) { console.warn('FCM auth failed, will email only:', e.message); }
    }

    // Get all project IDs (shallow = just the keys, fast)
    const topRes = await fetch(`${DB}/projects.json?auth=${SECRET}&shallow=true`);
    const projectIds = await topRes.json();
    if (!projectIds || typeof projectIds !== 'object') {
      console.log('No projects found');
      return { statusCode: 200, body: 'No projects' };
    }

    // assignments: email → { name, uid, items: [{title, address}] }
    const assignments = {};

    await Promise.all(Object.keys(projectIds).map(async projectId => {
      const [metaRes, membersRes, tasksRes] = await Promise.all([
        fetch(`${DB}/projects/${projectId}/meta.json?auth=${SECRET}`),
        fetch(`${DB}/projects/${projectId}/members.json?auth=${SECRET}`),
        fetch(`${DB}/projects/${projectId}/tasks.json?auth=${SECRET}`),
      ]);

      const [meta, members, tasks] = await Promise.all([
        metaRes.json(), membersRes.json(), tasksRes.json(),
      ]);

      if (!tasks || !members || !meta) return;

      // Build name → { email, uid } lookup from project members
      const nameToMember = {};
      Object.entries(members).forEach(([uid, m]) => {
        if (m.name) nameToMember[m.name] = { email: m.email, uid };
      });

      // Collect pending (non-done) tasks that have an assignee
      Object.values(tasks).forEach(task => {
        if (!task.assignedTo || task.status === 'done') return;
        const member = nameToMember[task.assignedTo];
        if (!member?.email) return;

        if (!assignments[member.email]) {
          assignments[member.email] = { name: task.assignedTo, uid: member.uid, items: [] };
        }
        assignments[member.email].items.push({ title: task.title, address: meta.address || projectId });
      });
    }));

    if (Object.keys(assignments).length === 0) {
      console.log('No pending assignments to notify');
      return { statusCode: 200, body: 'Nothing to send' };
    }

    // Fetch FCM tokens for all assignees in parallel
    const tokenMap = {}; // email → fcmToken
    if (fcmAccessToken) {
      await Promise.all(Object.entries(assignments).map(async ([email, data]) => {
        if (!data.uid) return;
        const r = await fetch(`${DB}/users/${data.uid}/fcmToken.json?auth=${SECRET}`);
        const token = await r.json();
        if (token && typeof token === 'string') tokenMap[email] = token;
      }));
    }

    // Send notifications
    const sends = Object.entries(assignments).map(async ([email, data]) => {
      const count = data.items.length;
      const label = `${count} task${count > 1 ? 's' : ''}`;
      const taskLines = data.items.map(t => `<li style="margin-bottom:6px"><strong>${t.title}</strong> — ${t.address}</li>`).join('');
      const taskLinesText = data.items.map(t => `  • ${t.title} — ${t.address}`).join('\n');

      // Send push notification if token available
      if (fcmAccessToken && tokenMap[email]) {
        try {
          await sendPush(tokenMap[email], `🏚 Zanco — ${label} waiting`, `Hi ${data.name}, you have ${label} assigned to you. Tap to open.`, fcmAccessToken);
          console.log(`Push sent to ${email}`);
        } catch(e) {
          console.warn(`Push failed for ${email}:`, e.message);
        }
      }

      // Also send email
      const html = `
        <div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto;padding:24px;color:#1a1a2e">
          <div style="background:#0f3460;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h1 style="color:white;margin:0;font-size:22px">🏚 Zanco</h1>
          </div>
          <p style="font-size:16px">Hi <strong>${data.name}</strong>,</p>
          <p style="font-size:15px;color:#444">You have <strong>${label}</strong> waiting for you:</p>
          <ul style="background:#f4f7fb;border-radius:10px;padding:16px 16px 16px 32px;font-size:14px;color:#1a1a2e;line-height:1.8">
            ${taskLines}
          </ul>
          <a href="${APP_URL}" style="display:inline-block;margin-top:20px;background:#0f3460;color:white;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:15px">
            Open Zanco →
          </a>
          <p style="margin-top:24px;font-size:12px;color:#aaa">You're receiving this because you have tasks assigned to you in Zanco. You'll get one reminder per day as long as tasks are open.</p>
        </div>
      `;
      const text = `Hi ${data.name},\n\nYou have ${label} waiting for you:\n\n${taskLinesText}\n\nLog in to Zanco:\n${APP_URL}\n\n— Zanco`;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Zanco <onboarding@resend.dev>',
          to: email,
          subject: `You have ${label} waiting on Zanco`,
          html,
          text,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`Email failed to ${email}:`, err);
      } else {
        console.log(`Email sent to ${email} (${count} tasks)`);
      }
    });

    await Promise.all(sends);
    return { statusCode: 200, body: `Notified ${Object.keys(assignments).length} assignees` };

  } catch (err) {
    console.error('daily-reminders error:', err);
    return { statusCode: 500, body: err.message };
  }
};
