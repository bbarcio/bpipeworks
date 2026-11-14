# Pipeworks (bpipeworks)

Original single-screen bump-and-kick arcade platformer inspired by the 1983 arcade
classic's *gameplay*. All characters, names, art, and sounds are original — never
add Nintendo characters, names, or likenesses (no Mario/Luigi/Shellcreeper/POW etc.).

Live: https://bbarcio.github.io/bpipeworks/

## Stack
- Single `index.html`: vanilla JS + HTML5 Canvas + Web Audio. No frameworks, no external requests.
- PWA: `manifest.json`, `sw.js` (stale-while-revalidate cache), icons. Offline after first visit.
- Target: iPhone/iPad landscape. iPadOS touch detection via `navigator.maxTouchPoints > 1`.

## Architecture (index.html)
- Logical resolution 256x224, fixed 60Hz step. Rendered with 7:6 pixel aspect
  (arcade CRT look); `?square` for square pixels.
- `TUNE` object at top holds all feel constants (also exposed as `window.TUNE`).
- Level: floor y=200, tier1 y=152 (0-88, 168-256), tier2 y=104 (stubs 0-24, 232-256;
  center 56-200), tier3 y=56 (0-104, 152-256). Horizontal wraparound.
  32px gaps beside the Jolt and between tier2 stubs/center: you can climb UP through them AND,
  with good timing, hop ACROSS them under the low ceiling (like the arcade).
- Jolt block (3 uses, refills after bonus rounds) sits in the tier1 gap, top level with tier1.
- Girder THEMES change every regular phase (Steel, Conveyor belt [dark blue per Bernie], Timber, Copper plate, Amethyst stone,
  Hazard, Mossy stone, Teal tile, Chrome pipe, Green grate, then repeat). Bernie vetoed red Brick
  (clashed with the brick floor); bonus rounds use GOLD_THEME. Bonus phases don't consume a theme.
  Floor bricks stay constant. HD adds a soft top-lit gradient over each tile.
- Critters: `snap` (Snapper turtle, 1 bump flips), `pinc` (Pincer crab, 1st bump = angry,
  2nd flips) and `gnat` (Gnat fly: hops; can only be flipped while resting on a girder). Flipped critters wake up angrier (level 0..2). Last critter goes furious.
- Walking critters turn around when they touch any other critter, walking or flipped.
- Floor critters exit bottom pipes and re-emerge from the top pipe on the same side.
- Kicks drop coins from top pipes. Bonus rounds at phases 3, 8, then every 7.
- Phase schedule follows the international arcade: 1-2 snappers, 4 pincers, 5 mix, 6 gnats,
  7 gnats+pincers, 9+ repeating cycle (gnats+snappers, gnats+pincers x2); 12-14 etc. = more sparks.
