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
