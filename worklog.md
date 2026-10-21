# Worklog

---
Task ID: 1
Agent: main
Task: Setup environment for PWA pool/snooker web game

Work Log:
- Loaded fullstack-dev skill, ran init script (dev server on port 3000)
- Installed socket.io + socket.io-client
- Pushed Prisma schema (Player, Match models with ELO rating fields) — already in sync
- Reviewed existing game engine: src/lib/game/{constants,physics,rules}.ts (8-ball pool, table-space 200x100 units)
- Reviewed websocket example pattern (mini-service on port 3003, XTransformPort gateway)

Stage Summary:
- Plan: bot AI + engine + render/sound libs → API routes (leaderboard/ELO) → socket.io mini-service → UI (menu/game/lobby/leaderboard) → PWA (manifest/sw/icons) → lint + browser verify

---
Task ID: 2-6
Agent: main
Task: Build complete game (engine, bot, UI, APIs, multiplayer, PWA)

Work Log:
- src/lib/game/bot.ts — simulation-based AI: ghost-ball candidates over (targets x pockets x powers), scores via full headless PhysicsSim runs, 3 difficulties (jitter/pick randomness/ball-in-hand placement search), break logic, safety fallback
- src/lib/game/engine.ts — PoolGame controller (rack, shoot, step, placeCue w/ ball-in-hand clearing + cue hiding, applySync for guest, snapshot)
- src/lib/game/render.ts — canvas renderer: wood frame, felt vignette, pockets, sights, cushions, shaded balls w/ stripes+numbers, sink animation, aim guide (ghost ball, target dir, cue deflect, cushion bounce), ball-in-hand ghost
- src/lib/game/sound.ts — WebAudio synth (ball click, cushion thud, pocket drop, cue strike, win chime)
- src/lib/game/net.ts — typed socket.io client singleton via /?XTransformPort=3003
- APIs: /api/players (register/lookup), /api/leaderboard (top100 + house bot seeding), /api/matches (POST ELO K=32, idempotent by client matchId; GET recent)
- mini-services/pool-server (port 3003): rooms create/join/quick-match, host-authoritative relay (shot, shot-result, place-cue, host-state/game-start), rematch flow, quick chat, stale room sweep
- UI: Menu (name + stats badges, difficulty picker), PoolTable (slingshot drag aim + release, tap-to-place ball in hand, keyboard arrows+space, DPR-aware, ResizeObserver), GameScreen (HUD player cards w/ groups+remaining dots, online sync incl. queued game-sync, bot scheduling, match recording, rematch/leave dialogs, quick chat), OnlineLobby (quick match/create/join code), Leaderboard (rankings + recent matches), PwaInstallButton
- PWA: manifest.webmanifest, sw.js (precache + SWR static + network-first nav), icons generated via sharp script (192/512/maskable/apple-touch), layout metadata+viewport
- Fixed ESLint (react-hooks v6): setState-in-effect, refs-in-render issues
- bun run lint passes; tsc clean for src/

Stage Summary:
- All features implemented; pool-server running on 3003 (log: pool-server.log); next: agent-browser verification desktop + mobile

---
Task ID: 7
Agent: main
Task: Fix user-reported issues — "no moving balls and cue"

Work Log:
- Root cause 1 (balls frozen): PoolGame.step() only copied sim positions into this.balls AFTER the shot settled → renderer drew the frozen pre-shot array for the whole shot, then everything teleported. Fix: publish this.balls = this.sim.balls every frame (src/lib/game/engine.ts).
- Root cause 2 (weak/dead shots): power computed as drag distance in TABLE units divided by a CSS-pixel max (clientWidth*0.55) → at desktop scale ~5x a 217px drag read as power 0.12; cue ball crept and fouled ("no ball contacted"). Fix: table-unit MAX_DRAG = 55 for 100% power, in both input handler and aim overlay (src/components/game/PoolTable.tsx).
- Added real cue stick renderer (maple shaft, dark wrap, butt cap, ferrule, leather tip, ground shadow) with pull-back by power + strike-lunge animation that fires the shot at contact for sync'd visuals/sound (src/lib/game/render.ts drawCueStick).
- PoolTable: strikeRef state machine (lunge 140ms, fire at t>=0.78), idle cue stick + guide always visible on your turn (fallback aim from last kb/hover angle), hover aim synced into kb angle so space-to-shoot matches mouse aim.
- Verified via agent-browser: desktop 1280x800 + iPhone 14 emulation — ball-in-hand placement, cue stick visible, break shots scatter the rack on both viewports, bot break works, no console/page errors, lint clean.

Stage Summary:
- Gameplay now feels alive: moving balls every frame, visible cue stick with strike animation, correct shot power across devices. Screenshots in shots/fix-*.png.

---
Task ID: 8
Agent: main
Task: Answer "how to draw the cue for power?" + make power mechanic visually obvious

Work Log:
- Added drawPowerGauge() in src/lib/game/render.ts: vertical PWR bar over right rail (green->amber->red fill, % readout, 25/50/75% ticks), new powerGauge field on DrawOpts
- PoolTable.tsx: computes gauge level each frame (drag power / keyboard charge / strike lunge), hidden during ball-in-hand and opponent turns
- GameScreen.tsx: clearer turn hint — "press & drag away from your target to pull the cue back (farther = more power), release to strike"
- Verified via agent-browser: 50px drag = 27%, 90px = 48%, 140px = 75% charged break; release fired strike lunge and scattered rack; sub-6% drags correctly discarded as misclicks; lint clean, no page errors. Screenshots shots/pwr-*.png

Stage Summary:
- Power drawing is now self-explanatory: slingshot drag with live gauge. Keyboard alt: hold Space to auto-oscillate power, release to fire; arrows to aim.

---
Task ID: 9
Agent: main
Task: Fix "ball hit the hole but not in" — pocket capture vs. drawn hole mismatch

Work Log:
- Root causes: (1) capture circle was pk.r - 0.2*BALL_R, smaller than the drawn hole, so balls visibly over the rim stayed up; (2) balls that crossed the rail line inside a mouth bounced off an invisible outer containment wall instead of dropping; (3) no jaw funnel, so shallow entries rattled out.
- physics.ts pocketCheck rewrite: rim capture (centre reaches drawn hole rim pk.r), lip rule (slow ball < 65 u/s within 0.4*BALL_R of rim topples in), sector-gated funnel pull (POCKET_PULL=300 * k^2 within pk.r + BALL_R, only inside the pocket mouth gap — corners: both rail-mouth bands, sides: |x-centre| < SIDE_MOUTH), committed rule (centre past rail line inside a mouth = potted into nearest pocket, replaces containment bounce), pot() helper.
- rules.ts canPlaceCue: reject placement within pk.r + 0.6*BALL_R of any pocket (cue can no longer be placed on a rim).
- render.ts: removed stray duplicate drawPowerGauge call + translate(-RAIL,-RAIL) leftover; gauge coordinates corrected for PLAY space (x = PLAY_W - w - 3.2).
- scripts/test-pockets.ts: 15 headless scenarios — rail-roll pot, lip topple, side straight-in, mouth-edge commit, near-miss stays on felt, no suck-in from distance, break pots balls with no escapes, all 6 pockets reachable. All pass.
- Live verify (agent-browser): break potted a ball ("Nice pot — shoot again!"), single gauge at right rail, no console errors. Lint clean.

Stage Summary:
- Balls that reach the drawn hole now always drop; slow balls on the lip topple in; mouth-edge entries commit instead of bouncing off invisible walls; near-misses on open felt are unaffected. Bot sims share the same physics so predictions stay consistent.
