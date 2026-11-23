# Mt Buller SkyRun: Tracking Test Plan

Sunday 6 December 2026. Draft v0.1, 23 November 2026. Prepared for Chad Freak, Operations Manager.

This is phase 0 of the Running Wild safety app ([SCOPE.md](SCOPE.md), section 8). We put the GPT100 field app and Control board on the Buller courses, give it to the crew, and find out what phone tracking can really do on an alpine course before we design Kilcunda around it.

Decided on 23 November: crew only (no runners), the field app and Control board only (no Find answers, as there are no drive times yet), and a rehearsal from 30 November to 2 December.

## 1. What we want to find out

1. **How often a position gets through.** From each post and on the move, how long are the gaps between fixes reaching Race Control?
2. **Where there's no signal.** Which parts of the course drop out, and do the saved positions arrive once signal comes back?
3. **Battery.** How much battery an hour does sharing use with the screen on? (Android phones report it; iPhones don't.)
4. **Accuracy.** How good is the GPS under trees, in gullies and on the summits?
5. **Screen off.** With the Android app (section 6), does tracking keep working with the phone locked in a pocket?
6. **The crew.** Is it easy to set up at a briefing and to use on the day?

The answers decide how Kilcunda, Snow Gum Run (no reception) and Razorback track their people.

## 2. Who carries a phone

Crew only, each with a call sign:

| Call sign | Who | Where |
| --- | --- | --- |
| SO Mirimbah | Safety Officer (Duncan, to confirm) | Mirimbah Park |
| Marshal Craigs | Marshal | Craig's Hut |
| Marshal Cornhill | Marshal | Cornhill Road crossing |
| Marshal Gate | Marshal | Gate-touch point |
| Marshal Summit | Marshal | Mt Buller summit, from 10:00 |
| Sweep 45, Sweep 36, Sweep 22, Sweep 5 | Sweeps | Behind each race |
| Julie, Chad, Ryan, Emily | Staff | Village and on the move |

The sweeps matter most: they cover the whole course, so their tracks show where signal comes and goes.

## 3. Before the event

| When | Who | What |
| --- | --- | --- |
| By Wed 25 Nov | Chad | Set up the Running Wild Worker in Cloudflare ([tools/RUNNING_WILD_WORKER.md](../tools/RUNNING_WILD_WORKER.md), about 15 minutes) and pick the staff password |
| By Wed 25 Nov | Chad | Turn on GitHub Pages for the runningwild repository (Settings, Pages, deploy from the branch) |
| By Fri 27 Nov | Chad, Julie | Confirm the post positions and shift times (section 7) |
| By Fri 27 Nov | Claude | Fix anything from the checks, and the Android app ready to install (section 6) |
| Mon 30 Nov to Wed 2 Dec | Chad (and anyone keen) | Rehearsal: walk or drive a loop with two phones (one iPhone, one Android), with signal and without, then download the tracks and check them |
| Fri 4 Dec (pack day) | Julie | Battery packs (Nitecore) for every phone on the list, and the team code on the crew sheet |

## 4. The crew briefing (Saturday evening or Sunday morning)

Five minutes, with phones out, on wifi if there is any:

1. Open the field app link and add it to the home screen (iPhone: Share, then Add to Home Screen).
2. Open it from the home screen and tap **Save map for offline** (about 7 MB).
3. Go to **Where**. At the bottom, under **Show me on the Control map**, type your call sign and the team code.
4. Turn on **Keep updating** and **Keep screen on**, and plug in the battery pack when you set off.
5. Android crew with the test app (section 6): open it instead, and the screen can go off.

Tell them: the app stops sending when the screen sleeps or another app is in front (except the Android test app). Call or radio as usual: this is a test, not the safety system.

## 5. On the day and after

- **Race Control:** keep the Control board open in the village (staff app, Medical tab, unlock, then Control). The field phones show as blue tags with their km and battery.
- **During:** note anything odd (a phone that vanished, a wrong km) with the time, in the radio log.
- **After:** press **Download tracks** in the Phones panel, before anyone clears the database. Ask each crew member two questions: was it easy, and did it ever get in the way?
- **Review:** Claude can turn the spreadsheet into a short report: gaps by place, signal dead spots on the map, battery an hour, and web against the Android app.

## 6. The Android test app

An Android build of the field app that keeps sending positions with the screen off, with a notification while it does. It's a test build, installed from one link (Android asks you to allow the install):

https://github.com/SingleTrackEvents/runningwild/releases/download/android-test/RunningWildField.apk

GitHub builds it from `android-app/` whenever the field app changes (`.github/workflows/android.yml`). In the tracks spreadsheet its rows say `apk` under app, and `yes` under background when the screen was off. iPhones can't install test builds without an Apple developer account, so iPhone crew use the web app.

Put it on at least two Android phones that carry the web app too, so the two can be compared from the same pocket.

## 7. To confirm

- **Post positions.** The Cornhill Road crossing and the gate-touch point aren't in the GPX, so they aren't on the map yet. Craig's Hut is placed at the turnaround gate, and the summit marshal at the summit waypoint. All three show as "SO" markers (with Marshal in the popup).
- **Shift times** on the map are a guess: Mirimbah 08:30 to 15:00, Craig's Hut 08:00 to 13:00, summit 10:00 to 17:00.
- **The Worker address** must be `runningwild-live.chad-ad3.workers.dev`, or the app's config changed to match.
- **Joe's GPX spelling.** The 36km and 22km waypoints say "Mt Sterling" and "Mount Sterling". The app uses Mt Stirling.

## 8. What the test build doesn't do

- **Find** gives the course km and the aid stations either side, but no team or ETA (no drive times yet).
- **Weather** has no hourly weather watch for Buller, so the Weather tab is empty.
- **No runner tracking, timing or medical plan** in the app.
- **Climb** is measured from the GPX (45km +2,086 m), not the official figure.
