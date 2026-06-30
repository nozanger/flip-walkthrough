# Zanco — Claude Code Context

This file gives any Claude session (on any machine or account) full context to continue working on Zanco without needing prior conversation history.

---

## What Zanco Is

A real estate scope-of-work walkthrough app. Property investors use it to walk through a property, document every room/system with status + photos + notes, assign tasks to contractors, and track progress through deal stages (Walkthrough → Under Contract → Renovation).

**Live URL:** https://zanco.netlify.app  
**GitHub:** https://github.com/hayleycostas/flip-walkthrough  
**Owner email:** hayleykcostas@gmail.com

---

## Architecture — Single File App

The entire frontend is **one file: `index.html`**. It uses:
- React 18 via CDN (no build step)
- Babel standalone for in-browser JSX transpilation
- Firebase compat SDK v10.12.0 (app, auth, database, storage, messaging)
- All CSS is inline in a `<style>` block at the top of `index.html`
- All components are defined in a `<script type="text/babel">` block

There is **no npm build, no webpack, no TypeScript**. To deploy: push to GitHub, Netlify auto-deploys.

---

## Firebase Config (hardcoded in index.html — this is standard for Firebase web apps)

```js
const FB_API_KEY   = 'AIzaSyBcKTjlFLaExaFuSiuRusH2MDpCm8VzlDQ';
const FB_PROJECT   = 'zanco-e2a3f';
const FB_DB_URL    = 'https://zanco-e2a3f-default-rtdb.firebaseio.com';
const FB_SENDER_ID = '88624874228';
const FB_APP_ID    = '1:88624874228:web:ed33337ee08d4bc54394a1';
const VAPID_KEY    = 'BLB8Ep-YeyxOx06l-waZRYzldvy3FpRvuXm3yPOBcLrFRE6tZmEFHbFMve4_GyqOgEFcHkhN4BeLj-LXhdKW-Sc';
```

Firebase services enabled: **Auth (Email/Password), Realtime Database, Storage, Cloud Messaging (FCM)**

**CRITICAL — Gemini API key:** Stored in Firebase at `config/geminiKey`, NOT in source code. GitHub Secret Scanning will block any push that contains it. Access it via: `const getGeminiKey = () => dbGet('config/geminiKey')`

---

## Firebase Database Structure

```
projects/{projectId}/
  meta/      { address, sqft, curBed, curBath, futBed, futBath, date,
               ownerId, ownerName, stage, createdAt, updatedAt }
  members/   { uid: { name, email, role, addedAt } }
  tasks/     { taskId: { id, title, status, notes, assignedTo, tagged, urgent,
                         createdBy, createdAt, updatedAt, updatedBy } }
  data/      { catId/itemId: { status, notes, updatedAt, updatedBy } }
  photos/    { catId/itemId: { before: [], vision: [] },
               _summary: { photos:[], aiVision:[], floorPlan:[], videos:[] } }

userProjects/{uid}/{projectId}: true          ← which projects a user belongs to
invites/{token}/  { projectId, projectAddress, createdBy, createdByName, role, createdAt }
roster/{uid}/     { memberId: { id, name, email, phone, role, addedAt } }
users/{uid}/      { fcmToken, email, profile: { name, phone, title, company, updatedAt } }
config/geminiKey: "..."                        ← Gemini API key (never put in source)
```

---

## Netlify Setup

**Site:** https://zanco.netlify.app  
**Functions directory:** `netlify/functions/`  
**Build:** publish dir is `.` (root), no build command

### Environment Variables (set in Netlify dashboard → Site settings → Environment variables)
- `FIREBASE_SERVICE_ACCOUNT` — full JSON content of Firebase service account key (for FCM push via HTTP v1 API)
- `FIREBASE_DB_SECRET` — Firebase Realtime Database secret (for server-side DB reads)
- `RESEND_API_KEY` — Resend.com API key (for daily reminder emails)

### Netlify Functions
| File | Trigger | Purpose |
|------|---------|---------|
| `netlify/functions/notify-assignment.js` | POST from app | Push notification when a task is assigned to someone |
| `netlify/functions/notify-property-added.js` | POST from app | Push notification when added to a new property |
| `netlify/functions/daily-reminders.js` | Cron: `0 0 * * *` (7pm EST) | Daily push + email to everyone with open tasks |

All functions use `google-auth-library` (in `package.json`) to get OAuth2 tokens for FCM HTTP v1 API.

