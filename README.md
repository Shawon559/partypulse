# PartyPulse

**Make the party better.** The crowd picks the next track. The room shows how it feels.

A single-page web app for live gatherings. A host projects a four-letter code; anyone
scans it and is inside the room in about two seconds — no install, no account, no login.
From there the crowd requests tracks, upvotes them into a live-sorted queue, and taps
how the room feels. A rolling five-minute energy meter turns those taps into one number
the person running the music can act on mid-set.

Built with plain HTML, CSS and JavaScript. No framework, no build step.
Supabase provides realtime sync; there are no other dependencies.

---

## What it does

**Zero-friction join.** Four letters, no `I` or `O` — those misread on a projector at
distance. A guest scans the QR or types the code. That is the entire onboarding.

**Live queue.** Requests sort by votes, highest first, ties broken by who asked first.
Re-ranking is animated so a track visibly overtaking another is legible from across a
room. Every client updates within about a second, pushed over WebSockets — never polled.

**Energy meter.** Fire and sleepy taps over a rolling five-minute window resolve to a
single percentage. Old taps age out, so the number reflects the room *now*, not the
cumulative night. The whole page shifts hue with it: cool blue when the floor is dying,
hot red when it is going off. A DJ can read it from the booth without reading text.

**Pulse Cam — on-device crowd vision.** Point a phone at the floor. Frames are
downsampled to 64×48 luma and differenced against each other; the mean delta is a motion
score, and peaks in that signal are footfalls, so their median spacing gives a live BPM
estimate. Sustained motion feeds the energy meter automatically, so the reading keeps
working when the crowd is too busy dancing to tap. No frame is uploaded, recorded, or
sent anywhere — the analysis runs entirely in the browser tab.

**Set recap.** One tap copies the ranked tracklist and final energy split. The person who
ran the music wants that at 3am; it is also the artefact they post the next day.

---

## Run it

Any static server. No build.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

It works immediately with no backend: tabs on one machine stay in sync over
`BroadcastChannel`, which is enough to demo the whole flow. For phone-to-phone sync
across the internet, add Supabase credentials via the **LOCAL** chip on the entry screen
(stored per-browser), or paste them into the two constants at the top of `app.js`.
The chip's panel carries the exact SQL schema to run.

---

## Go-to-market

### Who this is for, specifically

Not "event organisers." The buyer is **the one person deciding what plays next** — and at
the events worth winning first, that person is a student.

**Beachhead: Korean university festivals (대동제).** Roughly 200 universities run
multi-day campus festivals, concentrated in May and September. Each has a student
committee running stages for crowds of 500–5,000, with a projector already pointed at the
audience and effectively no software budget. They are reachable directly — committees
publish contact details, and one conversation covers a three-night event.

**Second: small Hongdae, Itaewon and Seongsu venues.** Weekly-residency DJs and the
150–400-capacity rooms they play. Lower ceremony, higher frequency, and unlike a campus
committee they have a budget line.

Why zero-install is the whole product here: a guest at a one-night event will not download
an app. Every competing "request a song" product dies at that step. A URL from a QR code
is the only onboarding a stranger completes while holding a drink.

### First acquisition channel

Direct organiser outreach, not paid ads. The unit of acquisition is one organiser, and one
organiser delivers hundreds of scans on a single night — so the constraint is conversations,
not spend.

1. **Campus committees, one by one.** A finite, enumerable list of about 200 schools with
   published contacts and a known seasonal calendar. This is a few hundred emails, not a
   media buy.
2. **The projected code is the advertisement.** Every event puts the product on a wall in
   front of hundreds of people. Acquisition cost for a guest is zero.
3. **Short video of the meter reacting.** The energy bar swinging as a drop lands is
   legible in about three seconds without audio or explanation, which is the bar for a
   Reel to travel.

### Growth loop, honestly

The loop most decks would claim here is guest → host. It is real but weak: most people who
scan a code at a party will never run a party. Assuming otherwise is how these models
produce a fake K-factor above 1.

The loop that actually compounds is **frequency per host**:

```
one organiser  →  runs an event  →  projects a code  →  hundreds scan
      ↑                                                       │
      └──────── runs the next one ←───── small share ever host┘
```

A campus committee runs three consecutive nights and comes back next semester. A resident
DJ plays weekly. So the growth question is not "what is K" but **"how many events does one
retained host run per year"** — and for both beachhead segments the honest answer is
between three and fifty.

Guest → host conversion is a bonus on top, not the engine. If it lands anywhere in the
low single-digit percentages it materially shortens payback; the plan does not require it.

### Retention

