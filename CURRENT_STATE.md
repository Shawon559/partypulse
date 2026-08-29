# PartyPulse — build log

Single-page live party engagement app. Plain HTML/CSS/JS, no build step.
Files: `index.html`, `style.css`, `app.js`.

## Success criteria
| # | Criterion | Status |
|---|-----------|--------|
| 1 | index.html loads with zero console errors | PASS |
| 2 | Creating a room generates a working shareable code | PASS |
| 3 | Joining via code loads that room's data | PASS |
| 4 | Song appears in a 2nd tab within 2s, no refresh | PASS |
| 5 | Upvote updates sort order live across tabs | PASS |
| 6 | Vibe taps update live counter across tabs | PASS |
| 7 | No horizontal scroll at 375px | PASS |
| 8 | No hardcoded room code — URL/input drives all queries | PASS |

Verified by an automated Playwright suite (2 real browser tabs, 375×812).

## Iterations
- **01** — Rebuilt from scratch against the spec. New visual direction: poster
  typography (Anton/Space Grotesk/Space Mono), acid-on-black palette, grain
  overlay, thumb-zone vibe dock. Dropped the previous emoji-card layout.
- **02** — Bug: `.sheet{display:flex}` outranked the `hidden` attribute, so
  invisible overlays swallowed every click. Added `[hidden]{display:none!important}`.
  Suite went 0 → 12 passing.
- **03** — Test defect, not app defect: upvote test clicked row index 1 twice, but
  rows re-sort after each vote. Retargeted by title. 13/13.
- **04** — QR encoder produced an unscannable code. Diffed my matrix against a
  reference encoder: data and mask were byte-perfect, 8 format-info modules wrong.
  Root cause: format bits placed LSB-first; canonical order is MSB-first, and the
  dark module was being overwritten by a format bit. Now 0/841 modules differ from
  reference across versions 3–6, and jsQR decodes the rendered SVG.
- **05** — Layout fixes: footer container background bled through its top padding
  as a grey band; toasts covered the room code. Footer is now a hairline list,
  toasts moved above the dock.
- **06** — Added Pulse Cam: on-device frame differencing (64x48 luma) for crowd
  motion, peak-spacing BPM estimate, and rate-limited auto-feeding of the energy
  meter. Verified against Chromium's synthetic camera. Added tap combo streak.
- **07** — Added `PRD.md` with a testable `Done when:` line per task, and
  `README.md` carrying the GTM and business case.
- **08** — Extended the suite to the criteria the first pass missed: five-minute
  window aging, recap ranking, camera-denial degradation, missing
  `BroadcastChannel`, and reduced-motion. 20/20 green across both suites.
- **09** — Connected Supabase. Found a real ordering bug: `enter()` backfilled
  history *then* subscribed, so rows inserted in that gap were lost forever — a
  guest joining just before the host queued a track never saw it. Now subscribes
  and waits for `SUBSCRIBED` before backfilling, and the backfill merges instead
  of replacing so an event landing mid-request survives. Cross-device suite went
  5/6 → 6/6 against two isolated browser contexts (no shared storage, so anything
  that syncs proves it travelled through Supabase).
- **10** — Deployed to GitHub Pages. Full suite re-run against the live URL, and
  the production QR verified to decode back to the live room link.
- **11** — Discoverability fix from user testing: the QR was hidden behind a small
  unstyled "Share" button, so the host could not find the one affordance the whole
  product depends on. The header button is now the accent colour with a QR glyph,
  and a "Let people in" prompt with a live QR thumbnail sits directly under the
  header. Added projector view: a full-screen read-only display for a TV or beamer
  with a large QR, the room code, and the live energy meter and top tracks. It
  renders from the same state as the phone view, so it repaints on realtime events
  without polling.
- **12** — Energy ramp rerouted the long way round the hue wheel
  (blue -> violet -> magenta -> red) so the neutral midpoint no longer lands on a
  green that fought the acid accent. 37/37 tests green across four suites.
- **13** — Split DJ and guest roles. Creator is DJ on that device with no login;
  a 4-digit PIN (hashed server-side, column revoked from the anon grant) moves DJ
  mode to a second device. DJ-only: Pulse Cam, projector, invite prompt, track
  removal. Guests keep queue, voting, vibe taps and the energy meter.
- **14** — Bug: track removal never reached other devices. Postgres sends only the
  primary key on DELETE under the default replica identity, so the `room_code`
  filter could never match and the event was dropped. Now unfiltered, matched by id.
- **15** — Bug: role CSS was scoped to the room screen, but the share sheet sits
  outside it, so guests still saw DJ controls inside the modal. Scoped to `body`.
- **16** — Verified the PIN column is genuinely unreadable: `select=code` succeeds
  while `select=*` and `select=host_hash` are both denied for the anon role.
  57/57 tests green across five suites.
