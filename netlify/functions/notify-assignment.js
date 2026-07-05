const { GoogleAuth } = require('google-auth-library');
const { alertAdmin } = require('./utils/alert');

const DB         = 'https://zanco-e2a3f-default-rtdb.firebaseio.com';
const APP_URL    = 'https://zanco.netlify.app';
const FB_PROJECT = 'zanco-e2a3f';

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const SECRET = process.env.FIREBASE_DB_SECRET;
  if (!SECRET || !process.env.FIREBASE_SERVICE_ACCOUNT) {
    return { statusCode: 500, body: 'Missing env vars' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { assigneeUid, taskTitle, address, assignerName } = body;
  if (!assigneeUid || !taskTitle) {
    return { statusCode: 400, body: 'Missing assigneeUid or taskTitle' };
  }

  try {
    // Look up FCM token for the assignee
    const tokenRes = await fetch(`${DB}/users/${assigneeUid}/fcmToken.json?auth=${SECRET}`);
    const fcmToken = await tokenRes.json();

    if (!fcmToken || typeof fcmToken !== 'string') {
      return { statusCode: 200, body: 'No push token for this user' };
    }

    const accessToken = await getFCMAccessToken();

    const title = `📋 New task assigned`;
    const notifBody = assignerName
      ? `${assignerName} assigned you: "${taskTitle}"${address ? ` — ${address}` : ''}`
      : `You have a new task: "${taskTitle}"${address ? ` — ${address}` : ''}`;

    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FB_PROJECT}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: { title, body: notifBody },
          webpush: { fcm_options: { link: APP_URL } },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('FCM error:', err);
      return { statusCode: 500, body: err };
    }

    console.log(`Push sent to uid ${assigneeUid} for task "${taskTitle}"`);
    return { statusCode: 200, body: 'Notification sent' };

  } catch (err) {
    console.error('notify-assignment error:', err);
    await alertAdmin('notify-assignment', err, `Task: "${taskTitle}" | Assignee UID: ${assigneeUid}`);
    return { statusCode: 500, body: err.message };
  }
};
