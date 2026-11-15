# Pipeworks (bpipeworks)

Original single-screen bump-and-kick arcade platformer inspired by the 1983 arcade
classic's *gameplay*. All characters, names, art, and sounds are original — never
add Nintendo characters, names, or likenesses (no Mario/Luigi/Shellcreeper/POW etc.).

Live: https://bbarcio.github.io/bpipeworks/

## Stack
- Single `index.html`: vanilla JS + HTML5 Canvas + Web Audio. No frameworks, no external requests.
- PWA: `manifest.json`, `sw.js` (page loads network-first w/ 3s timeout since v0.13.1 so updates/gift QRs
  run current code; other files stale-while-revalidate), icons. Offline after first visit.
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

## 2-player co-op (v0.12.0)
- Simultaneous co-op, separate scores/lives/1UP. `players[0..1]` (each has `input`, `score`, `lives`, `lift`, `stun`,
  `inGame`, `out`); `inPlay()` / `alivePlayers()` helpers. `twoP` chosen on title (PLAYERS chip, Square on pad,
  1/2 keys; saved `pipeworks.players`; `?players=2`). Points go to whoever earned them (`addScore(n,x,y,p)`).
- Input: touch always = P1. `PAD.slot[n]` = gamepad index per player; a lone pad = P2, two pads = first P1/second P2.
  Keyboard 2P: P1 arrows + Space/Up, P2 A/D + W/Z/X. Touch controls stay visible in 2P while P1 has no pad.
- Bumping a girder under the other worker dazes him (`stunPlayer`, `stunTime` 50f, no control, never deadly).
  Workers are solid side to side (`separatePlayers` shoves). Green spark targets a random living worker.
- One worker dying doesn't wipe sparks/icicles; only when nobody is left standing (then world freezes like 1P).
  Out of lives = `out`; game over when both are out. 2P respawn lifts at x 116 / 140.
- P2 art = WORKER2 with WHITE shirt + WHITE hat (`WORKER_P2`, pixel `WPAL2`/`SPR2`). Worker drawing takes a palette
  (`WORKER2.draw(c, pose, pal)`) so new variants (planned: a female worker) are easy.
- 1P must stay identical: verify with a frame-by-frame trace hash of a scripted 1P session before/after changes.

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
  Since v0.13.0 the pigeon ONLY flies for verified gift links (or `?mailtest`); arrives 6-15s into the phase.
- The prize link (MAIL.url, link button, `?mailurl=` override) was REMOVED in v0.10.2 at Bernie's request.
  Real reward delivery is now designed as signed + passphrase-encrypted gift links (next section). Note: any secret
  shipped in client code/repo is readable by players, and unsigned URL overrides enable phishing. Don't reintroduce either.

## Gift links (v0.13.0, LIVE: key in, merged to main 2026-11-15)
Bernie gives each recipient a printed QR code. The QR opens the game with an encrypted, signed gift in the URL
fragment; the recipient catches the Courier Pigeon, types a passphrase Bernie tells them separately, and the letter
reveals a personal message + a "Claim" button for the gift card's own redemption link.

Security model (what each layer does):
- SIGNATURE (ECDSA P-256 / SHA-256, WebCrypto) = authenticity. Only Bernie's private key can make a gift the game
  accepts, so nobody can craft a phishing link that shows a "Claim" button. Bad/missing signature = silently ignored.
- PASSPHRASE ENCRYPTION (PBKDF2-SHA256 -> AES-256-GCM) = confidentiality. A lost/photographed QR is useless without
  the passphrase. Never print the passphrase on the same card as the QR.
- Accepted limit: the game runs on the player's device, so anyone with the link AND passphrase can decrypt it
  without playing. The game is the wrapping paper, not a vault. Don't promise more than that.
- The issuer's claim link is single-use; that (not our code) is what stops a card being redeemed twice.

URL + payload:
- `https://bbarcio.github.io/bpipeworks/#g=<base64url blob>`. FRAGMENT only (never `?query`): never sent to the
  server, so it stays out of Pages logs, Referer headers and link-preview fetches. The game reads it once on load,
  then removes it with `history.replaceState`.
- Blob v1 (binary, kept small so the QR stays scannable when printed ~3 cm):
  `ver(1)=1 | exp(4, unix days or seconds, plaintext so expired gifts are rejected before the prompt) |
   salt(16) | iv(12) | ciphertext+GCM tag | signature(64, raw r||s)`. Signature covers every byte before it.
- Plaintext (JSON, compact keys): `{ m: message, u: claim URL (optional), c: claim code (optional),
  n: optional recipient name }`. At least one of u/c. Card provider not chosen yet (probably Amazon). Amazon
  e-gift cards are a CLAIM CODE, not a link: show the code with a Copy button, plus a Redeem button to Amazon's
  redeem page. The code itself is single-use at Amazon.
- Target total URL under ~400 chars (QR version ~15 at ECC level M). Short messages; long claim URLs grow the code.