### netlify.toml notes
The `/firebase-messaging-sw.js` redirect must come **before** the `/*` catch-all or Netlify serves `index.html` for the service worker request, breaking push notifications:
```toml
[[redirects]]
  from = "/firebase-messaging-sw.js"
  to = "/firebase-messaging-sw.js"
  status = 200
  force = true

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entire app — all React components, CSS, Firebase init |
| `firebase-messaging-sw.js` | Service worker for background push notifications |
| `netlify/functions/notify-assignment.js` | Task assignment push notification |
| `netlify/functions/notify-property-added.js` | Property added push notification |
| `netlify/functions/daily-reminders.js` | Daily reminder push + email |
| `netlify.toml` | Netlify config: functions dir, cron schedule, redirects |
| `package.json` | Only dependency: `google-auth-library` (for Netlify functions) |
| `icon.png` | PWA icon (clipboard + hardhat, sage green) |

---

## App Structure — React Components

```
App                          ← root, handles auth state + invite token from URL
  LoginPage / SignupPage     ← email/password auth
  PropertyList               ← home screen with two tabs: Properties + Tasks
    AllTasksPage             ← Tasks tab: all open tasks grouped by property
    TeamModal                ← "My Team" roster — add/edit/delete team members
                                  Inline edit form with name cascade to all tasks
    ProfileModal             ← Edit own display name, phone, title, company
    AddPropertyModal         ← 2-step: property details → assign from roster
    InviteModal              ← Invite by SMS/email OR quick-add existing roster member
  WalkthroughView            ← property detail view
    Tabs: Project | Summary | Scope of Work (collapsed) or individual categories | Tasks | Team
    ScopeOverviewPage        ← shown when NOT in walkthrough stage; collapsible category list
    SummaryPage              ← overview, priorities, budget, AI renderings, floor plan, video
    TasksPage                ← per-property tasks (also used in Project management tab)
    ParticipantsPage         ← team members list + activity feed
    ItemCardView             ← single category walkthrough (swipe prev/next)
    SectionCard              ← individual item: status, notes, photos, voice notes
    ShareModal               ← generate + download printable HTML scope of work
```

---

## Property Stages

Properties have three stages controlled by pill buttons at the top of WalkthroughView:
- **Walkthrough** — all category tabs visible (Exterior, Kitchen, Bathroom, etc.)
- **Under Contract** — tabs collapse: Project | Summary | Scope of Work | Tasks | Team
- **Renovation** — same collapsed tab set as Under Contract

When stage is not `walkthrough`, individual scope-of-work category tabs are replaced by a single "📐 Scope of Work" tab that opens `ScopeOverviewPage` — a collapsible overview of all categories.

---

## Scope of Work Categories

Defined in the `CATEGORIES` array in `index.html`:
- Exterior (roof, siding, windows, exterior doors, front porch, gutters, landscaping, driveway)
- Kitchen (cabinets, countertops, appliances, kitchen floor, backsplash)
- Bathroom (toilet, vanity, tub/shower, bathroom floor, vents, tiles, lighting, fixtures, plumbing)
- Mechanical (HVAC, electrical panel, water heater, insulation, plumbing kitchen/bathroom, basement)
- Living Spaces (living room, bedrooms, hallway/stairs, basement)

Each item has: status (good/fair/poor/replace), notes, before photos, vision/inspiration photos, voice notes.

---

## Team / Roster System

- **Roster** (`roster/{ownerUid}`) — owner's saved team members, persists across projects
- When someone **accepts an invite** (clicks join link, signs up), they're auto-saved to the owner's roster
- **InviteModal** shows a "Your Team" section at the top — existing roster members + members from all other properties. Tap **Add** to add instantly (push notification sent, no email needed)
- **TeamModal** (My Team on home screen) — add/edit/delete roster members. Inline edit includes:
  - Name, email, phone, role fields
  - **"↺ Rename tasks"** yellow box: type old name/email → hit Update → renames `assignedTo` on all tasks across all properties
  - When saving a name change, cascade runs automatically matching old name + old email

### Name cascade logic (in TeamModal.cascadeName)
Scans `userProjects/{uid}` → for each project: updates `members/{id}/name` and `tasks/{tid}/assignedTo` where value matches any of the provided `matchNames` array.

---

## Push Notifications

- **iOS requirement:** App must be installed to home screen (PWA) before notifications work
- **Permission:** User taps "Enable" on a banner shown on the home screen after login
- **Token storage:** `users/{uid}/fcmToken` — saved when user enables notifications
- **Email storage:** `users/{uid}/email` — saved alongside token for server-side lookup
- **Service worker:** `firebase-messaging-sw.js` handles background messages
- **FCM API:** HTTP v1 (not legacy). Requires OAuth2 access token from service account via `google-auth-library`

---

## Tasks System

- Tasks stored at `projects/{projectId}/tasks/{taskId}`
- Fields: `title`, `status` (todo/done), `notes`, `assignedTo` (member name string), `tagged` (object of names→true), `urgent` (bool), `createdBy`, `createdAt`, `updatedAt`, `updatedBy`
- **Urgent tasks:** shown first in list, painted red on AllTasksPage
- **Auto-delete on done:** when marked done, task flashes checkmark for 800ms then is deleted from Firebase
- **Assignment notification:** calls `/.netlify/functions/notify-assignment` which looks up assignee's FCM token by UID, sends push
- Task photos: stored at `projects/{projectId}/tasks/{taskId}/photos/` in Firebase Storage

---

## Photos Architecture (critical — do not simplify)

Photos are stored separately from checklist data to keep real-time updates fast:
- Status/notes → `projects/{id}/data/{catId}/{itemId}`
- Photos → `projects/{id}/photos/{catId}/{itemId}` with `{ before: [], vision: [] }`

Two separate Firebase listeners merge via `buildMerged()` in `WalkthroughView`. **Three refs** are maintained:
- `dataRef` — raw Firebase data (no photos)
- `photosRef` — raw Firebase photos
- `mergedRef` — always-current merged state

**Critical bug fixed (multi-photo stale closure):** When `onAdd` fires multiple times rapidly (iOS fires one event per photo), each call must read `mergedRef.current` at call time. `updateItem` updates `mergedRef.current` **synchronously as its first operation** before any `await` or `setData`. This prevents each photo from overwriting the previous.

---

## AI Features

- **Gemini 1.5 Flash** analyzes walkthrough video frames
- Video frames extracted via `<canvas>` (one frame per second)
- Frames sent as base64 images to Gemini with a structured prompt
- Result: suggested status + notes per checklist item
- User reviews result in a modal then applies to scope of work
- Gemini key fetched from Firebase at runtime: `dbGet('config/geminiKey')`

---

## Design System

- **Theme:** Dark luxury glassmorphism
- **Background:** `#080e1a` (near-black navy)
- **Gradient:** `linear-gradient(160deg, #0d1829 0%, #080e1a 60%, #0a1020 100%)`
- **Accent gold:** `#e2b04a`
- **Section cards:** `rgba(255,255,255,.06)` with `backdrop-filter: blur(20px)`
- **Stage colors:**
  - Walkthrough: `rgba(30, 50, 90, 0.55)` (blue)
  - Contract: `rgba(15, 70, 65, 0.55)` (teal)
  - Renovation: `rgba(25, 60, 20, 0.55)` (green)
