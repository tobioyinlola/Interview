# Usage statistics (engagement analytics)

How the app reports what people do, on the website, the Windows/Mac apps and the Android/iPhone apps,
and how the back office reads it. First-party only: nothing is sent to a third party.

## The rule
An event cannot carry words. It is a **name from a fixed list**, a **route with its ids removed**, and a
few **short coded values or numbers**. There is no text column. The server drops anything else, so an
event cannot hold what a person typed, said, uploaded or was shown (CVs, answers, transcripts, notes,
company names). The server enforces this; the app's code is not trusted for it.

## What is collected
| Event | When | Values |
|---|---|---|
| `app_open` | The app is opened | `source` = cold / resume |
| `app_foreground` / `app_background` | It comes to the front / goes away | `seconds` = active time |
| `screen_view` | A screen opens | route (`/sessions/:id`, never the id) |
| `screen_engaged` | A screen is left | `seconds` really spent (see below) |
| `interaction` | A control marked `data-ev="..."`, or a link in a menu | `ev` = a code |
| `feature_used` | A feature succeeded (CV upload, interview start/end, ...) | `feature`, optional `detail` / `mode` |
| `step_view` | A step of onboarding / Auto-Apply setup is shown | `feature` = the flow, `step` |
| `ui_error` | The interface failed | `kind` = the error's type name, `source` |
| `app_loaded` | First screen is ready | `ms` |
| `connectivity` | The device goes offline / online | `state` |

Every batch also says the device it came from: `platform` (web, windows, macos, linux, android, ios),
`form_factor` (phone, tablet, desktop), `viewport` size class, app version and language.

**Time really spent** counts only while the app is in front *and* the person touched, clicked, typed or
scrolled in the last 30 seconds. The live interview is the exception: there people listen rather than
click, so being in front is enough.

## Who it is about
- A random `device_id` kept on the device (not a fingerprint), and a `session_id` that is one visit and
  ends after 30 minutes of nothing.
- Before sign-in events are anonymous. After sign-in they are attached to the account.
- The back office (`/admin/*`) is not measured: it is staff, not customers.

## Controls
- **Settings → Privacy → Usage statistics**: on until turned off, on **every device at once**. Turning it
  off **deletes** what was collected about the person.
- **Do Not Track** and **Global Privacy Control** are honoured. The check is also made on the server
  (`Sec-GPC`, `DNT` headers), so it holds whatever the app does.
- Deleting the account deletes its statistics (foreign key `ON DELETE CASCADE`).
- Kept `ANALYTICS_RETENTION_DAYS` (default 90) days; purged at start-up and hourly by the worker.
- The privacy page says all of this in plain words.

## How it is sent (it never gets in the way)
Events go into a small queue and are sent in batches of up to 50 to `POST /api/analytics/events` every
15 seconds (sooner when 20 have piled up, and as the page closes). A failed send is retried with a
growing wait; an offline device keeps at most 300 events (the oldest go first), stored locally so a
closed app sends them next launch. A batch the server refuses is not resent. The endpoint has its own
rate-limit bucket (`RATE_LIMIT_ANALYTICS_PER_MINUTE`, default 60) and a 64 KB body limit, so statistics
can never use up the allowance for real requests.

## Adding an event
1. Reuse an existing event name; a new name must be added to `EVENT_NAMES` in
   `backend/app/services/analytics.py` (with its meaning) or the server drops it.
2. In the app call `trackFeature("a_feature")` / `trackStep(flow, step)`, or put a static
   `data-ev="area.thing"` on a control. Pass **codes you chose**, never something a person typed.
3. A new `Feature` must be added to the `Feature` type in `frontend/src/analytics/index.ts`.

## Reading it
Back office → **Engagement** (`GET /api/admin/engagement?days=`): people active, visits, a typical visit,
time per person, stickiness, a day-by-day chart, split by app and by phone/tablet/computer, retention at
day 1/7/30 from sign-up, screens with time spent, what people use, interface errors, load time and app
versions. Counts and times only.

## Not done / to know
- **Consent.** Statistics are on until a person turns them off, with a clear switch and the browser's
  signals honoured. Some EU/UK readings of the cookie rules (ePrivacy) want opt-in even for first-party
  statistics that store an id on the device. This needs a decision from whoever owns compliance; if it
  should be opt-in, the app can ask once and keep `im-analytics-off` set until the person agrees.
- Queries read `client_events` directly (indexed by time, user, device, name, platform). Fine for
  thousands of people; at much larger scale add a daily roll-up table.
- Rate limiting is per API replica (as for the rest of the API).
