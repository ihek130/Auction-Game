# Cricket Auction — online multiplayer

Two players on separate devices, one shared auction — or one player against the computer. This project includes the website, a Vercel API, and shared room storage through Upstash Redis. It is ready for you to deploy; it is not already hosted.

Player ratings are derived from real career statistics and published ICC rating points. See [Where the ratings come from](#where-the-ratings-come-from).

## Deploy free on Vercel

1. Extract this ZIP. Create a GitHub repository and upload the **contents** of `cricket-auction-multiplayer` into it. `package.json`, `vercel.json`, `api`, `lib`, and `public` must be at the repository root. Upload all these folders, not just the HTML file. Do not upload real credentials.
2. Sign in to [Upstash](https://console.upstash.com/). Create a **Redis database on the Free plan**, choosing a nearby region. Copy its **REST URL** and **REST token with write access** from the database connection details. Do not use the read-only token. Keep paid upgrades and auto-upgrade off if you want to stay on the free plan.
3. Sign in to [Vercel](https://vercel.com/new) using GitHub. Choose the **Hobby** plan for personal use and import your repository.
4. Confirm the framework is **Other**, the output directory is **public**, and the build command is empty. The included `vercel.json` already provides these settings. If you uploaded the containing folder rather than its contents, select `cricket-auction-multiplayer` as the project's Root Directory.
5. Before deploying, add these environment variables, using the values from Upstash:

   | Name | Value |
   | --- | --- |
   | `UPSTASH_REDIS_REST_URL` | Your database's HTTPS REST endpoint |
   | `UPSTASH_REDIS_REST_TOKEN` | Your database's write-capable REST token |

   Enable them for **Production** (and Preview if you want to test preview deployments). These variables are server-only. Never paste them into `public/app.js` or the website.
6. Click **Deploy**. Open the production address Vercel gives you, such as `https://your-project.vercel.app`.
7. Enter your name, choose **T20 / ODI / Test**, and create a room. Click **Copy link** and send that invite to your friend. They enter their name and join. The host clicks **Start auction** when both players are present.

If you add or change environment variables after deploying, **redeploy** for the changes to take effect. Share the production address; if your friend sees a Vercel sign-in screen, check the project's Deployment Protection settings and allow public access to your personal game's production deployment.

### What “free” means

Vercel Hobby supports personal, noncommercial projects within its usage limits. Upstash offers a $0 Redis tier with usage limits. You do not need a paid domain: use Vercel's supplied subdomain. This is suitable for casual games with friends, not a promise of unlimited public traffic. Check both dashboards if you open the game to many people.

The game checks for room changes every two seconds while visible and every five seconds in the background. Two visible browsers generate roughly 3,600 state reads per hour, plus actions. Polling stops on the results screen. Close abandoned lobby/game tabs to stop their requests.

Official setup and plan documentation, checked September 2026:

- [Vercel build settings for Other/static projects](https://vercel.com/docs/builds/configure-a-build)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Upstash Redis pricing and billing](https://upstash.com/docs/redis/overall/billing)
- [Upstash REST connection details](https://upstash.com/docs/redis/features/restapi)

## Rules included

- Exactly two participants, **$100 per person**, visible custom bids, no fixed player base price.
- Every bid is a positive whole-dollar amount above the current high bid. Only the successful buyer pays.
- **30 seconds for each bidding turn**, reset on a valid raise. Timeout is a pass. If both pass before bidding, the player is unsold and can return later.
- An auction also closes when the other side cannot afford a higher bid, already passed, or has filled the current category.
- **Once one side has filled a category, the other side auctions alone until it catches up.** The full side is not asked to bid: any bid from the other side wins outright, and a pass sends the player back into the pool. The screen says so on both sides — the full side sees why it is waiting, the active side is told its bid wins outright, and an unsold card names who passed and who could not bid. It is worth knowing before you finish a category early: your opponent then gets to pick through the remaining players cheaply.
- Keep **$1 per unfilled squad slot**. Your displayed maximum bid accounts for that reserve.
- Both sides complete each category before the next starts:

   | Order | Category | Players per side |
   | --- | --- | --- |
   | 1 | Proper batters | 5 |
   | 2 | All-rounders | 2 |
   | 3 | Bowlers: fast and spin together | 3 |
   | 4 | Wicketkeepers | 1 |
   | 5 | Wildcard: any category | 1 |

- The wildcard round works like every other: a random unowned player from **any** category is revealed, and either side can bid if their wildcard slot is empty. Nobody picks a category. After every sale, either participant can reveal the next player.
- **Ratings are hidden while the auction is live.** The card shows the player's real career numbers for the format, and that is what you bid on. The game rating for every player appears only with the result, next to the score it produced.
- The 148-player master pool represents cricketers from the 1990–2026 period. Eligibility differs by format, because a player only enters a pool if they actually played enough of it: 116 T20, 147 ODI, 130 Test. The order is shuffled within categories, and future players are never sent to the browser.
- Each cricketer on the block shows three real career numbers for the format being played, so you are bidding on a record rather than a name.
- Results appear only when **both sides have exactly 12 players**. Money remaining breaks a tied score, otherwise it is a draw.

## How a squad is scored

Raw star power is no longer enough. A finished squad is marked out of 1000 across six components, and the results screen shows both sides side by side so you can see where the game turned.

| Component | Max | What it measures |
| --- | --- | --- |
| Squad quality | 420 | The average format rating across all twelve players. |
| Batting strength | 160 | The seven best batting contributions in the squad. |
| Bowling strength | 160 | The five best bowling contributions. |
| Fielding & keeping | 80 | Ground fielding and glovework across the squad. |
| Balance & combination | 100 | How closely the squad matches the shape the format asks for. |
| Impact players | 80 | Match-winners who can settle a game on their own. |

A player's batting and bowling contributions are weighted by role: a specialist batter's rating counts in full towards batting and barely at all towards bowling, while an all-rounder contributes substantially to both. Balance is measured against a per-format plan — Test cricket wants a third seamer, T20 wants two spinners and more all-round cover — and each requirement is scored proportionally, so a missing keeper costs you but a sixth batting option earns nothing extra.

The practical effect: nine batters and three quicks will lose to a balanced twelve of similar raw quality. Each seat's squad panel shows its current shape during the auction, so you can see the gaps while there is still money to fix them.

## Where the ratings come from

Ratings are **derived from real statistics**, not authored by hand. Two committed data files feed a single build step:

- `data/career-stats.json` — career statistics per player per format: matches, runs, batting average and strike rate, hundreds, wickets, bowling average, economy and, where available, bowling strike rate. Test, ODI and T20 International records come from Wikipedia player articles read as **raw wikitext**, so infobox fields are parsed verbatim instead of being summarised, cross-checked against the per-country lists of Test, ODI and Twenty20 International cricketers. Those infoboxes cite ESPNcricinfo. Strike rates and economies, which infoboxes do not publish, were **computed exactly** from runs and balls faced, or runs conceded and balls bowled, using figures from robots-permitted statistics sites, and independently reproduced against Wikipedia's own ball counts. The file also carries an all-Twenty20 career line for 119 players, covering franchise leagues as well as internationals.
- `data/icc-ratings.json` — ICC Men's Player Rankings rating points on the official 0–1000 scale, including the published best-ever tables that cover retired players. Cross-validated against the ICC-cited tables in Wikipedia's *ICC Men's Player Rankings* article, which matched exactly on every row checked.

Coverage: Test records for 142 of 148 players, ODI for all 148, T20 International for 122 with a batting strike rate for all of them, and an all-Twenty20 line for 119. Every record carries its source URLs and a confidence flag; 131 are high confidence, 16 medium and 1 low.

`tools/build-ratings.cjs` turns those into the 0–99 game rating for each player and format and writes `lib/players.cjs`. Rebuild any time with:

```sh
npm run ratings          # regenerate lib/players.cjs
npm run ratings:check    # fail if the generated file is out of date
```

Every player runs through the same published curves — no per-player fudging. In outline:

1. Batting and bowling are scored separately from the real career numbers, on curves anchored to what those numbers mean in each format. A Test average of 50 is a great player; a T20 economy of 6.2 is an excellent one.
2. The two are combined according to the player's role.
3. Where the player appears in an ICC ranking table, the published rating points are blended in.
4. Short international careers are pulled back towards a solid-but-unremarkable baseline, so a handful of good matches cannot read as an all-time great.

A rating of 0 means the player did not play enough of that format to enter its pool.

### Honest limits

- **Some players are missing a figure.** Where a statistic could not be verified it is left empty rather than estimated, and the rating is built from what is there. Where a batting strike rate is missing, ICC rating points are given more of the say, because those do account for scoring rate.
- **The two sites that supplied strike rates agree to the decimal**, which suggests a shared upstream feed. Treat them as one source corroborated by Wikipedia, not as two independent ones.
- **A handful of retired players have no T20 record at all** and are correctly absent from the T20 pool rather than given a guessed one.
- Figures for active players are a snapshot and drift as they keep playing.
- ESPNcricinfo, Cricbuzz and several other statistics sites either block automated access or disallow it in robots.txt. Nothing behind those was scraped.
- The final 0–99 number is still a **game rating for an auction**, not an official ranking or a match simulation. The inputs are real; the curves that turn them into a score are a design choice, and they are all in one readable file if you want to argue with them.

## Play against the computer

Pick **The computer** on the home screen and the auction starts immediately: no invite link, no second device, no waiting. Three difficulties are offered.

| Level | Name | Behaviour |
| --- | --- | --- |
| Rookie | Rookie Raj | Values players below their worth and gives up on contested lots early. |
| Pro | Pro Priya | Even-handed valuation with a little unpredictability. |
| Legend | Legend Lara | Prices a lot accurately, notices scarcity, and stretches for a player it still needs. |

The computer sees exactly what a human seat sees. It never reads the shuffled deck or any unrevealed player. It values the cricketer on the block from its remaining budget per unfilled slot, how that player rates against the others still available in the stage, and the holes left in its own squad, then bids in small irregular steps rather than jumping to its limit.

No background process runs on the server. The computer's moves are worked out when a request arrives, in exactly the same way expired turns are, so a solo game costs no more to host than a two-player one. It pauses for a second or two before acting so the auction stays readable.

A solo room cannot be joined by a second person.

## Chat and reactions

Every room has a chat panel. On a phone it slides up as a bottom sheet from the **Chat** button; on a desktop it stays docked beside the auction. Three ways to say something:

- **Sixteen one-tap emoji.** A reaction also **floats up over both players' screens** for a couple of seconds, so it lands even if the panel is closed.
- **Sarcastic presets.** A row of ready-made sledges ("My nan bids harder", "Are you bidding or donating?") because nobody wants to type during a thirty-second turn. The shuffle button rotates the selection.
- **Free text**, up to 160 characters.

- Messages are capped at 160 characters, and a room keeps the last 60.
- One message per seat per 0.7 seconds. The browser greys out the send button and the reaction bar for the same interval, so a fast second tap is ignored rather than rejected.
- Chat deliberately does **not** touch the auction's revision counter: a message arriving while you are typing a bid can never invalidate that bid.
- Control characters are stripped and all text is escaped when displayed.
- The computer reacts to lots it wins and loses, and will occasionally answer you.

Messages travel on the same two-second poll as the rest of the room, so expect a short delay rather than instant delivery.

## On a phone

The layout is built mobile-first and tested in a real browser at 390 CSS pixels wide.

The auction screen is arranged around one question: what do I need to decide, right now?

- A **heads-up display** pins both wallets and a draining countdown ring to the top. The ring turns red inside the last ten seconds.
- The **bid bar sticks to the bottom of the screen**, so bidding never needs a scroll. Quick chips (**+$1**, **+$2**, **+$5**, **Max**) fill the box without typing.
- Squads sit in a collapsible drawer rather than a long list, and each one shows a live shape readout so you can see the gaps while there is still money to fix them.
- A lot that sells gets a **SOLD** stamp that tells you immediately whether you won it.

The rest:

- One column on a phone, two from 700 pixels, the full board with a side panel from 1000.
- No sideways scrolling at any width. The stage strip, reaction bar and preset row scroll inside themselves instead of stretching the page.
- Tap targets are at least 46 pixels; inputs use a 16-pixel font so iOS does not zoom on focus.
- Safe-area insets are respected on notched phones, and `prefers-reduced-motion` turns off every animation including the floating reactions.

The browser **Back** button returns you to the home screen rather than leaving the site. Opening an invite link cold still works: a home entry is put behind the room so Back has somewhere to go.

## After the final whistle

The results screen is built to start another game rather than end the session.

- The headline is personal: **You win** or how many points short you finished.
- **Your best value** calls out the most rating points you got per dollar.
- The **six-component breakdown** shows both squads side by side, with the leader in each row highlighted, so a loss is explainable.
- **Play again** starts a fresh auction on the same format and difficulty in one tap. **Share result** copies a short scoreline you can paste to your opponent.



## Keyboard controls and reconnecting

- **Enter**: submit your typed bid. Your friend's input focuses automatically when their browser receives the new turn.
- **P**: pass on your turn.
- **Enter after a sale**: reveal the next player.
- Bid inputs do not reset during routine polling.
- Reopen the invite in the **same browser/profile** to restore your seat. Each browser stores its own private seat token; the invite link contains only the room code.
- A different browser cannot reclaim an occupied seat. If a seat token is lost, create a new room.
- Rooms expire 24 hours after creation. The server decides deadlines; disconnecting does not pause them. Expired turns are processed on the next request, so no timer process or cron job needs to run in the background.
- Updates generally reach the other device within about two seconds plus network latency. This version uses HTTP polling, not continuous streaming.

## Run locally

Install Node.js 22 or later, open a terminal in this folder, and run:

```sh
node dev.cjs
```

Open `http://localhost:3000` in two separate browser profiles, or a normal and an incognito window. Create a room in one and join the invite in the other. No package installation is needed: there are no third-party runtime dependencies.

The local server uses memory when no Redis environment variables are supplied. Those local rooms reset when the process stops. **The deployed Vercel API always requires Redis** and never silently falls back to memory.

To use Redis locally, copy `.env.example` to `.env`, replace its placeholder values, then run:

```sh
node --env-file=.env dev.cjs
```

Run the included checks:

```sh
node --test tests/game.test.cjs tests/http.test.cjs
```

## Verification and implementation notes

Ten automated checks passed, including 36 full-game simulations across all formats, category quotas, wallet reserves, timer boundaries, duplicate/stale actions, two-seat join races, hidden future players, and two independent HTTP clients creating, bidding, passing and reconnecting.

The website's JavaScript syntax was checked. A real browser rendering test and a live Vercel/Upstash deployment were not available in the build environment. After deploying, do one short two-browser smoke test: create/join, raise a bid, pass, and let a turn expire.

The API derives your seat from a cryptographic token and applies game rules on the server. Redis compare-and-set Lua operations make concurrent room changes atomic. There is a limit of twelve room creations per IP per hour. This is a casual friends-only game: there is no account system, lobby moderation, chat, spectator mode, or payment handling.

Files:

- `public/`: website interface and assets.
- `api/room.js`: Vercel server function.
- `lib/game.cjs`: auction rules, deadlines, quotas and results.
- `lib/data.cjs`: player pool and format ratings.
- `lib/service.cjs`: room creation, seat authentication and actions.
- `lib/store.cjs`: Redis REST storage with atomic updates; local memory store for testing.
- `dev.cjs`: local HTTP server.
- `tests/`: game and two-client HTTP checks.
- `vercel.json`: deployment settings.

### Troubleshooting

- **Cannot create a room:** verify both Vercel environment variables, the write token, and the latest deployment. Check the Redis database is active and within its free limits.
- **API returns 404:** ensure the `api` and `lib` folders are included at the project root; do not deploy only `public`.
- **Friend gets “room already has two players”:** use the original browser to reconnect, or create a fresh room.
- **Same participant appears in both tabs:** tabs in the same profile share a seat token. Use another profile/incognito to test the other participant.
- **Late bid rejected:** the server's 30-second deadline is authoritative. Slow networks may display updates slightly later.
- **Room expired:** create a new room; expiry is intentionally 24 hours.
