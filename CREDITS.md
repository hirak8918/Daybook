# Credits

Daybook's code and interface are [MIT licensed](LICENSE). The image, type and
brand assets below keep their own terms.

## Logo

The Daybook mark is the owner's artwork. It ships as
`src/assets/logo.svg`, `src/assets/logo.png`, the Windows icon and the tray
glyphs. The app icon is generated from the SVG by `scripts/make-icons.mjs`.

## Archived welcome plates

`v1.4.0` replaced the photographic Welcome screen with a typographic title page,
and `v2.0.0` reduced that page to type and a single field. The three plates are
kept in `assets/onboarding/` as source material, but they are not imported by the
app and do not reach the installer. Two are CC0 (public domain dedication — no
attribution required, credited here because it is right); the third is the
owner's own image.

| File | Title | Author | Licence | Source |
|---|---|---|---|---|
| `assets/onboarding/welcome-hills.jpg` | Foggy mountain | Linh Pham ([@linharex](https://unsplash.com/@linharex)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Foggy_mountain_(Unsplash).jpg) · [Unsplash](https://unsplash.com/photos/Ud8fi9jG44g) |
| `assets/onboarding/welcome-forest.jpg` | Sunset over the mountain forest | Ryan McMahon ([@ryanmcmahonn](https://unsplash.com/@ryanmcmahonn)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sunset_over_the_mountain_forest_(Unsplash).jpg) · [Unsplash](https://unsplash.com/photos/Dmp7MITnr0s) |
| `assets/onboarding/welcome-bg.png` | Knight resting in a golden wildflower meadow | The owner | Used with permission | Supplied with the project |

The `.jpg` and `.png` files are the sources. `npm run assets` keeps the derived
WebPs current, but neither the sources nor the WebPs are bundled with 2.2.0.

## Typeface

| Family | Role | Licence |
|---|---|---|
| [Fraunces](https://github.com/undercasetype/Fraunces) | Every heading, label, figure and body line | [SIL OFL 1.1](https://openfontlicense.org/) |

The woff2 files are copied into `src/assets/fonts/` by `scripts/copy-fonts.mjs`
and loaded from disk. Nothing is fetched at runtime.

## Tooling

React, TipTap, Vite, Tailwind CSS, Electron and electron-builder, each under its
own licence. See `package-lock.json` for the exact tree.
