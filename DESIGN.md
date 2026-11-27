# Tactile Turtle: Design

**Tactile Turtle is a programming puzzle game for children of about eight to fourteen. They write the programs by hand, with magnetic tiles on a metal plate, and a robot turtle on the screen carries them out.**
Every tile carries one word of the language: `FORWARD`, `PICK UP`, `REPEAT`, `IF`, `END`, `3`, `RED`, `a`, `TIDE`, and so on. The children set the tiles on the plate row by row, the way a typesetter sets type. While they program, the level stays on the screen, so that they can study it. When they are ready, they hold the plate up to the webcam: the screen shows a spanner and "Scanning", the game reads the plate, and the turtle runs the program.

A level is a small scene on an island: rocks, hatchlings to rescue, boxes to sort, lamps to switch on, gates, coloured coral and a lighthouse. Each level is a robot task like those of the robotics olympiads (sorting, delivering, following a line, finding the way through a maze), and it needs real programming: sequences, loops, conditions, variables, `FOR` loops and procedures. The game runs in the browser, on an iPad or any laptop, so a class needs no installation. The tiles are printed from PDFs in any language, so the same game works in English, German, Serbian, Albanian or Tibetan.

# Game design

## 1. Pillars

1. **Programming with the hands.** The program is a thing you can touch. Children pass tiles to each other, argue about a row, and slide a block one step to the right. The screen shows the level and what the program did; the program itself lives on the plate.
2. **Proper programming, not cards.** We use real constructs with real syntax: `REPEAT`, `WHILE`, `IF`/`ELSE`, `FOR … TO`, variables, arithmetic, comparisons and procedures, each block closed by `END`. What children learn here carries over to a text language.
3. **A robot with a job.** The turtle is a little robot: it picks things up, drops them, switches things on, uses tools, reads colours. The puzzles are the tasks of robotics competitions, made to fit a grid.
4. **A group at one plate.** One child fetches tiles from the type case, one sets them, one holds the plate up. The whole group wins a level together (Manifesto, rules 1, 2 and 6).
5. **Mistakes are cheap.** A program that fails only makes the turtle bump gently into a rock and look puzzled. There is no game over and no lives. Time is the only thing that counts, and even a slow group finishes.
6. **A world worth living in.** The turtle rescues hatchlings, tidies the harbour, lights the lighthouse and finds its way home across the ocean. Nobody is hurt and nothing is destroyed.

## 2. Setting: an island in the warm sea

A small robot turtle lives on a tropical island. Each world is one part of the island and the sea around it, and the journey leads outward, from the nest on the beach to the open ocean.

| World | Levels | Place | Programming idea | Robot tasks |
|---|---|---|---|---|
| 1 | 1–10 | The Nest Beach | sequences | moving, picking up, dropping |
| 2 | 11–20 | The Tide Pools | `REPEAT n`, numbers, nested loops | patrols, collecting in rows |
| 3 | 21–30 | The Coral Garden | colours, `PAINT` | marking patterns |
| 4 | 31–40 | The Mangroves | `IF`/`ELSE`, sensors, `NOT`/`AND`/`OR` | avoiding obstacles, reading signs |
| 5 | 41–50 | The Harbour | `SWITCH`, `USE`, `COLOUR`, carrying | switches, keys, sorting boxes by colour |
| 6 | 51–60 | The Lighthouse | `WHILE`, time, `WAIT`, the global `LIGHT` | waiting for the beam, lamps, refuelling |
| 7 | 61–70 | The Kelp Forest | variables, `←`, arithmetic, `TIDE` | counting and reporting |
| 8 | 71–80 | The Volcano Isle | `FOR a ← 1 TO n` | spirals, triangles, tables |
| 9 | 81–90 | The Sunken Ship | procedures (`DEFINE ★`, `★`), recursion | repeated jobs in many rooms |
| 10 | 91–100 | The Great Crossing | algorithms | wall following, line following, sorting yard, rescue |

## 3. The language

### The principles

