# Running Wild Safety App: Scope

Draft v0.4, 24 November 2026. v0.4 records decision 12: one shared core for every SingleTrack event, built in [SingleTrackEvents/singletrack-app](https://github.com/SingleTrackEvents/singletrack-app) (formerly BuffaloStampede), with Running Wild, Buffalo Stampede and the GPT100 as event packs on it. v0.3 adds decisions 9 to 11 (Medical and Risk tabs out, Weather condensed, the logo). v0.2 records the decisions on the scope questions (section 9) and adds planning for race rego and volunteer rego (section 10). Prepared for Chad Freak, Operations Manager.

This scopes a safety app for the SingleTrack Running Wild series, built on what the GPT100 Safety app already does. It covers what carries over, what has to change so one app runs every Running Wild event, what's new, and a build plan against the season dates.

Built from: the GPT100 app ([SingleTrackEvents/GPT100](https://github.com/SingleTrackEvents/GPT100), build as at 16 November 2026), the Day 1 notes (17 November) and the Day 2 notes (18 November).

The decisions made on 23 November are in section 9. Linking to race rego and volunteer rego is not in this build, but section 10 sets out how we build now so it can link later.

## 1. What we're building

One app for the whole Running Wild season that answers the same question the GPT100 app does: **a runner needs help at this spot, who do we send and how long will it take?**

It keeps the GPT100 app's three faces:

- **Staff app** for whoever takes the call: Find, Weather and Control (no Medical or Risk tab: decided 24 November).
- **Field app** for Safety Officers, sweeps, marshals, medics and Alpine Search and Rescue on the course.
- **Runner app** for runners and their crews.

The difference is that every Running Wild event lives inside it. You open the app, it knows which event is on (or next), and everything (courses, aid stations, access points, posts, weather triggers, schedule, gear) is that event's.

## 2. The events

| Event | Date | Setting | What matters most for the app |
| --- | --- | --- | --- |
| Mt Buller SkyRun | Sun 6 Dec 2026 | Alpine resort | Two road crossings (one beside an aid station), marshals at Craig's Hut, Cornhill Road, the gate-touch point and the summit, Safety Officer at Mirimbah Park, 4WD retrieval at the village, two Starlinks. Phone tracking trial agreed for here |
| Kilcunda Trail Running Fest | Sun 31 Jan 2027 | Coast (Bass Coast) | 2 medics, no Safety Officers, proficient sweepers. Heat |
| Snow Gum Run, Mt Baw Baw | Sun 28 Feb 2027 | Alpine | No phone reception. Remote split marshal on a Starlink Mini and radio. 2 medics, 2 Safety Officers, possibly Camp Saddle |
| Razorback Run | Sat 13 Mar 2027 | Alpine (Harrietville, Hotham, Feathertop) | Medics at Diamantina and the Harrietville finish. Safety Officers at the Harrietville and Feathertop junctions, one floating in the 37K. New West Kiewa water and safety point. About 20 trackers quoted |
| Alpine Challenge | Sat 3 Apr 2027 | Alpine (Falls Creek) | Biggest of the series. Field hospital at Falls Creek, EMS at Mt Loch car park and Warby Corner, ASR and Safety Officers across the course, dedicated trackers |
| Wilsons Prom Running Festival | Sat 1 May 2027 | Coast (national park) | Medics at base and Telegraph Junction. Safety Officer pairs at Sealers Cove (rope at high tide), Waterloo Bay and the Lighthouse, 2 to 3 mobile at Telegraph, a roamer from Tidal River. Road crossings |

(From the Day 1 crew table and the Day 2 medical and safety scope.)

## 3. How it has to differ from the GPT100 app

### 3.1 Many events, one app

The GPT100 app is built for one event. Its settings, courses and data are one set of files, and about 300 places in the code name the GPT100 directly. For Running Wild:

- **Event packs.** Each event is a folder of its own data: courses, aid stations, access points, response bases, Safety Officer and marshal posts, track grades, helicopter sites, what3words, weather settings, schedule, gear list and contacts. The app code knows nothing about any one event.
- **Event picker.** The app opens on the event that's on now or next. Past events stay readable for the debrief. Staff can switch to any event for planning.
- **Several courses per event.** Most Running Wild events run several distances on different lines (not one long course cut into races, as at the GPT100). Every course needs its own km, sections and cut-offs, and Find has to place a casualty on the right one.
- **Offline maps per event.** The GPT100 app ships about 30 MB of topo map tiles in the site. Six events' tiles can't all go on every phone, so each event's map is saved on the phone only when someone picks that event.
- **One look.** One brand, "SingleTrack Running Wild". The event illustrations stay on bibs, medals and patches, not in the app. Red stays for Urgent and Call 000.

### 3.2 A lean crew, not a race control room

The GPT100 has a Race Control room, a response team at three bases and dozens of Safety Officers. Running Wild runs on about three staff per event, setting up on race morning.

- **Control on a phone.** The board has to work for one person on a phone who is also doing three other jobs. Help requests and incidents need to buzz that phone (push alerts), not wait for someone to look at a screen.
- **Response bases are people, not places.** At the GPT100 a team leaves Halls Gap, Jimmy Creek or Dunkeld. At Running Wild it's usually the 4WD at the village, a roaming staff member or the nearest Safety Officer. Find should rank whoever is on duty, wherever they are now (from the field app's live position), not only fixed bases.
- **Less to set up.** Three tabs: Find, Weather and Control. No Medical or Risk tab; the staff password goes on the Control tab.

### 3.3 Tracking without trackers

The GPT100 used GPS trackers on every Miler and chip timing at the mats. Most Running Wild events won't have trackers (Day 2: phones trialled at Buller; Razorback about 20 trackers; Alpine Challenge, as a premier event, dedicated trackers).

- **Phone tracking, opt-in.** Runners and field crews share their position from the app with a code. Chad's Safety Officer opt-in tracking is the starting point.
- **The hard limit.** A web app (which is what the GPT100 app is) can't send a position while the phone is locked or the app is in the background. On the GPT100 that's why Follow me needs Keep screen on. That's fine for a Safety Officer at a post with a battery pack, but not for a runner for 6 hours. **Decided:** season 1 stays a web app, so runner phone tracking is best effort, with trackers at Razorback and Alpine Challenge. An App Store and Google Play app for background location comes later, alongside rego (section 10).
- **Mixed feeds.** The same event may have trackers on some runners, phones on others and chips at a few mats. The GPT100 app already blends GPS and chips; it needs to take phones as a third feed.
- **Battery and reception.** No reception at Snow Gum Run, patchy at the Prom and Razorback. Positions queue on the phone and send when there's signal, and the app says how old every position is.

### 3.4 Checkpoints and sweeps

At the GPT100, chip mats told us who had passed. At Running Wild, clipboards are the backup and often the only record. Day 2 noted an app could replace the handwriting.

- **Checkpoint log.** A marshal or sweep types or taps bibs as runners pass. It works with no signal and sends when it can. Race Control sees who's through each checkpoint and who hasn't arrived.
- **Sweep check.** The sweep confirms the course is clear behind them, section by section. Runners not yet seen by the sweep stay on the watch list.
- **Who's still out.** One list: started, not through the last checkpoint, not finished, not withdrawn. This is the list we need at the end of every Running Wild day.

### 3.5 Different country, different hazards

The GPT100's weather tab is built around the Grampians in early fire season. Running Wild covers alpine and coastal courses from December to May.

- **Triggers per event.** Each event pack carries its own trigger levels from its own Risk Management Plan: cold and wind on the alpine events, heat on the coast and in summer, lightning on exposed tops, smoke and fire across the season.
- **Tides.** The Prom (Sealers Cove rope at high tide) and any beach section on the Bass Coast need tide times against when runners will reach each crossing, much as the weather simulator puts the fastest and slowest runners against the forecast.
- **Fire districts and warning areas** set per event, for the CFA ratings, BOM warnings and VicEmergency.
- **Road crossings** as their own point type, with the marshal or traffic management post on them (Buller, the Prom).

### 3.6 Data for each course

The GPT100 response times lean on data that took a lot of work to gather: Parks Victoria track grades, DEECA helicopter sites, drive routes, stepped-height fixes and what3words for the whole course. We can't hand-build that six times a season.

- **A setup tool.** Load a GPX for each course, the aid stations and posts from a spreadsheet, and the tool fetches what3words, heights, drive times and map tiles, and flags what needs checking by hand.
- **Fill gaps safely.** Where track grades or helicopter sites don't exist for a course (the resorts, for example), the app says "not yet assessed" and uses the slower carry-out factor, as the GPT100 app already does.
- **Who sets up an event.** **Decided:** Chad runs the setup scripts in season 1. The spreadsheet template is built during the season so Julie and the team can set up events from season 2.

### 3.7 Partners on the course

- **Alpine Search and Rescue** at Buller, Razorback and Alpine Challenge, and the resort teams at Buller and Baw Baw. They get the field app and a team code, so they're on the Control map and in Find's answers.
- **Medics** (Race Day Medical). Day 2 found the GPT medics struggled with the emergency app, what3words and maps, and had no induction. The app needs a short tools induction for medics (a guided first-run) and nothing a medic needs should be behind more than one tap.

### 3.8 Content

- **Help tab.** **Decided:** English only. The GPT100's language setup stays in the code, so a language can be added for an event that needs it.
- **Schedule and gear** per event, from each event's page on singletrack.com.au.
- **Crew mode** only where the event allows crewing (likely Alpine Challenge, not the shorter events).

## 4. What carries over from the GPT100 app

Most of it. The GPT100 app is about 10,000 lines of tested code and a lot of it is not specific to the Grampians.

| Carry over as is (once it reads the event pack) | Needs reworking | Leave out for now |
| --- | --- | --- |
| Find: km, coordinates or what3words to the team, parking, walk-in, ETA and carry-out | Response bases (people on duty, not fixed places) | GPT contingency and original course switch |
| Night factor, climb penalty, slow sections, 2 and 4 hour escalation warnings | Tracking (add phones as a feed) | Stage race km conversion |
| what3words throughout, with stored words offline | Weather triggers (per event, plus tides) | The 2026 fitted splits (no Running Wild timing history yet) |
| Field app: Where am I?, nearest way out, Send my location, Urgent | Offline map tiles (saved per event) | Five-language Help tab (unless needed) |
| Control board: incidents, units, radio log, export, notices, help requests | Weather tab (condensed for phones) | Race archive for predictions (later) |
| | Branding (one Running Wild look) | Medical and Risk tabs |
| Weather: models, ensembles, BOM warnings, observations, CFA, EPA, VicEmergency | Event setup tools (from command line scripts to a repeatable process) | |
| Runner app: map, aid stations and cut-offs, Help, Schedule, Gear, off-course alert | | |
| Offline-first, build numbers, crash tests | | |

## 5. What's new

1. Event packs and the event picker.
2. Several courses per event, each with its own km and cut-offs, and Find working out which course a casualty is on.
3. Phone tracking for runners and field crews (opt-in, with a code), as a feed alongside trackers and chips.
4. Checkpoint and sweep logging that works with no signal, and the "who's still out" list.
5. Push alerts to the on-duty staff phone for help requests, incidents and runners flagged on the watch list.
6. Find ranking the people on duty by where they are now.
7. Tide times against runner arrival for coastal crossings.
8. Road crossings and marshal posts as their own point types.
9. A setup tool so a new event goes from GPX and a spreadsheet to a working pack in a day, not weeks.
10. A tools induction for medics, ASR and new Safety Officers.

## 6. Out of scope for this build

- Registration (Race Roster stays), the volunteer platform (Chad's iVolunteer replacement, from January) and results. The app links to them.
- One SingleTrack login across rego, volunteering and the app (Day 2). We build so it can plug in later (section 10), but not now.
- Buffalo Stampede and the GPT100 themselves. **Decided 24 November (decision 12):** they are event packs on the same shared core as Running Wild, in `singletrack-app`. Buffalo's own scope is in that repository (`docs/SCOPE.md`).

## 7. How we build it

The shared core is built in `singletrack-app`, starting from this repository's code (the GPT100 app made event-neutral). Everything event-specific moves into event packs, and each event switches on the modules it needs: Running Wild leaves Medical and Risk off (decision 9), Buffalo and the GPT100 switch on nearly everything. We leave the live GPT100 repository untouched until the GPT100 2027 moves across. This repository stays as it is for the Mt Buller tracking test (phase 0).

Two guard rails keep one codebase safe for many events: each event pack runs its own crash tests and demo before release, and each event locks to a tested build a week before race day, so a change made for one event can't reach another's race week.

Keep what works on the GPT100: plain web app (no build step), Leaflet maps, GitHub Pages hosting, the Cloudflare Worker for the live line, Race Control database and relays, and the crash tests before every release.

Season 1 keeps the GPT100's shared medical password and team codes, and the app stays on GitHub Pages next to the GPT100. Both are quick and proven. Both get replaced when rego arrives (section 10), so we build them in one place each, behind the Worker, to keep that swap small.

The App Store and Google Play app (for runners' background location) waits until rego and volunteer rego, when people need one login on their phone anyway.

## 8. Build plan

| Phase | Ready for | What ships |
| --- | --- | --- |
| 0. Tracking test | Mt Buller, 6 Dec 2026 | The GPT100 field app pointed at the Buller course, to test Safety Officer and phone tracking: battery use, how often fixes come through, Starlink, and how it looks on the Control map. No new build |
| 1. Core | Kilcunda, 31 Jan 2027 | In `singletrack-app`: event packs and picker, several courses per event, staff Find, field app, runner app (map, aid stations, Help, Schedule, Gear), Control on a phone with push alerts, weather with per-event triggers, setup tool v1. Kilcunda and Buller packs built |
| 2. No signal | Snow Gum Run, 28 Feb 2027, and Razorback, 13 Mar 2027 | Checkpoint and sweep logging offline, who's still out, queued positions, trackers for Razorback merged with phones |
| 3. The big ones | Alpine Challenge, 3 Apr 2027, and Wilsons Prom, 1 May 2027 | ASR and partner access, tides for the Prom, road crossings, dedicated tracker feed for Alpine |
| 4. Review | After the Prom | Season debrief. Move the GPT100 2027 onto the shared core (Buffalo is already on it, 19 to 21 March). Hand event setup to the team with the spreadsheet template. Plan the rego and volunteer rego link (section 10) |

Each phase finishes with a rehearsal using the in-app demo (made-up runners played through the event) and the crash tests, at least a week before the event.

## 9. Decisions

Made on 23 November 2026.

| # | Question | Decision |
| --- | --- | --- |
| 1 | What happens at Buller? | Tracking test only. The GPT100 field app on the Buller course, testing Safety Officer and phone tracking. The proper build starts for Kilcunda |
| 2 | How do we track runners? | Web app now, App Store and Google Play app later. Runner phone tracking is best effort in season 1, with trackers at Razorback and Alpine Challenge |
| 3 | Who sets up an event? | Chad in season 1, using setup scripts. The spreadsheet template is ready for the team from season 2 |
| 4 | Languages? | English only, with the language setup kept in the code |
| 5 | One app for everything? | Yes, decided 24 November: see decision 12 |
| 6 | Logins? | Keep the GPT100's shared passwords and team codes for season 1 |
| 7 | Which events get the runner app? | Every event |
| 8 | Where does the app live? | GitHub Pages for now, next to the GPT100 |
| 9 | Medical and Risk tabs? | Not needed for Running Wild (24 November). The staff password unlocks Control from the Control tab |
| 10 | Weather? | Keep every part (triggers, warnings, CFA, timeline, simulator, models, observations, BOM forecast, share), condensed to read easily on a phone (24 November) |
| 11 | Branding? | The SingleTrack Running Wild logo in the app, on the home screen icon and the Android app (24 November) |
| 12 | One shared core? | Yes (24 November). Running Wild, Buffalo Stampede and the GPT100 run on one core with event packs and switchable modules, in `singletrack-app`. Buffalo (19 to 21 March 2027) is built on it alongside Running Wild, so the core is due for Kilcunda as planned. Branding becomes part of each event pack, so Running Wild keeps its own logo |

Still open:

- **Course data.** Does Parks Victoria or Alpine Resorts Victoria have track grades and emergency markers for the alpine and Prom courses, as we got for the Grampians? Owner to confirm. Without them those courses use the "not yet assessed" carry-out times.

## 10. Planning for race rego and volunteer rego

Linking this app to race rego and volunteer rego is not in this build. It's where we're heading: one SingleTrack login across rego, volunteering and the app (Day 2), with Chad's volunteer platform starting in January and the rego platform after it.

What we do now costs little and saves a rebuild later.

### 10.1 Build now

- **Events and races have fixed IDs.** Every event pack and race gets an ID that doesn't change from year to year. We store Race Roster's event and race IDs against them now, and our own rego's later.
- **Runners come in through one import.** Each event loads its runner list (bib, name, race, wave, phone, and up to three crew contacts, which Day 1 asked Race Roster to collect) from a Race Roster export. When our own rego exists it fills the same shape, so nothing in the app changes. The list is locked behind the medical password, like the GPT100's medical plan, since Day 1 found staff couldn't reach runners overnight because few people had the numbers.
- **Crew come in through one import.** The volunteer roster (who's on which Safety Officer post, checkpoint, sweep or aid station, and when) loads the same way, from iVolunteer now and from the new volunteer platform from January. The field app can then show a volunteer their post, and Find knows who is on duty where.
- **One way in to the data.** Every read and write of private data goes through the Worker, not straight from the page. When passwords give way to logins, only the Worker changes.
- **Every record names a person and an event.** Incidents, checkpoint reads, help requests and positions are stored against a bib or crew call sign and an event ID, so they can later be tied to a SingleTrack account.

### 10.2 What the link brings later

| From race rego | From volunteer rego |
| --- | --- |
| A runner opens the app already signed in, on their own event, race and bib | A volunteer opens the app on their own shift and post, with their role brief |
| Emergency contacts and medical notes, with consent, straight to the medical team | Check-in and in-position times recorded in the app (a Day 2 volunteer platform requirement) |
| Rego check-in and the Telstra SIM check in the app | Shift changes and notices pushed to that volunteer's phone |
| Phone tracking consent given at entry | Safety Officer kit and briefing sign-off |
| Results and history on the runner's profile | Volunteer history and Hall of Fame |

### 10.3 What has to happen first

- **Architecture and data protection review.** Day 2 agreed to bring Joe Brand in on architecture and data protection before any rego build, and Michelle asked for an expert-designed architecture with redundancy. The app joins that review before it links to anything: it holds runners' locations, phone numbers and medical details.
- **Logins replace shared passwords.** SingleTrack Google accounts for staff, and the shared login for runners and volunteers.
- **The App Store and Google Play app.** Background location for runners, and a signed-in app people keep on their phone all season.
- **Moving off GitHub Pages.** A SingleTrack address (for example app.singletrack.com.au) beside rego and volunteer rego. Moving resets runners' saved maps and home screen icons, so we move between seasons, not mid-season.
