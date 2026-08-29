# PartyPulse — submission

**Live app:** https://shawon559.github.io/partypulse/
**Source:** https://github.com/Shawon559/partypulse

*Make the party better.* The crowd picks the next track. The room shows how it feels.

---

## What it is, in one paragraph

Whoever runs the music projects a four-letter code. Anyone scans it and is inside
the room in about two seconds — no install, no account, no login. From there the
crowd requests tracks and upvotes them into a live-sorted queue, and taps how the
room feels. A rolling five-minute energy meter turns those taps into one number the
DJ can read from the booth. Point a phone at the floor and **Pulse Cam** reads crowd
movement from the camera and feeds that meter automatically, because a crowd that is
actually dancing is too busy to tap buttons.

The single constraint behind every decision: **a stranger holding a drink will not
download an app.** Anything standing between a person and participating got cut.

---

## Evaluate it in two minutes

You need two devices, or two browser windows. One is the DJ, one is a guest.

1. **DJ:** open the live app → **Start a room**. You are the DJ on that device
   automatically, with no login.
2. **DJ:** tap the green **Join code** button → **Open projector view**.
   That is the screen you would put on a TV. Leave it up.
3. **Guest:** scan the QR with a phone camera, or open the same URL and type the
   four letters. You are in — notice you were never asked to sign up.
4. **Guest:** request a track, upvote it, tap 🔥. Watch the projector react.
5. **DJ:** press ✕ on a track to pull it. It disappears from the guest's phone too.

**Running the projector on a separate laptop:** the DJ's share sheet has
**Copy projector link** (a `?tv=1` URL). Paste it into any browser and it opens the
big-screen view directly. It is display-only and grants no DJ rights.

---

## The two roles

Guests never authenticate — that is the product thesis. The DJ is one person, so
the DJ can hold a secret.

| | Guest | DJ |
|---|---|---|
| Request tracks | yes | yes |
| Upvote | yes | yes |
| Vibe taps + energy meter | yes | yes |
| Pulse Cam (camera) | no | yes |
| Projector view | no | yes |
| Remove a track | no | yes |
| See the DJ PIN | no | yes |
| **Login required** | **never** | only to move DJ mode to a second device |

The room creator becomes DJ on that device with no login at all. A 4-digit PIN
exists only to claim DJ mode on a second device — the laptop driving the projector.
The PIN is hashed server-side and the column is revoked from the public role, so a
guest can ask the server whether a PIN is correct but can never read it:

```
select code             -> works
select *                -> permission denied
select code, host_hash  -> permission denied
```

---

## How it is built

Plain HTML, CSS and JavaScript. No framework, no build step, no `package.json`.
Three files: `index.html`, `app.js`, `style.css`. Supabase provides realtime sync
and is the only dependency.

- **Realtime, not polling.** Postgres change events are subscribed per room and
  merged into local state as they arrive. Nothing runs on an interval except the
  five-minute window recalculation, which is local arithmetic.
- **Works before the backend does.** `BroadcastChannel` keeps tabs on one device in
  sync with no credentials at all, so the flow degrades instead of failing.
- **The QR is a real QR.** Byte mode, error correction M, versions 1–10,
  Reed–Solomon over GF(256), all eight mask patterns scored by the standard penalty
  rules — written inline because the project takes no dependencies, and a QR that
  renders but does not scan would break the product's only onboarding path. Its
  output is byte-identical to a reference encoder and decodes back with jsQR.
- **Pulse Cam** downsamples frames to 64×48 luma and differences successive frames.
  Mean delta is a motion score; peaks in that signal are footfalls, so their median
  spacing gives a live BPM estimate. No frame is uploaded, recorded, or stored.
- **Concurrent voting** goes through a Postgres function so simultaneous voters
  increment rather than overwrite each other.

---

## Verify the claims yourself

66 automated tests drive real browsers — two isolated contexts with no shared
storage, so anything that syncs proves it travelled through the database.

```bash
npm i playwright jsqr pngjs qrcode
npx playwright install chromium
python3 -m http.server 8899          # from the project folder, in another shell
node tests/test.mjs                  # core flow, 375px layout, console errors
node tests/roletest.mjs              # DJ vs guest separation, PIN unlock
node tests/cloudtest.mjs             # cross-device sync through Supabase
node tests/projtest.mjs              # projector view
node tests/tvtest.mjs                # projector deep-link
node tests/test2.mjs                 # window ageing, recap, degradation paths
```

Point any of them at production instead by passing the URL, e.g.
`node tests/tvtest.mjs https://shawon559.github.io/partypulse/`.

| Suite | Covers | Result |
|---|---|---|
| `test` | create/join, live sync, upvote re-sort, 375px, zero console errors | 13 |
| `roletest` | role split, PIN unlock, DJ-only removal | 20 |
| `projtest` | projector renders and updates live | 11 |
| `tvtest` | projector deep-link, display-only rights | 9 |
| `test2` | 5-min window ageing, recap, camera denial, reduced motion | 7 |
| `cloudtest` | cross-device sync via Supabase | 6 |
| | | **66 / 66** |

---

## Also in this package

- `README.md` — go-to-market and business case
- `PRD.md` — the plan, with a testable `Done when:` line per task
- `CURRENT_STATE.md` — the build log, including every bug found and why it happened
- `screenshots/` — entry, DJ view, guest view, projector, Pulse Cam

## A note on the key in the source

`app.js` contains a Supabase **anon** key. That is a public client credential by
design — it carries no privileges beyond the row-level security policies in the
schema, and guests have no accounts, so this is the intended way to ship it. It is
not a secret. The service-role key is not in this package and never should be.
