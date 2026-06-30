const { GoogleAuth } = require('google-auth-library');

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

  const { memberEmail, address, adderName } = body;
  if (!memberEmail || !address) {
    return { statusCode: 400, body: 'Missing memberEmail or address' };
  }

  try {
    // Find user by email to get their FCM token
    const usersRes = await fetch(`${DB}/users.json?auth=${SECRET}`);
    const users = await usersRes.json();

    let fcmToken = null;
    if (users && typeof users === 'object') {
      const match = Object.values(users).find(u => u.email === memberEmail);
      if (match) fcmToken = match.fcmToken;
    }

    if (!fcmToken) {
      console.log(`No push token found for ${memberEmail} — skipping`);
      return { statusCode: 200, body: 'No push token for this user' };
    }

    const accessToken = await getFCMAccessToken();

    const title = '🏚 Added to a property';
    const notifBody = adderName
      ? `${adderName} added you to: ${address}`
      : `You've been added to: ${address}`;

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

    console.log(`Push sent to ${memberEmail} for property "${address}"`);
    return { statusCode: 200, body: 'Notification sent' };

  } catch (err) {
    console.error('notify-property-added error:', err);
    return { statusCode: 500, body: err.message };
  }
};