- **The recap.** The tracklist and energy split are what a host wants after the night, and
  it is the thing they post — retention and distribution in the same action.
- **Events are inherently recurring.** Festivals are multi-night, residencies are weekly.
  Retention is a property of the segment, not a mechanic we bolt on.
- **Their own data accrues.** Which track actually spiked *their* room. That history only
  exists if they keep using it, and it is worth more each time.

---

## Business viability

### Revenue model and who pays

Guests never pay. Charging the crowd would reintroduce the friction the product exists to
remove. The host or the venue pays.

| Tier | Who | What they get |
|---|---|---|
| Free | Any host | Full core flow, unlimited guests, one room at a time |
| Pro host | Resident DJs, repeat organisers | Persistent code, set history, branding, recap export |
| Venue | 150–400 cap. rooms | Permanent code on table stickers, multi-night history, staff view |

**On willingness to pay, honestly:** a student committee running two festivals a year will
not pay, and should not be asked to. They are the *acquisition* channel. The venue with
something on every week is the *revenue* channel — it already pays for sound, lighting and
booking, and a line item at the scale of a single night's bar takings is not a hard sell
once the room has used it.

### Market size, bottom-up

Built from countable things rather than a top-down nightlife TAM:

- **Korean venues:** on the order of 10⁴ licensed entertainment venues nationally; the
  addressable slice is the few thousand that run programmed music nights weekly.
- **Campus:** ~200 universities × multi-day festivals × two seasons.
- **Agencies and private events:** weddings, company 회식 and offsites — high volume, low
  frequency per buyer, reachable only later through self-serve.

The venue slice is what carries revenue; campus is what carries distribution. Expansion
follows the same shape into Japan and Taiwan, where the campus-festival structure and the
density of small live venues both repeat.

### Defensibility

The app is copyable in a weekend. Anyone claiming otherwise about a four-letter room code
and a vote counter is not being straight with you. What is actually defensible:

1. **The crowd-response dataset.** Which tracks measurably move which rooms, by venue,
   city and hour. That is proprietary, it compounds with every night, and no competitor
   starts with it. Pulse Cam deepens it specifically because motion is an *objective*
   signal — it does not depend on whether a drunk crowd remembers to tap.
2. **Physical placement.** A code printed on a venue's tables is not swapped casually.
3. **Being early to the segment.** Real, and temporary. It buys the time to build 1.

### Unit economics

The honest version is that this is a static page plus a few database rows.

- **Serving cost** is a static file on a CDN and a handful of rows per event. Cost per
  event rounds to fractions of a cent; a busy night is thousands of small writes, not
  gigabytes.
- **Acquisition cost** is a conversation, amortised across every event that organiser
  subsequently runs — which is why frequency per host, not K-factor, is the metric to
  watch.
- **The real cost is sales time**, not infrastructure. That is what caps growth rate, and
  it is why the campus channel matters: one committee conversation puts the product in
  front of thousands of people who each cost nothing to reach.

Gross margin is structurally high. The model breaks only if hosts run one event and never
return — which is why retention is measured as *events per host per year* and nothing else.

---

## Technical notes

**Realtime, not polling.** Supabase Postgres change events are subscribed per room and
merged into local state as they arrive. Nothing is on an interval except the five-minute
window recalculation, which is local arithmetic.

**Works before the backend does.** `BroadcastChannel` keeps tabs on one device in sync
with no credentials at all, so the flow is demoable offline and degrades instead of
failing.

**The QR is a real QR.** Byte mode, error correction level M, versions 1–10, Reed-Solomon
over GF(256), all eight mask patterns scored by the standard penalty rules. It is written
inline because the project takes no dependencies — and a QR that renders but does not scan
would break the product's only onboarding path. Its output is verified byte-identical to a
reference encoder and decoded back with jsQR.

**Concurrent voting.** Votes go through a Postgres function so simultaneous voters
increment rather than overwrite each other:

```sql
create or replace function bump_vote(song_id uuid)
returns void language sql as $$
  update songs set votes = votes + 1 where id = song_id;
$$;
```

**Verification.** An automated Playwright suite drives two real browser tabs at 375×812
and asserts every success criterion: zero console errors, room creation and join, sub-2s
cross-tab song sync, live re-sorting on upvote, cross-tab vibe counts, and no horizontal
scroll. See `CURRENT_STATE.md` for the build log.

---

## Accessibility and resilience

Reduced-motion is respected — the grain, scanline and pulse all stop. Every control is
keyboard reachable, the code input handles paste and arrow keys, and errors are announced
via `role="alert"`. Camera denial, missing hardware, blocked clipboard and absent
`BroadcastChannel` all degrade to a working app rather than a broken one.