Game-side rules:
- Verify signature + expiry FIRST; only a genuine, unexpired gift turns on the pigeon / passphrase prompt.
- GIFT-ONLY PIGEON (Bernie, decided): the Courier Pigeon flies ONLY for players who opened a valid gift URL.
  No gift = no pigeon at all (`?mailtest` stays as a dev tool).
- GIFT DIFFICULTY picker (Bernie, decided): a title-screen chip shown ONLY in gift mode; the RECIPIENT picks:
  EASY = phase 2, MEDIUM = phase 6, HARD = phase 9. Default EASY. The game still starts at phase 1; the pigeon
  first appears once they REACH the chosen phase, and keeps coming on every later regular phase until caught
  (never in bonus rounds). Gift mode ignores the dev start-phase picker and `?phase=` (always starts at phase 1).
  Choice kept in sessionStorage with the gift. Works in 2P: whoever catches the pigeon opens the letter.
- Passphrase is asked AFTER the pigeon is caught (inside the #mail envelope), not on launch.
- Passphrase: normalize before deriving (trim, lowercase, collapse spaces, Unicode NFC) so "Biscuit " == "biscuit".
  Wrong passphrase = AES-GCM fails -> friendly "not quite" retry, no hints. PBKDF2 iterations ~300k
  (well under a second on a phone; makes offline guessing slow). Bernie should pick passphrases that aren't
  one-word guesses from the recipient's social media.
- Claim button: only opens https URLs whose host is on `GIFT_ALLOWED_HOSTS` (defense in depth if the key ever
  leaks). Show the destination domain on the button. Open with `rel=noopener`.
- No gift in the URL = game behaves exactly as today. 1P trace hash must be unchanged.
- Decrypted gift may be kept in sessionStorage so a reload doesn't need the passphrase again; never localStorage.
- Note: a QR opens Safari, not the home-screen PWA (separate storage). That's fine; the gift works in Safari.

Keys + tooling:
- `tools/gift-sign.mjs` (Node 18+, no deps, runs on Bernie's computer):
  `keygen` writes the private key to `~/.pipeworks/gift-private.jwk` (refuses inside a git repo, chmod 600) and
  prints the `const GIFT_PUBLIC_KEY = {...};` line to paste. `make --message --name --code --url --expires
  --qr file.svg [--show]` prompts for the passphrase, self-checks, warns if the URL host isn't in
  GIFT_ALLOWED_HOSTS or the key doesn't match index.html, and writes a QR SVG (built-in encoder, ECC M, verified
  with jsQR; never use an online QR site, it would see the gift). `verify "<url>" [--passphrase]` checks a link.
  `--base http://localhost:8000/` makes links for local testing. Exports qrEncode/makeBlob/checkBlob for tests.
- `.gitignore` blocks `*.jwk` as a safety net.
- Code map (index.html): GIFT_PUBLIC_KEY / GIFT_ALLOWED_HOSTS / GIFT_LEVELS / GIFT_KDF_ITER near MAIL; `loadGift()`
  (runs at startup, async), `openGift()`, `giftClaimUrl()`, `cycleGiftLevel()`; `GIFT_CHIP` replaces the dev
  PHASE_CHIP on the title in gift mode (tap / [ ] / L1 R1 cycle); tagline becomes the gift line; overlay
  `showGiftLock()` / `showGiftPrize()` / `tryUnlock()`; game keydown ignores events from the passphrase INPUT.
  Catching without opening ("Later") keeps the pigeon coming; opening sets `mailDelivered` (reset per game);
  `giftPrize` stays in memory so a later catch opens unlocked.
- Tests used (scratch, not in repo): Playwright serves index.html with a throwaway test key swapped in. Never
  commit a test key into index.html: whoever holds its private half could make gifts the game trusts.
- The PRIVATE KEY NEVER goes in this repo, in commits, in chat or in an issue. Back it up somewhere safe; losing
  it only means making a new key pair and reprinting unclaimed QRs.

Steps (status):
1. DONE: key pair made (private key in ~/.pipeworks, backed up).
2. DONE: public key in index.html (commit d17624e).
3. DONE: provider = Amazon (claim codes). GIFT_ALLOWED_HOSTS = www.amazon.com, amazon.com.
4. DONE v0.13.0: game side.
5. DONE headless: valid + messy-case passphrase, wrong passphrase, tampered, wrong key, expired, evil host,
   fragment stripped, reload keeps gift, ?phase ignored, Later -> returns, 2P catch, no-gift 1P/2P traces
   identical to v0.12.0. DONE 2026-11-15: Bernie scanned a test QR on his iPhone and unlocked it (after v0.13.1 sw fix).
6. DONE: VERSION + sw.js CACHE 0.13.0.
7. DONE: merged to `main`; test gift made and verified on iPhone. Recipe for a test gift
   (`node tools/gift-sign.mjs make --name Test --message "Hi" --code TEST-CODE --qr test.svg`), scan it on the
   iPhone, and run `verify "<url>" --passphrase "..."` if anything looks off.

## Roadmap
- Invisible-girder bonus rounds (arcade: some later bonus rounds)
- Original music, title attract mode
