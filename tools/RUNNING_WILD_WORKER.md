# Running Wild Worker setup (Cloudflare)

The Running Wild apps talk to their own Cloudflare Worker, `runningwild-live`, kept apart from the GPT100's `gpt100-refresh`. It runs the Control board, the line to the phones (notices, help requests, field phones on the map) and, for the Mt Buller tracking test, keeps every position the field phones send.

It is the GPT100 Worker's code ([`refresh-worker.js`](refresh-worker.js)) with three changes:

- It takes positions anywhere in Victoria and southern NSW. The GPT100's took the Grampians only, and turned away every fix from Mt Buller.
- It keeps every fix (`field_track`: time, position, accuracy, course km, battery, speed, web or Android app), not just each phone's latest.
- The Control board's **Download tracks** button gets them as a spreadsheet (`/rc/track`).

Setup takes about 15 minutes, all in the Cloudflare dashboard, on the same account as the GPT100 Worker.

## 1. Create the Worker

1. Go to **Workers & Pages**, then **Create**, then **Create Worker**.
2. **Name:** `runningwild-live`. Click **Deploy** (it deploys a hello world to start with).
3. Click **Edit code**. Delete everything in the editor and paste in the whole of [`refresh-worker.js`](refresh-worker.js) from this folder.
4. Click **Deploy**.

The Worker's address is shown at the top, for example `https://runningwild-live.chad-ad3.workers.dev`. The apps expect exactly that (`refreshUrl` in `data/config.js`). If yours is different, tell Chad or change `refreshUrl` to match.

## 2. Create the database

1. Go to **Storage & Databases**, then **D1 SQL Database**, then **Create**.
2. **Name:** `runningwild-race-control`. Leave the location as automatic, then **Create**.

The Worker makes its own tables the first time it's used.

## 3. Connect the database to the Worker

1. Go to **Workers & Pages**, then **runningwild-live**, then **Settings**, then **Bindings**, then **Add binding**, then **D1 database**.
2. **Variable name:** `DB` (capitals, exactly). **D1 database:** `runningwild-race-control`.
3. Click **Add binding**, then **Deploy** if it asks.

## 4. Add the password

1. Still in the Worker, go to **Settings**, then **Variables and Secrets**, then **Add**.
2. **Type:** Secret. **Variable name:** `RC_PASSWORD`. **Value:** the Running Wild staff password. Use a new one, not the GPT100's.
3. Click **Deploy** (or **Save**).

This is the password staff type into the Medical tab to unlock Control. Buller has no medical plan in the app, so the app checks the password with the Worker.

## 5. Check it

1. Open `https://runningwild-live.chad-ad3.workers.dev/live` in a browser. You should see a short line of text starting `{"now":`.
2. Open the staff app, go to **Medical**, type the password and **Unlock**. Then go to **Control**: the top right shows a green **Live**.
3. In the **Phones** panel, under Field phones on the map, set a team code (for example `BULLER26`).
4. Open the field app on a phone, go to **Where**, and at the bottom, under **Show me on the Control map**, type a call sign and the code. Turn on **Keep updating**. The phone shows on the Control map within a minute.
5. Press **Download tracks** in the Phones panel. The spreadsheet has a row for every minute the phone shared.

If something is wrong:

- **"Race Control isn't set up on the Worker yet"**: the `DB` binding or the `RC_PASSWORD` secret is missing.
- **"Couldn't check the password: no signal, or the Worker isn't set up yet"**: the Worker address in `data/config.js` doesn't match, or step 1 didn't deploy.
- **"That password didn't work"**: `RC_PASSWORD` doesn't match what you typed.

## The sweeps' Garmin inReach units

The sweeps carry Garmin inReach units that report by satellite to the MapShare page `share.garmin.com/Singletracksweeps`. The Worker reads their positions from MapShare (at most once a minute, while a Control board is open) and puts them on the Control map in purple, next to the field phones, and in **Download tracks**. An inReach in SOS shows as a flashing red tag.

The MapShare password stays out of the app and out of GitHub (the repository is public). It goes on the Worker as a secret:

1. In Cloudflare, go to **Workers & Pages**, then **runningwild-live**, then **Settings**, then **Variables and Secrets**, then **Add**.
2. **Type:** Secret. **Variable name:** `GARMIN_PASSWORD`. **Value:** the MapShare password.
3. Click **Deploy** (or **Save**).

Check it: unlock **Control**. Under **Sweeps' Garmin inReach** in the Phones panel it says when the last inReach point came in. "Not set up on the Worker yet" means the secret is missing; "can't read MapShare" means the password is wrong or MapShare is down. The **MapShare** button opens Garmin's own map page.

Points older than 6 hours drop off the map, so the units show once their tracking is on. If the MapShare name changes, set `GARMIN_SHARE` as a Worker variable (plain text, not secret).

## Not needed for the test

The GPT100 Worker also refreshes the weather (`GITHUB_TOKEN`), relays the timing and GPS feeds (`TIMING_URL`) and sends checkpoint alerts (a one-minute timer). Buller has no weather watch, trackers or chip feed in the app, so none of those are set up. Everything else still works without them.

## After the test

Download the tracks first. Then, to clear the database before the next event, open `runningwild-race-control` in Cloudflare, go to **Console**, and run:

```
DELETE FROM field_track; DELETE FROM field_pos; DELETE FROM settings WHERE k LIKE 'garmin_%'; DELETE FROM notices; DELETE FROM faults; DELETE FROM incidents; DELETE FROM units; DELETE FROM log; DELETE FROM rate;
```
