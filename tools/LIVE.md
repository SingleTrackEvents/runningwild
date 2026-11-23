# The line to the phones

From build 104 the apps talk to Race Control through the same Cloudflare Worker that runs the weather refresh and the Control board (`gpt100-refresh`). This page covers what that adds, the two things to do in Cloudflare, and how to run it on the day.

| What | Where people see it | Who switches it on |
| --- | --- | --- |
| **Notices** from Race Control | A banner under the header of every app, within a minute. It stays on the phone with no signal. | Anyone on the Control board |
| **Tell Race Control** (help requests) | Runner app, Help tab. Field app, Send card. Lands on the board as an incident to acknowledge. | A switch on the Control board |
| **Field phones on the Control map** | Field app, Where tab: Show me on the Control map | A team code set on the Control board |
| **Alerts** | Runner app, Track tab: Turn on alerts. Field app, Home tab. | Each person, on their own phone |
| **Fault reports** | The Control board's Phones panel | Nothing to do |

Nothing new needs a password on the phones. The board's side uses the medical password, as before.

## Setup (10 minutes, once)

You need Race Control already set up: the `DB` database and the `RC_PASSWORD` secret from [RACE_CONTROL.md](RACE_CONTROL.md).

### 1. Update the Worker code

1. In Cloudflare, go to **Workers & Pages**, then **gpt100-refresh**, then **Edit code**.
2. Delete everything in the editor and paste in the whole of the latest [`refresh-worker.js`](refresh-worker.js).
3. Click **Deploy**.

The Worker makes its new tables itself the first time a phone asks. Until the new code is in, the apps simply don't show the new parts: nothing breaks.

### 2. Add a second timer, for alerts

Alerts for followed runners come from the Worker checking the timing list once a minute.

1. In the Worker, go to **Settings**, then **Trigger Events**, then **Add**, then **Cron Triggers**.
2. Enter `* * * * *` (every minute) and save. Keep the 15 minute trigger that's already there.

Without this second timer everything else still works, and Race Control's notices still reach phones with alerts on. Only the checkpoint alerts are missing.

Checkpoint alerts are sent during the race window only (`ARCHIVE_FROM` to `ARCHIVE_TO` in the Worker, the same dates as the race archive). Set those for next year's race when you set the archive dates.

### 3. Check it

1. Open the staff app where the Medical tab is unlocked and go to **Control**. In the Units column there is a new **Phones** panel.
2. Send a notice to every phone. Open the runner app on another phone: the banner shows within a minute.
3. Turn **Help requests from the apps** on. In the runner app's Help tab, **Tell Race Control** appears within a minute. Send one, and acknowledge it on the board.

## On the day

### Notices

Type the notice, pick who it's for (every phone, runners and crews, or the field app) and how long it stays up. Tick **Important** for a red banner people can fold away but not dismiss. **Take down** removes it. Every notice goes in the radio log.

Phones with alerts on get a notification as well.

### Help requests

Leave the switch **off** unless someone is watching the board. The apps only offer Tell Race Control while the switch is on **and** a board has been open in the last three minutes, so a request never goes to an empty room.

- A request arrives as a flashing card with three tones, marked **New help request**, with the bib, the km or position, and what the person chose.
- Press **Acknowledge**. The sender's phone then says "Race Control has your message". Dispatch and close it like any other incident; the phone is told when help is sent.
- With no signal the request waits on the sender's phone and goes when signal returns. Their screen says which.
- Call 000 and Call race medical stay at the top of the Help tab. The card says it does not replace a phone call.

A phone can send ten requests in ten minutes, and the Worker takes sixty in ten minutes from everyone. After that the app tells the person to call instead.

### Field phones on the map

Set a **team code** in the Phones panel (for example `PEAKS26`) and give it out at the Safety Officer briefing. In the field app, Where tab, a Safety Officer types a call sign and the code, and their phone shows on the Control map as a blue tag, updated about once a minute while the app is open with Keep updating on. Each incident card names the nearest field phone.

Clear the code to stop all sharing. Change it and every phone has to type the new one.

### Alerts

People turn these on themselves. They get a notification when a runner they follow reaches a timing point, finishes or withdraws, and for Race Control's notices.

- **Android:** works in Chrome, installed or not.
- **iPhone:** the app has to be on the home screen first (Share, then Add to Home Screen), on iOS 16.4 or later. The app says so.
- Alerts follow the timing chips, so they are as fast as the timing list: usually within a minute or two of the mat.

The Phones panel shows how many phones have alerts on.

### Fault reports

If the app's own code hits an error on a phone, the Worker is told: which app, the build, the message, and the file and line. Nothing about the person: no bib, name, position or link. The Phones panel shows a count, and **Show** lists them. One fault on 300 phones is one row with a count of 300. If `NTFY_TOPIC` is set, a new kind of fault also goes to your phone.

Clear them once they've been looked at.

## What it costs the Worker

Each phone with an app on screen asks for notices once a minute. That is about a sixth on top of what the tracking and timing relays already carry, and less than the saving from build 104's slower updates when the app is off screen. A field phone that is sharing writes its position once a minute; thirty of them all day is about 43,000 database writes, inside the free plan's 100,000 a day.

## Rehearse it without Cloudflare

- **The demo:** open `index.html?demo=1` (Control tab), `runner.html?demo=1` and `field.html?demo=1` in three tabs of one browser. Notices, help requests, field phones and fault reports all work between the tabs, with nothing sent anywhere. The demo's team code is `DEMO`. Alerts are not part of the demo.
- **The Worker on your computer:** `node tools/crashtest/worker-local.mjs` runs the real Worker code with a local database (Node 22.5 or later). Open any app with `?api=http://127.0.0.1:8787`, and the staff app with `?rcapi=http://127.0.0.1:8787` as well.
- **The tests:** `node tools/crashtest/run.js quick` includes all of the above. See [crashtest/README.md](crashtest/README.md).

## After the event

To clear notices, field phone positions, fault reports and alert sign-ups before the next event, open the `gpt100-race-control` database in Cloudflare, go to **Console**, and run:

```
DELETE FROM notices; DELETE FROM field_pos; DELETE FROM faults; DELETE FROM push_subs; DELETE FROM push_msgs; DELETE FROM rate;
```

Help requests are incidents, so they go with the board's own export and clear-out in [RACE_CONTROL.md](RACE_CONTROL.md).

## Still to check with people

- **Translations.** The Tell Race Control lines in Japanese, Chinese, Russian and Polish are new and need the interpreter check, like the other app-only lines (noted at the top of `data/safety-cards.js`). What a runner sends is in English whatever language they read.
- **Real phones.** Alerts were tested with a stand-in for the phone makers' alert services. Try one on an iPhone and an Android phone before relying on it.
- **Crew drive times** (`data/crew-drives.js`) come from OpenStreetMap roads, met in the middle with the times on gpt100.com.au/aid-stations (Halls Gap to Dunkeld is 54 minutes: 62 by the road map, 46 on the site). Google Maps refuses lookups by a script, so they have not been checked against it. Spot-check a few legs in Google Maps, and when the website's times change, change `PUBLISHED` at the top of `tools/crew_drives.mjs` and run it again.