- Sparks (fireballs, not phase targets), per arcade guides: RED from phase 1, appears by a top pipe,
  slow diagonal bounce off girders AND screen edges (never wraps); also spawns early when a critter
  drains into a bottom pipe. GREEN from phase 4 (debut phase is our call), enters at a side edge in
  line with the worker's level, two small hops + one long hop, vanishes at far edge. Max 2 of each;
  each new one comes sooner; "hot" phases at 60% timers. Bump only as it touches down: green 200,
  red 1000. Cleared on death and at phase start. When the LAST target critter is kicked, `clearHazards()`
  poofs all sparks, icicles and Frost Slugs, and `hazardsOff` blocks new ones until the next phase
  (Bernie: no deaths after you've won the phase).
  Continuous low hum while sparks are on screen (`updateHum`): red 82Hz/5Hz throb, green 123Hz/8Hz;
  detuned sawtooths + low-pass so the pitch survives phone speakers. Volumes `humRed`/`humGreen`.
- Critters whose center is inside a pipe (`inPipe`) can't hurt the worker or be bumped. Pipes overlap
  ledges/floor by 1px and body tucks under flange: no seams at fractional Retina scales.
  Gnats crawl (no hops) on the floor near their exit pipe.
- Draw order: girders, Jolt, floor, coins, critters, PIPES, then player. Critters/coins come out of
  (behind) the pipes; the worker walks in front of them.
- HD critters are the CARTOON set Bernie picked (`TOON.turtle` Chunky Buddy, `TOON.crab` Bug-Eye,
  `TOON.fly` Buzzy): thick outlines, big eyes, dizzy X-eyes when flipped, red-eyed scowl when the crab
  is angry. Color stages: TOON_TURTLE gold/red/magenta, TOON_CRAB cyan/orange/magenta, TOON_FLY
  green/orange/magenta. Fly drawn at `TUNE.flyScale` 1.3x (hitbox 14x12) so it matches the others.
  Worker HD = WORKER2 (v0.8.0, Bernie's design): round belly + round butt with a FLAT back, dark blue
  overalls, purple shirt, flat purple hard hat with a HEADLAMP (soft beam ahead; no beam when charred),
  yellow gloves, brown boots, cartoon eyes. Rear (back + butt) pulled in 33% and beam shortened 40% (v0.8.2); lamp housing (tube) shortened 40% so it sits within the brim (v0.8.3). Hat darkened to near the shirt purple + short cropped brown hair and sideburn (v0.8.4).
  Deliberately NOT a soft cap: keep worker gear so he never reads as a famous plumber. Pixel sprite +
  HUD life hats recolored to match (WPAL). App icons redrawn from WORKER2.
  (Old snapperHD/pincerHD/gnatHD remain in the file but are unused.)
- Art modes: PIXEL (sprite strings) and HD (vector `workerHD` / `coinHD` + TOON critters,
  drawn in logical units so they render at full Retina res). HD is the DEFAULT. Toggle: ART button
  on the title screen (or H on title), `?pixel` / `?hd`; choice saved in localStorage. Gameplay/hitboxes identical in both modes.
- Debug: `?debug` shows hitboxes; `?phase=N` starts at phase N.
- TEMPORARY DEV FEATURE (v0.9.1): title-screen start-phase picker (`PHASE_CHIP`, `startPhase`, 1-30, wraps,
  saved in localStorage `pipeworks.startPhase`). Remove before a real release.

## Sound notes
- Direction-change squeak has 6 presets in `SQUEAKS` (BLIP is the default — Bernie's pick; also sneaker, court, duck, skid, squelch).
  Choose with `?squeak=name` (saved in localStorage) or `TUNE.squeakStyle`.
- Bernie prefers soft tones with smooth fades (triangle/sine, low-pass, exponential decay) over buzzy pulse waves.

## Game controller (v0.11.0)
- Gamepad API, standard mapping (PS5 DualSense, Xbox, MFi). `readPad()` merges into `pollInput()`.
  Move: left stick (dead zone 0.35) or d-pad 14/15. Jump: Cross(0) or Circle(1).
  Title: Cross/Options(9) start, L1(4)/R1(5) start phase, Triangle(3) art. Envelope: Cross/Options closes.
  Game over: Cross/Options. Touch controls hide while a pad was used in the last 20s; any touch brings them back.
- Test note: Node 21+ has a read-only global `navigator`; fake it with Object.defineProperty in harnesses.

## Controls (Bernie's preference)
- LEFT thumb: fixed horizontal joystick (base never moves; `STICK_DEAD` dead zone).
  Tablets (min screen side >= 600) get a 170px left gutter and a bigger stick; phones use 100px.
  PHONES ONLY: the stick's logical center silently follows the thumb past 18pt (`STICK_PHONE_REACH`,
  dead zone 7) so stop = ~11pt pull-back and reverse = ~26pt (was 42/59). Drawn base never moves.
  Bernie asked for this after finding iPhone stops/reversals imprecise; iPad stays plain fixed stick.
- RIGHT thumb: jump button. Keyboard: arrows/A-D + Space/Z.

## Tuned values worth protecting
- `jumpVel` 5.3 / `gravity` 0.22: ~64px rise, stays 8px short of reaching two tiers.
- `bonkVy` 0, `landAssist` 3, `coyote` 6: make low-ceiling hops (stub<->center, ledge<->Jolt)
  possible with ~7-frame timing windows. Climbs: t1>t2 16f, floor>t1 12f, t2>t3 10f.
- Verify with a headless sweep of every hop AND climb before changing geometry or jump physics.

## Release checklist
1. Bump `VERSION` in index.html.
2. Bump `CACHE` in sw.js to match (otherwise installed phones keep the old build).
3. Commit + push; GitHub Pages deploys from `main` / root.

## Ice (v0.9.0, arcade-based)
- Frost Slug (`slug`, original design): from Phase 9 (slugFirst 8s, every 16s, max 2). Walks to the CENTER
  of a freezable girder (tier2 center + both tier1 girders, flagged `freezable`), parks for slugFreezeTime
  (75f, frost ring) then ices it and vanishes. Bump/Jolt = pops for 500, never flips. NOT a phase target
  (`targetsLeft`). No new slugs once all 3 freezable girders are iced. Touching one kills.
- Iced girders: `pl.iced`, `pl.iceT` spreads from center over 40f; ice overlay `drawIceTile`. Worker-only
  slippery physics: iceAccel 0.06 / iceSkid 0.05 / iceFriction 0.035 (~26px coast vs 5px). All thaw per phase.
- Icicles: from Phase 16, under top girders + top pipes; grow 150f, wobble 50f, fall, shatter at floor. Deadly
  while falling. Max 2 hanging. Cleared on death/phase start.
- Bonus rounds from Phase 8 start with every girder iced (floor never).

## Courier mail (v0.10.0, link removed v0.10.2)
- Courier Pigeon (original): flies across at jump-only heights (lanes = level - 32, bob +/-4), `MAIL.passes`
  crossings, then leaves. Catch = game pauses (state 'mail'), DOM overlay #mail: envelope drops in, flap opens,
  letter rises with fanfare + confetti showing MAIL.message. "Back to work" resumes with 90f invuln. +MAIL.points.
- Config: the `MAIL` object at the top of the script. `?mailtest` = every phase, 4s in. No pigeon in bonus rounds.
- The prize link (MAIL.url, link button, `?mailurl=` override) was REMOVED in v0.10.2 at Bernie's request.
  Real reward delivery (e.g. gift card) will be designed later; Bernie plans to use encryption. Note: any secret
  shipped in client code/repo is readable by players, and URL overrides enable phishing. Don't reintroduce either.

## Roadmap
- Invisible-girder bonus rounds (arcade: some later bonus rounds)
- Original music, title attract mode