* **One tile is one token.** The marker on a tile gives only its number (its *tile id*). The game never reads the printed word, so tiles from a German kit and an Albanian kit can be mixed on one plate.
* **The plate is read like a page.** Row by row, left to right. Rows mean nothing to the grammar: a statement may continue on the next row. Blocks are closed with `END`; there is no indentation (children do not understand indentation, and it costs space on the plate).
* **An empty slot is a space.** The plate has slots of one tile. Digit tiles in neighbouring slots form one number: `1` `2` is twelve. With the ten digit tiles we can write any number from −999 to 999.
* **Few types.** There are numbers, colours (`RED`, `GREEN`, `BLUE`, `YELLOW`, and `NONE` for no colour) and things (`ROCK`, `HATCHLING`, `BOX`, `LAMP`, `GATE`, and `FREE` for nothing in the way). Only values of the same type can be compared: `HERE = FREE` is an error ("what is a free colour?"). Conditions are comparisons. Variables hold numbers.
* **The world is read-only.** The sensors and the level's globals (`TIDE`, `LIGHT`) can be read but not changed. Only `a`, `b` and `c` belong to the program.

### The tiles

| Group (band colour) | Tiles |
|---|---|
| Actions (green) | `FORWARD`, `LEFT`, `RIGHT`, `PICK UP`, `DROP`, `PAINT`, `SWITCH`, `USE`, `WAIT` |
| Control (orange) | `REPEAT`, `WHILE`, `IF`, `ELSE`, `END`, `FOR`, `TO`, `←`, `DEFINE`, `★`, `●` |
| Operators (grey) | `+`, `−`, `×`, `=`, `≠`, `<`, `>`, `NOT`, `AND`, `OR` |
| Numbers (light grey) | `0` … `9` |
| Variables (yellow) | `a`, `b`, `c` |
| Sensors and globals (purple) | `FRONT`, `HERE`, `COLOUR`, `CARRYING`, `TIDE`, `LIGHT` |
| Values (blue; colours in their own colour) | `RED`, `GREEN`, `BLUE`, `YELLOW`, `NONE`, `ROCK`, `FREE`, `HATCHLING`, `BOX`, `LAMP`, `GATE` |

60 kinds (`data/tiles.json`). Some tiles have an icon (an arrow for `FORWARD`, turning arrows for `LEFT` and `RIGHT`), and the colour tiles carry a symbol (● red, ▲ green, ■ blue, ★ yellow, as on the board) for colour-blind players.

### The grammar

```
program   := statement*
statement := FORWARD | LEFT | RIGHT | PICK UP | DROP | SWITCH | USE | WAIT
           | PAINT expr                                  (a colour)
           | (★ | ●) expr?                               (call a procedure; with a number if it has a parameter)
           | var ← expr
           | REPEAT expr statement* END
           | WHILE cond statement* END
           | IF cond statement* (ELSE statement*)? END
           | FOR var ← expr TO expr statement* END
           | DEFINE (★ | ●) var? statement* END          (only at the top; var is the parameter)
cond      := and (OR and)*
and       := not (AND not)*
not       := NOT not | expr (= | ≠ | < | >) expr
expr      := term ((+ | −) term)*
term      := atom (× atom)*
atom      := number | var | sensor | value
```

An expression ends where the next token is not an operator, so statements need no separator: `a ← 3 FORWARD` is two statements. `AND` binds tighter than `OR`; there are no parentheses. The parser is `src/lang/parser.ts`; the text form used by developers and tests (`src/lang/tokens.ts`) is the same tokens written with spaces, and accepts `<-`, `!=`, `==`, `*`, `-` for the symbols.

### What the statements do (`src/world/run.ts`)

