# Cricket Auction — online multiplayer

Two players on separate devices, one shared auction. This project includes the website, a Vercel API, and shared room storage through Upstash Redis. It is ready for you to deploy; it is not already hosted.

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
- Keep **$1 per unfilled squad slot**. Your displayed maximum bid accounts for that reserve.
- Both sides complete each category before the next starts:

   | Order | Category | Players per side |
   | --- | --- | --- |
   | 1 | Proper batters | 5 |
   | 2 | All-rounders | 2 |
   | 3 | Bowlers: fast and spin together | 3 |
   | 4 | Wicketkeepers | 1 |
   | 5 | Wildcard: any category | 1 |

- In the wildcard round, the nominated side chooses a category. A random unowned player from that category is revealed; either side can bid if their wildcard slot is empty. Category selection itself has no timer. After every sale, either participant can reveal the next player.
- The 148-player master pool represents cricketers from the 1990–2026 period. Eligibility differs by format: 127 T20, 148 ODI, 142 Test. The order is shuffled within categories, and future players are never sent to the browser.
- Results appear only when **both sides have exactly 12 players**. Score is the sum of all twelve format ratings; money remaining breaks a tied score, otherwise it is a draw. Ratings are authored game ratings, not official rankings, live statistics, or a match simulation.

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
