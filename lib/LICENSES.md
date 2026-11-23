# Files served with the app from other projects

So the apps don't depend on another site being up on race day, these are kept here and saved for offline with each build.

| File | From | Licence |
| --- | --- | --- |
| `leaflet.js`, `leaflet.css`, `images/` | [Leaflet](https://leafletjs.com/) 1.9.4 | BSD 2-Clause. Copyright (c) 2010-2023 Volodymyr Agafonkin, (c) 2010-2011 CloudMade. |
| `fonts/bebas-neue-*.woff2` | [Bebas Neue](https://fonts.google.com/specimen/Bebas+Neue), by Ryoichi Tsunekawa (through Fontsource) | SIL Open Font License 1.1 |
| `fonts/montserrat-*.woff2` | [Montserrat](https://fonts.google.com/specimen/Montserrat) variable font, by Julieta Ulanovsky and others (through Fontsource) | SIL Open Font License 1.1 |

To move to a newer Leaflet: copy `dist/leaflet.js`, `dist/leaflet.css` and `dist/images/` from the npm package over these and bump the build (`node tools/bump_version.mjs`). `fonts.css` names each font file and the characters it covers.