* `FORWARD` moves one cell ahead. A rock, a closed gate, a box, a lamp or the edge stops the program with a *bump*.
* `LEFT` / `RIGHT` turn by 90° on the spot.
* `PICK UP` takes the hatchling, box, key or fuel in front; the turtle carries as many as the level allows (one by default).
* `DROP` puts the last thing carried in front. A hatchling dropped into the sea is home.
* `SWITCH` turns the lamp or the gate in front on/off (open/closed).
* `USE` uses the last thing picked up on what is in front: a key opens a gate, fuel lights a lamp (it is used up; anything else is an error).
* `PAINT RED` paints the cell under the turtle.
* `WAIT` does nothing for one tick.
* Time: every statement that does something (an action, `PAINT`, `WAIT`) and every round of a `WHILE` takes one tick. With time, a crab in the way walks off, and gates may open and close by themselves (both set by the day, see "The days").
* `REPEAT n` runs its block n times (n is computed once). `WHILE` checks before every round. After 1000 ticks the turtle is tired and stops ("is there a loop that never ends?").
* `FOR a ← 1 TO 5` counts up, `FOR a ← 5 TO 1` counts down, both ends included.
* `DEFINE ★` defines a procedure; `DEFINE ★ a` one with a **parameter**: `★ 4` sets `a` to 4 for the call, and `a` gets its old value back afterwards, so every call has its own (`DEFINE ★ a IF a > 0 … ★ a − 1 END END` is a proper recursion). Procedures may call themselves, up to a depth of 50.

### The sensors and the globals

| Tile | Value |
|---|---|
| `FRONT` | the thing in the cell ahead: `ROCK` (also the edge), `HATCHLING`, `BOX`, `LAMP`, `GATE` (closed), a key, fuel or a crab, or `FREE` |
| `HERE` | the colour of the cell under the turtle, or `NONE` (for lines and zones) |
| `COLOUR` | the colour of what is ahead: of a box, of a lamp (`YELLOW` when lit, `NONE` when not), else of the cell ahead, else `NONE` (for sorting and line following) |
| `CARRYING` | how many things the turtle carries |
| `TIDE` | a number set by the level, different on different days |
| `LIGHT` | the colour of the lighthouse beam, which changes with time |

The globals of a level are shown in a small panel on the screen.

### Errors

The parser and the interpreter speak in short sentences and point at the tile in question; the picture of the read program circles it.

* "This REPEAT needs an END." · "This END closes nothing." · "After REPEAT, I need a number."
* "I can't compare a colour with a number." · "● is called but never defined."
* "Bump! Something is in the way." · "There is nothing to pick up in front."

A plate with a parse error is never run.

## 4. A level

### The structure (about 3–10 minutes)

1. **The task.** The board appears with the turtle, the goal (a glowing outline and one sentence: "Put every box on its colour.") and the **type case**: the tiles this level allows, each with how many may be used. A new tile is introduced with a short animated hint.
2. **Programming: the level stays on the screen.** The children study the board and set the tiles. (An earlier idea was a black screen, to keep all eyes on the plate; but children need to look at the level to plan.)
3. **Scanning.** They hold the plate up. The screen shows a spanner, the word "Scanning" and a ring that fills (section 5).
4. **The run.** The turtle runs the program; the tile being run lights up in a picture of the plate.
5. **The days.** If the first day succeeds, the turtle runs the same program on the other variants of the level, faster. The level is won when every day succeeds.
6. **The reward.** Points, stars, and the next level opens.

### The days (variants)

A level which teaches `IF` or `WHILE` is pointless if one fixed path solves it. So from world 4 on every level has two to five days: the same scene with small differences (where the boxes are and what colour, how long the corridor is, the `TIDE`). A program that only memorises the first day fails on the second, and the game shows it: "On Tuesday the boxes were different."

The game runs the program on every day; the level is won when the goals are met on all of them. The run shown is the first day on which they were not (or the first day, when all were won).

A day in `data/levels.json` is its map (`src/world/world.ts`: `.` sand, `#` rock, `~` sea, `R G B Y` coloured floor, `h` hatchling, `r g b y` boxes, `L` lamp, `D` gate, `k` key, `f` fuel, `c` crab, `> < ^ v` the turtle) and what else is different that day: `tide`, `light` (the beam, one letter per tick, repeated: `"RRRRGGGG"`), `capacity` (how much the turtle carries), `crab` (the tick at which the crabs walk off), `gates` (every so many ticks the gates open or close by themselves) and `goals`, when that day's goals differ from the level's (after counting, how much to paint).

### Goals (`src/world/goals.ts`)

Reach a cell (or a cell of a colour); every box on the floor of its colour; so many hatchlings home; every lamp on; a pattern painted (the cells to paint are shown as dashed frames in their colours).

