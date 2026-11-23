# Running Wild Safety

The SingleTrack Running Wild series safety app: a runner needs help at this spot, who do we send and how long will it take? Built on the GPT100 Safety app ([SingleTrackEvents/GPT100](https://github.com/SingleTrackEvents/GPT100)).

Where it's heading, and the decisions so far: [docs/SCOPE.md](docs/SCOPE.md).

## Now: the Mt Buller tracking test (6 December 2026)

This build is the GPT100 field app and Control board on the Mt Buller SkyRun courses, to test phone tracking on an alpine course with the crew. The plan, the briefing and what to confirm: [docs/BULLER_TRACKING_TEST.md](docs/BULLER_TRACKING_TEST.md).

| Page | For |
| --- | --- |
| `field.html` | Safety Officers, marshals, sweeps and staff on the course: where am I, the way out, send my location, and Show me on the Control map |
| `index.html` | Race Control: Find (course km and aid stations), Medical (unlock with the staff password), Control (incidents, notices, field phones on the map, Download tracks) |
| `map.html` | The whole course on one screen |

The runner app is left out of this build.

## Setting up

- **The Worker** (Control board, the line to the phones, the position history): [tools/RUNNING_WILD_WORKER.md](tools/RUNNING_WILD_WORKER.md).
- **Hosting:** GitHub Pages from this repository. The apps sit beside the GPT100 on `singletrackevents.github.io`, so every cache and saved setting here starts `rw` and the app only clears its own caches.

## Course data

`python3 tools/events/buller/build.py <folder of GPX files>` builds the Buller courses, races, cut-offs and posts into `data/` from Joe's GPX files. Then `node tools/fetch_topo_tiles.mjs` saves the topo map along them for offline use (in this cloud environment, run it with `NODE_USE_ENV_PROXY=1`).

## Before a release

`node tools/bump_version.mjs` moves every page and file to a new build number, so phones take the new files as one set.

## How it works

The GPT100 Safety README explains the app in full: [docs/GPT100_README.md](docs/GPT100_README.md). What changed for Running Wild:

- **Events without drive times or a medical plan** work: Find gives the km and the aid stations either side, and the staff password is checked with the Worker.
- **Every field phone fix is kept** with battery level and speed, sent in batches when there's no signal, and downloaded from the Control board as a spreadsheet.
- **Positions across Victoria and southern NSW** are accepted by the Worker.
