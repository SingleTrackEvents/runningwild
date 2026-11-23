// Race-day settings shared by the staff app and the admin page.
// Mt Buller SkyRun, Sun 6 December 2026: the Running Wild tracking test (docs/SCOPE.md, section 8, phase 0).
window.GPT100_CONFIG = {
  event: 'Mt Buller SkyRun',
  // Response base. Keys match the drive_<key>_s fields on each access point (none have drive times yet).
  bases: [
    { key: 'mb', name: 'Mt Buller Village', color: '#c0392b' }
  ],
  // Estimate assumptions (the GPT100's).
  walkPace: 12,     // responder on foot, min per km
  evacPace: 30,     // stretcher / carry-out, min per km
  carryFactor: { hard: 1.75, unassessed: 1.5 },
  slowWalk: [],
  climbPenalty: 0.10, // min per metre of ascent (10 min per 100 m, Naismith), walking in and carrying out
  nightFactor: 1.3, // walk-in and carry-out take this much longer between sunset and sunrise (not the drive)
  driveFactor: 1.2, // multiplier on measured drive times for access roads
  // Races on the main course (the 45km), for converting a runner's race km. Each Buller race has its own course.
  races: [
    { id: '45k', label: '45km', from: 'Mt Buller Village (Start)', to: 'Mt Buller Village (Finish)' }
  ],
  // Run sheet ratings, in minutes to reach a casualty.
  amberMin: 60,
  redMin: 120,
  // Weather. The trigger levels are the GPT100's (Risk Management Plan v3.2): to confirm against the Buller plan.
  weather: {
    dataUrl: '',  // no hourly weather watch for the test
    // The Running Wild Worker (tools/refresh-worker.js; setup in tools/RUNNING_WILD_WORKER.md): the Control board,
    // the line to the phones and the tracking test's position history.
    refreshUrl: 'https://runningwild-live.chad-ad3.workers.dev',
    event: { start: '2026-12-06T08:00', end: '2026-12-06T17:00' },  // first start to last cut-off
    alertsFrom: '2026-12-04T00:00',
    dailyUpdate: { from: '2026-12-04', hour: 9 },
    districts: ['North East'],  // CFA fire district and BOM warning area for the course
    ridgeMinEle: 1400,  // course points at or above this height (m) count as ridges and high ground
    staleHours: 3,
    models: ['ecmwf_ifs025', 'ecmwf_aifs025_single', 'gfs_seamless', 'icon_seamless', 'ukmo_seamless',
      'meteofrance_seamless', 'gem_seamless', 'jma_seamless', 'cma_grapes_global'],
    modelEveryHours: 3,
    replayYears: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
    ensembles: { models: ['ecmwf_ifs025', 'ecmwf_aifs025', 'gfs025', 'ukmo_global_ensemble_20km', 'icon_seamless', 'gem_global'], everyHours: 6, closeChance: 30 },
    verify: { days: 7, minHours: 48, minWeight: 0.4 },
    obsRadiusKm: 60,
    incidentKm: 40,
    fireNearKm: 20,
    bomForecastPlaces: ['Mount Buller', 'Mansfield'],
    epaSites: 3, epaMaxKm: 60,
    warningWords: ['North East', 'Mount Buller', 'Mt Buller', 'Mt Stirling', 'Mansfield', 'Merrijig', 'Howqua', 'Alpine'],
    triggers: {
      heat: { met: 36, close: 32, wbgtMet: 30, wbgtClose: 28 },
      wind: { met: 60, close: 50, proposed: true },
      rain: { met: 40, close: 20 },
      cold: { met: 0, close: 3, rainMm: 1, windKmh: 40, hours: 3, proposed: true },
      storm: { close: 2, met: 3, capeClose: 800, proposed: true },
      smoke: { met: 150, close: 100, proposed: true },
      cloud: { hours: 3, agree: 50, rh: 93, minEle: 1600, advisory: true,
        zones: [{ name: 'Mt Stirling', fromKm: 7, toKm: 18 }, { name: 'Mt Buller summit', fromKm: 40, toKm: 42 }] },
      fire: {}
    }
  },
  // Live runner positions: none for the test (no trackers or chip timing feed at Buller). The field phones that share
  // their position with the team code show on the Control board's map (js/live.js, tools/LIVE.md).
  planPlaces: {},
  tracking: { url: '', results: '', label: 'Live tracking', gps: [], chip: '', credit: '' },
  // what3words API key. It's locked in the what3words dashboard to singletrackevents.github.io,
  // so it only works from the live site. Leave blank to be asked once on each device instead.
  what3wordsKey: 'LBTPEWCQ'
};