### The kit and the type case

The **kit** is the set of tiles a group owns: 264 tiles on three A4 sheets. Its counts are set so that every level's reference solution fits it, with spare digits and common symbols:

| Tiles | Copies |
|---|---|
| digits | `0`–`6`: 5; `7`–`9`: 4 |
| `FORWARD` · `END` | 10 · 10 |
| `←` · `=` · `a` · `b` | 8 each |
| `LEFT` · `RIGHT` · `REPEAT` · `IF` · `PAINT` · `★` · `c` · `FRONT` · `HERE` | 6–7 |
| other actions, `WHILE`, `ELSE`, `≠`, `+`, `COLOUR`, `●` | 3–5 |
| the rest | 2–4 |

Each level's **type case** is a part of the kit with limits per tile ("at most 6 `FORWARD`"), the main way the puzzles push towards loops: level 10's beach is twelve steps long but there are only six `FORWARD` tiles. `tests/levels.test.ts` checks that every level's solution fits the kit and its plate, and runs it on its days.

### Points and stars

Points depend on the time the group spent on the level, from the task appearing to the scan of the winning plate, without pauses. Every level has a par time (3 minutes for the first levels, up to 12):

* time ≤ par: 300 points and three stars;
* par < time < 3 × par: from 300 down to 100 points in a straight line; two stars up to 2 × par, then one;
* time ≥ 3 × par: 100 points and one star.

Failed runs cost nothing but the time they take. Replays keep the best result. There is no leaderboard. **The golden shell** (no points): a winning plate with no more tiles than the elegant solution.

### Unlocking

Derived, not stored: level 1 is always open, and every level up to the one after the highest won level is open too: a level opens only once the last open one is won; "Next level" leads to the level after. After a win, the next level opens by itself after 15 seconds (a spanner in an emptying ring and the seconds on the button), unless a button is pressed.

## 5. The plate and the scanning

### The tile

A tile is **25 × 25 mm** (`data/tiles.json`): a 16 mm marker at the top (1 mm from the edge), with 2.1 mm of white below it (less, or a 15 mm marker, made the webcam tests fail); the label strip below it, with the icon on its left; the colour band of the group along the bottom edge. Colour tiles fill the label strip with their colour down to the edge. Labels are sized and placed by their real ink (accents, Cyrillic, Tibetan stacks): 0.5 mm from the top of the strip and 1.2 mm from the cut; Latin and Cyrillic words share one baseline per language, Tibetan words (Tibetan Machine Uni, whose stacks are compact) are each as large as their stacks allow. The icons are SVGs in `assets/icons/`.

### The codes

The markers are 4 × 4 cells inside a black border, as in ArUco, but from **our own dictionary** (`data/markers.json`, made by `dev/print/generate_markers.mjs`): 100 codes, any two of which differ in at least **4 cells in every rotation**, each with 5–11 white cells. A code read with one wrong cell is corrected, and one with two wrong cells is rejected rather than mistaken for another tile. (The standard ArUco 4 × 4 codes differ in only 3 cells; at 640 × 480 that made a `●` tile read as `OR`.) Ids 0–59 are the tiles, 60–65 are free, 66–99 are the anchors of the plates.

Why not QR codes: a tile needs a number from 0 to 99, not a text; the smallest QR code (21 × 21 modules) would need 4 times the size for the same reading distance.

### The plate

A sheet of steel (or a magnetic whiteboard) with a printed sticker (`data/plate.json`). Two sizes; programs are at most A3:

| Plate | Rows × slots | Anchors |
|---|---|---|
| A4 landscape | 7 × 9 | 66–79 |
| A3 landscape | 10 × 14 | 80–99 |

Every row has an **anchor marker** (20 mm) at both ends, each with its own id; the row lines are 28 mm apart; ticks mark the slots. The anchors make every part of the plate recognisable: any frame which shows one anchor is placed exactly.

### Reading a frame (`src/scan/`)