- **Urgent tasks:** `#dc3545` red background, white text
- **Bottom nav:** `rgba(10,18,35,0.85)` with backdrop blur
- **Modal background:** white (standard light modal, not dark)

---

## Firebase Helper Functions

```js
const dbSet    = (path, val) => getDb().ref(path).set(val);
const dbUpdate = (path, val) => getDb().ref(path).update(val);
const dbRemove = path => getDb().ref(path).remove();
const dbGet    = path => getDb().ref(path).once('value').then(s => s.val());
function dbListen(path, cb) {
  const ref = getDb().ref(path);
  ref.on('value', s => cb(s.val()));
  return () => ref.off('value'); // returns unsubscribe fn for useEffect cleanup
}
```

---

## Common Gotchas

1. **Never put Gemini key in source** — GitHub blocks the push. Always use `dbGet('config/geminiKey')`
2. **Firebase API key in source is fine** — that's the standard Firebase web app pattern
3. **Service worker redirect must be first** in `netlify.toml` before the `/*` catch-all
4. **`FIREBASE_SERVICE_ACCOUNT`** must be the full JSON pasted cleanly — no prefix characters
5. **iOS push needs home screen install** — web push doesn't work in Safari browser tab on iOS
6. **`clean(obj)`** strips `undefined` before Firebase writes: `JSON.parse(JSON.stringify(obj,(_,v)=>v===undefined?null:v))`
7. **Modal CSS is white background** — don't use white text colors inside modals
8. **Task auto-delete** — marking done deletes after 800ms; there's no "undo done" anymore
9. **Name cascade** — when renaming a team member, matches both old name AND old email to cover email-as-name accidents

---

## How to Continue Development

1. Clone repo: `git clone https://github.com/hayleycostas/flip-walkthrough`
2. Open `index.html` in browser to preview locally (or use any static server)
3. Edit `index.html` for all frontend changes
4. Edit `netlify/functions/*.js` for backend/notification changes
5. `git add . && git commit -m "..." && git push` — Netlify auto-deploys in ~30 seconds
6. To test Netlify functions locally: `netlify dev` (requires Netlify CLI + env vars set locally)

No build step. No `npm install` needed for the frontend. `package.json` only exists for Netlify function dependencies (`google-auth-library`).
