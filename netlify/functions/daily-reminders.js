const DB = 'https://zanco-e2a3f-default-rtdb.firebaseio.com';
const APP_URL = 'https://zanco.netlify.app';

exports.handler = async () => {
  const SECRET = process.env.FIREBASE_DB_SECRET;
  const RESEND_KEY = process.env.RESEND_API_KEY;

  if (!SECRET || !RESEND_KEY) {
    console.error('Missing env vars: FIREBASE_DB_SECRET or RESEND_API_KEY');
    return { statusCode: 500, body: 'Missing env vars' };
  }

  try {
    // Get all project IDs (shallow = just the keys, fast)
    const topRes = await fetch(`${DB}/projects.json?auth=${SECRET}&shallow=true`);
    const projectIds = await topRes.json();
    if (!projectIds || typeof projectIds !== 'object') {
      console.log('No projects found');
      return { statusCode: 200, body: 'No projects' };
    }

    // assignments: email → { name, items: [{title, address}] }
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

      // Build name → email lookup from project members
      const nameToEmail = {};
      Object.values(members).forEach(m => {
        if (m.name && m.email) nameToEmail[m.name] = m.email;
      });

      // Collect pending (non-done) tasks that have an assignee
      Object.values(tasks).forEach(task => {
        if (!task.assignedTo || task.status === 'done') return;
        const email = nameToEmail[task.assignedTo];
        if (!email) return;

        if (!assignments[email]) {
          assignments[email] = { name: task.assignedTo, items: [] };
        }
        assignments[email].items.push({ title: task.title, address: meta.address || projectId });
      });
    }));

    if (Object.keys(assignments).length === 0) {
      console.log('No pending assignments to notify');
      return { statusCode: 200, body: 'Nothing to send' };
    }

    // Send one email per assignee
    const sends = Object.entries(assignments).map(async ([email, data]) => {
      const count = data.items.length;
      const taskLines = data.items
        .map(t => `<li style="margin-bottom:6px"><strong>${t.title}</strong> — ${t.address}</li>`)
        .join('');
      const taskLinesText = data.items.map(t => `  • ${t.title} — ${t.address}`).join('\n');

      const html = `
        <div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto;padding:24px;color:#1a1a2e">
          <div style="background:#0f3460;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h1 style="color:white;margin:0;font-size:22px">🏚 Zanco</h1>
          </div>
          <p style="font-size:16px">Hi <strong>${data.name}</strong>,</p>
          <p style="font-size:15px;color:#444">You have <strong>${count} task${count > 1 ? 's' : ''}</strong> waiting for you:</p>
          <ul style="background:#f4f7fb;border-radius:10px;padding:16px 16px 16px 32px;font-size:14px;color:#1a1a2e;line-height:1.8">
            ${taskLines}
          </ul>
          <a href="${APP_URL}" style="display:inline-block;margin-top:20px;background:#0f3460;color:white;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:15px">
            Open Zanco →
          </a>
          <p style="margin-top:24px;font-size:12px;color:#aaa">You're receiving this because you have tasks assigned to you in Zanco. You'll get one reminder per day as long as tasks are open.</p>
        </div>
      `;

      const text = `Hi ${data.name},\n\nYou have ${count} task${count > 1 ? 's' : ''} waiting for you:\n\n${taskLinesText}\n\nLog in to Zanco:\n${APP_URL}\n\n— Zanco`;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Zanco <onboarding@resend.dev>',
          to: email,
          subject: `You have ${count} task${count > 1 ? 's' : ''} waiting on Zanco`,
          html,
          text,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`Failed to send to ${email}:`, err);
      } else {
        console.log(`Sent reminder to ${email} (${count} tasks)`);
      }
    });

    await Promise.all(sends);
    return { statusCode: 200, body: `Sent ${Object.keys(assignments).length} emails` };

  } catch (err) {
    console.error('daily-reminders error:', err);
    return { statusCode: 500, body: err.message };
  }
};