1. **Markers** (`detector.ts`): js-aruco2 finds the candidate squares (adaptive threshold, contours, quadrilaterals). We read the cells ourselves: from the middle of each cell, allowing two of the 20 border cells to be wrong, and if that fails, with the outline slightly shrunk, grown or shifted (the corners come from a pixel contour and may be a pixel off; then only an exact code is accepted). At 1.4–2 px/mm a cell is only 4–6 pixels wide, and js-aruco2's own decoding rejected most markers.
2. **The plate** (`plate.ts`): the anchors in view give the plate and a homography to plate millimetres (least squares over all anchor corners; an anchor that disagrees, i.e. a misread, is dropped).
3. **The tiles**: each tile is placed outward from the anchors with a homography fitted to the *nearest* known points (anchor corners and tiles already placed): the lens distorts the picture, and one homography for the whole picture was a centimetre off far from the anchors. A tile goes into the slot whose middle is nearest to its centre, wherever it was set: the lines and ticks only help the children, and a tile set between two slots still counts. Within 8 mm of the slot's middle it is *confident*: it counts double when the frames are merged and helps to place the tiles beyond it.

### Holding up and stitching (`hold.ts`)

The children may move the plate while holding it up, so that the camera sees one part after the other. All readings are in plate millimetres and are merged **slot by slot**:

* a tile counts if it was seen in at least 30 % of the frames that had its place well in view (a frame that showed only the left half says nothing about the right half), and in at least one frame confidently;
* its id is the one seen most (confident sightings count double);
* the plate is **complete** when every slot was in view in at least two frames.

So the program is uniquely reconstructed from overlapping parts. A program is accepted when the plate is complete and nothing has changed for three seconds; after 1.5 seconds without a plate, the scan starts over.

### The screens while scanning (`src/render/screens.ts`)

* No plate: **the level**, with its name and goal.
* A plate: the level dimmed, and over it a **spanner**, "**Scanning**" and a ring: the first half fills with the coverage of the plate, the second half while it stays the same. Hints: "Come a little closer" (when the anchors are smaller than 26 px) and "Show all of the plate".
* Read: a chime, the picture of the read program, and the run.

### Cameras, distances and focus

The game asks for 1280 × 720 (`getUserMedia` with `ideal` sizes); without that, browsers give 640 × 480. For example, the Chicony "Integrated Camera" (USB 04f2:b531) gives 1280 × 720 in MJPEG at 30 frames per second, and 640 × 480 by default.

Measured with the virtual webcam (section 13), which renders a 65° webcam with lens distortion, defocus, glare, noise, salt and pepper and JPEG:

| Camera | Plate | Distance | |
|---|---|---|---|
| 1280 × 720 | A4, A3 | 50–60 cm | reads every level, even with the plate clearly tilted |
| 1280 × 720 | A4, A3 | 70 cm | reads, when the plate is held fairly straight (a cell is ~3 px) |
| 1280 × 720 | A3 | 30 cm | too close to see whole: moved about and stitched |
| 640 × 480 | A4 | 30 cm | reads (like 60 cm in 720p); at 35 cm only when held straight |
| 640 × 480 | A3 | 25 cm | moved about and stitched |

**Focus:** laptop webcams have fixed-focus lenses, sharp from about 50 cm. With a typical lens (2.5 mm, f/2.2, focused at 60 cm), the defocus at 30–35 cm is a blur disk of 3.4–4.7 µm, σ ≈ 0.24–0.34 px at 640 × 480 (0.5–0.7 px at 720p): less than the blur of the lens itself. At 25 cm it is σ ≈ 0.5 px (VGA). So focus is not the limit at arm's length; resolution is. To be confirmed with real cameras (milestone 1).

## 6. Screens (built: `src/ui/`)

1. **Language**, on every load of the page: big buttons, each language named in itself, in alphabetical order; the last choice is marked (one tap). The choice is kept in local storage.
2. **Start:** the title, Play, and 🌐 with the language (to change it).
3. **Journeys** (section 8): Continue the last one, + New journey (named with the date and time, or typed), the others, and Delete (with a question).
4. **Worlds:** the ten worlds with the stars collected; a world is open when one of its levels is.
5. **Levels of the world:** open ones with their stars, locked ones with 🔒.
6. **The level:** the board with the name and the goal; the webcam beside it (a column on the right in landscape, a strip at the bottom in portrait, never over the level), where every marker read lights up (`src/ui/marker-glow.ts`, WebGL: brackets lock on, the code read pops out and springs back, cell by cell; tiles teal, anchors blue); the scanning ring over the dimmed level; the run; the **reward** (stars, points, Next level with its 15-second countdown, Try again, Levels, 🏠).

