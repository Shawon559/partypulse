# PartyPulse — PRD

**Theme:** Make the Party Better — festivals, birthdays, offsites, any gathering.
**Deliverable:** one static page. Plain HTML/CSS/JS, no framework, no build step.
Supabase JS via CDN is the only permitted dependency.

## Product intent

A host projects a four-letter code. Anyone in the room scans it and is inside in
about two seconds — no install, no account. The crowd requests tracks and votes
them into a live queue; taps and camera-read motion resolve into one energy number
the person running the music can act on mid-set.

The single design constraint that drives every decision: **a stranger holding a
drink will not download an app.** Anything that adds a step before participation is
cut.

## Operating rules

- One task per iteration. Append to `CURRENT_STATE.md`; never delete from it.
- Commit after every successful change.
- A task is done only when its `Done when:` line is objectively true — verified by
  the automated browser suite, not by inspection.
- No hardcoded room code anywhere. The code from the URL or input drives every query.
- No npm, no `package.json`, no build tooling in the deliverable.

## Tasks

**T1 — Entry: create and join**
Random four-letter code (no `I`/`O`, which misread on a projector), inserted into
`rooms`. Join by typed or pasted code.
*Done when:* creating a room routes to a room whose displayed code matches the URL
hash, and a second browser tab joining by that code lands in the same room.

**T2 — Song queue**
Text input inserts into `songs` with `room_code`. List sorts by votes descending,
ties broken by insertion time.
*Done when:* a song added in tab A appears in tab B within 2s with no refresh.

**T3 — Upvoting**
Per-row upvote, +1 each press, atomic under concurrency.
*Done when:* upvoting in tab B changes the visible sort order in tab A within 2s.

**T4 — Vibe check**
Two large tap targets, fire and sleepy, each inserting into `vibes`. Counts cover a
rolling five-minute window so the reading reflects the room now, not the whole night.
*Done when:* taps in one tab update the counter in another, and taps older than five
minutes stop counting.

**T5 — Realtime transport**
Supabase Postgres change events, subscribed per room. Push, never polling.
`BroadcastChannel` keeps tabs on one device in sync so the flow is demoable before
credentials exist.
*Done when:* no interval timer drives sync, and the app works fully with no
credentials configured.

**T6 — Mobile-first layout**
375px is the primary target; the room is used on phones held one-handed, so the vibe
controls sit in the thumb zone.
*Done when:* no horizontal scroll at 375px on entry or room, and the vibe dock is
reachable without moving the hand.

**T7 — Scannable QR**
The code must be joinable by camera, since that is the product's only onboarding path.
*Done when:* the rendered QR decodes back to the exact room URL with an independent
decoder — not merely renders.

**T8 — Pulse Cam**
Read crowd movement from the camera and feed the energy meter, so the reading survives
a crowd too busy dancing to tap. Frame differencing and beat estimation run on-device;
no frame is uploaded or stored.
*Done when:* motion registers a non-zero score against a live camera, a BPM estimate
appears, vibes are auto-fed rate-limited, and stopping releases the camera.

**T9 — Set recap**
One tap copies the ranked tracklist and final energy split.
*Done when:* recap text contains every queued track in rank order with vote counts.

**T10 — Stability**
*Done when:* zero console errors across the full flow, and camera denial, missing
`BroadcastChannel`, and blocked clipboard each degrade to a working app.

**T11 — Go-to-market and business case**
*Done when:* `README.md` states a specific beachhead customer, a first acquisition
channel that costs no ad spend, an honest growth loop, who pays and who does not,
a bottom-up market estimate, and a defensibility argument that does not overclaim.

## Non-goals

Accounts, playback integration, and moderation tooling are deliberately out of scope.
Each adds a step before participation, and the product's entire thesis is that the
first step must be free.