Every screen is a step in the browser's history: Back (the button, the browser's, Esc, or a swipe on a tablet) goes to the previous screen; 🏠 leads to the start from the worlds, the levels and the reward. Buttons are large for tablets, and lift under the mouse where there is one. Everything is fitted to the screen (tested on emulated tablets in both orientations).

**The demo** (`?demo`, not linked from the game) plays imaginary plates without a camera; **`?unlock`** opens every level for trying the game.

## 7. The 100 levels (`data/levels.json`)

Every level has a reference solution, its maps (one per day) and its goals; `tests/levels.test.ts` checks that every level has them and that the reference solution wins every day.

### World 1: The Nest Beach (sequences)
1 First steps · 2 Around the rock · 3 The dunes · 4 The first hatchling (`PICK UP`, `DROP` into the sea) · 5 Two hatchlings · 6 The driftwood · 7 Facing the sunrise · 8 Turned around · 9 The shell path (carry three) · 10 Too few tiles (`REPEAT` appears)

### World 2: The Tide Pools (`REPEAT`)
11 Around the pool · 12 The long sandbar (two-digit numbers) · 13 The staircase · 14 Hatchlings in a row · 15 Two pools · 16 The rectangle · 17 Rows of hatchlings (nested) · 18 Twice around · 19 The tight case · 20 The great pool

### World 3: The Coral Garden (colours, `PAINT`)
21 The first coral · 22 A red row · 23 Stripes · 24 The frame · 25 The flower · 26 The checkerboard · 27 The letter T · 28 Two squares · 29 Two stripes · 30 The reef mural

### World 4: The Mangroves (`IF`/`ELSE`, sensors)
31 Maybe a root · 32 Left or right · 33 Coloured signs · 34 The arrow path · 35 Roots on the way · 36 Hidden hatchlings · 37 Not a rock · 38 Red or blue (`OR`) · 39 The winding channel · 40 The mangrove maze

### World 5: The Harbour (robot tasks: switches, tools, sorting)
41 The first switch (`SWITCH` a gate) · 42 The first box (deliver it) · 43 Open or closed · 44 The key (`USE`) · 45 Red left, blue right (sort by `COLOUR`) · 46 Carrying two (`CARRYING`) · 47 The relay · 48 Toggling · 49 The busy quay · 50 The harbour master (sort a whole quay)

### World 6: The Lighthouse (`WHILE`, time, `LIGHT`)
51 Until the wall · 52 The beam (`WAIT` while red) · 53 The crab · 54 The current · 55 Search the coast · 56 Lights on (switch on every lamp) · 57 The light decides · 58 The stairs · 59 Fuel for the light (`USE` on the lamp) · 60 The lighthouse night

### World 7: The Kelp Forest (variables, `TIDE`)
61 Remember three · 62 The tide · 63 Count the steps · 64 Count the hatchlings · 65 Tide plus two · 66 Growing steps · 67 Two counters · 68 Which is longer? · 69 Double it · 70 The kelp count

### World 8: The Volcano Isle (`FOR`)
71 The triangle · 72 The spiral · 73 The third stone · 74 Countdown · 75 The lava field · 76 Every second · 77 The table · 78 Up to the tide · 79 The pyramid · 80 The crater path

### World 9: The Sunken Ship (procedures)
81 Turn around · 82 A square · 83 Two helpers · 84 A helper's helper · 85 A parameter (`DEFINE ★ a`, `★ 4`) · 86 The decks · 87 The spiral stair (recursion with a parameter: `★ a − 1`) · 88 Deeper and deeper (recursion to the wall and back) · 89 The cabins · 90 The ship's hold

### World 10: The Great Crossing (algorithms, olympiad tasks)
91 Hand on the wall (right-hand rule) · 92 Follow the line (`COLOUR`) · 93 The snake (scanning a field) · 94 Bar chart (count, report; A3 plate) · 95 The sorting yard (three colours to three zones) · 96 Five mazes · 97 The rescue (find the hatchlings, bring them home) · 98 Currents and beams · 99 The storm · 100 Home

## 8. Journeys (built: `src/ui/journeys.ts`)

A **journey** is one playthrough of a group (like the journeys of The Steppe Rescue and the voyages of Bird Dog): a name, the times it was created and changed, and per level the best time, points and stars. Many journeys per device, kept in the browser's local storage (`tactile-turtle/journeys`, with a format version; a broken save starts afresh instead of breaking the game). **Unlocking** is derived from the results: level 1 is open, then every level up to the one after the highest won one. **Points:** within the par time (3 minutes in world 1, a minute more per world) 300 points and three stars, down to 100 points at three times the par. Export and import of journeys as files is still to do.

## 9. Languages

Sixteen, in `i18n/<code>.json`: Arabic (`ar`, right to left: the menus turn round, the programs stay left to right), Bosanski / Hrvatski / Srpski (`hbs`, Latin script, ijekavian), German, English, Spanish, French, Hindi, Italian, Japanese, Korean, Portuguese (Brazilian), Russian, Albanian, Tibetan, Turkish and Chinese (simplified). Each has the words of the tiles, the texts of the screens, the goals, the names of the worlds and of all 100 levels; `tests/i18n.test.ts` checks that none is missing. All but English are drafts, to be reviewed by native speakers (marked in the files). The UI language and the language of a kit are independent: tiles are recognised by id only.

## 10. Printing the tiles (`dev/print/generate_stickers.py`)

* `tactile-turtle-tiles-<lang>.pdf`: the kit, 8 × 11 tiles per A4 sheet, grouped by kind, with dashed cut lines (Chinese, Japanese and Korean with Noto Sans CJK, Hindi with Noto Sans Devanagari, Arabic with Noto Sans Arabic); `--worlds 1` makes a smaller kit for some worlds;
* `tactile-turtle-plate-a4.pdf`, `tactile-turtle-plate-a3.pdf`: the plate stickers.

The pages are HTML rendered by WeasyPrint (HarfBuzz/Pango: Tibetan stacks correctly). Labels are fitted to their tile by measuring the shaped word; the script refuses substituted fonts and missing glyphs. The marker codes come from `data/markers.json`, the same file the detector uses. `npm run verify:print` reads every PDF back with the game's detector and checks that the whole kit and every anchor is found.

**Releases:** pushing a tag `v*` runs `.github/workflows/release.yml`: it builds the game, generates the PDFs, verifies them, and attaches them to the GitHub Release.

**Printing:** printable magnetic paper, or sticky paper on a magnetic sheet; matte paper against glare; at 100 % (each sheet has a 50 mm test bar).

## 11. Art direction

**Sprites** (`assets/sprites/`), generated from the prompts of `dev/sprites/export_prompts.ts` and cut by `dev/sprites/import_sprites.py`: the turtle (standing, 6 walking frames, 6 frames turning each way, all at one scale), hatchlings (8), crates in the four colours, rocks (6), a lamp (5 frames), a gate (6 frames), sand, sea and coloured ground tiles, and the spanner. The renderer takes a *skin* (`src/render/skin.ts`); without one, it draws the vector shapes of `src/render/board.ts`. While the turtle moves, its walk frames play; while it turns, its turn frames play and it turns by 90° at the end. A thing picked up is the real thing (a box in its own colour), floating onto the turtle's back and shrinking. The pick-up sprite sheet is not used: its boxes are all red. Readable from three metres; colour symbols on all coloured cells; a friendly robot turtle with an antenna.

* **The look** comes from SVG filters, small image shaders that every browser runs: grain in the sand (`feTurbulence`), slowly shimmering caustics in the sea, soft drop shadows under the things and the turtle, glowing lamps, shaded rocks and shells (gradients), and a vignette. (Real GPU shaders, e.g. with PixiJS, can come with the generated sprites.)
* **Smooth motion** (`src/render/animation.ts`): a run becomes one SMIL animation. Every step stands still for a moment and then eases into the next state: the turtle glides and turns (never spinning round), a thing picked up floats onto its back and shrinks (and back down when dropped), a hatchling dropped into the sea swims off, paint and lamps fade in, the tile being run lights up in the picture of the program. The game plays it once; the README loops it.

# Software architecture

## 12. Technology

**TypeScript in the browser, without a game engine.**

* Godot (our other games) cannot export C# to the web, has no camera in its web export, and is a 30–40 MB download with trouble on iPad Safari. The game needs a grid, a few screens and text in many scripts, which the browser does best.
* **TypeScript + Vite 8** (bundled with Rolldown): the dev server starts at once and a production build takes under a second. A static site, installable as a PWA, hosted on any HTTPS host (the camera needs HTTPS).
* **js-aruco2** (pure JavaScript) finds the markers, in a **Web Worker**. It is a classic script without ES exports (a bundler drops it), so `src/scan/aruco.ts` loads its two files as text and runs them with its own `this`. No OpenCV, no WebAssembly.
* **SVG** for the board and the screens; **Vitest** for the tests; **Python** only for the printable PDFs.

```
src/
  lang/     the tile catalogue, tokens and the text form, the parser, the layout on a plate
  scan/     js-aruco2, the detector, geometry (Point, Quad), homographies,
            the plate reader, holding up and stitching, the worker
  world/    the world, the interpreter, the goals
  render/   the board, the screens, animated runs
  main.ts   the scanner page
data/       tiles.json, markers.json, plate.json, levels.json
i18n/       the texts per language
dev/        print/ (markers and PDFs), docs/ (the pictures of the README)
tests/      unit tests, the virtual webcam, the end-to-end tests
```

## 13. Testing

* **The language and the levels:** the parser and its errors; every level's solution parses, fits the kit and its plate; every level is won on every day.
* **The markers:** the dictionary's distances; the PDFs read back with the detector.
* **The virtual webcam** (`tests/virtual-webcam.ts`): renders the plate with hand-placed tiles (each shifted and turned a little), stand-in labels, two hands holding it, a room behind; a pinhole camera with a 65° field of view and barrel distortion; distance-dependent defocus (thin lens); uneven light, glare, vignetting; motion blur, sensor noise, salt and pepper, and JPEG. A hold is several frames with trembling hands.
* **End to end** (`tests/scan-e2e.test.ts`): A4 and A3 at 50/60/70 cm in 720p, A4 at 30 cm in 640 × 480, and A3 too close to see whole, moved about and stitched (720p at 30 cm, 640 × 480 at 25 cm). The program must be read back exactly.
* **Every level on the webcam** (`npm run test:webcam`): each level's solution held up in 720p (at 50, 60 or 70 cm) and in 640 × 480 (30 cm, or stitched for A3).
* **In a real browser** (`npm run test:browser`): the built site in headless Chrome, with a fake camera playing the virtual webcam (an MJPEG file): the plate must be scanned (the worker, js-aruco2 as bundled) and the program run.

# Plan

## 14. Milestones

1. **The scanner** (built: the detector, the plate, the hold, the page): try it with real cameras and printed tiles; tune the hints.
2. **The language and the interpreter** (built), with the maps of all levels.
3. **The level screen:** the task, the scan, the run with the lit tiles, the days, the reward. (A first version, with a demo of imaginary plates, is built: `?demo`.)
4. **Print Tiles** in the game, the camera check, the on-screen plate.
5. **Journeys, points, stars, unlocking**, the island map.
6. **Play-testing with a class** (worlds 1–3), then tuning the kit, the par times and the hints.
7. **Worlds 4–10** with all their maps and days.
8. **Languages** reviewed; **sprites** behind the vector drawings.

## 15. Open questions

1. **Holding vs. lying:** hold the plate up (active, no stand), or lay it under a camera on a stand (steadier)? The reader does not care.
2. **Two plates, two turtles:** a world where two groups program two turtles that must help each other (the plates are told apart by their anchors).
3. **The real cameras:** the distances above come from the virtual webcam; the first class will tell.
