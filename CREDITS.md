# Credits

Daybook's code and interface are [MIT licensed](LICENSE). The image and type
assets below keep their own terms.

## Welcome plates

The first-run screen cross-fades between three photographs. Two are CC0 (public
domain dedication — no attribution required, credited here because it is the
right thing to do); the third is the owner's own image.

| File | Title | Author | Licence | Source |
|---|---|---|---|---|
| `assets/onboarding/welcome-hills.jpg` | Foggy mountain | Linh Pham ([@linharex](https://unsplash.com/@linharex)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Foggy_mountain_(Unsplash).jpg) · [Unsplash](https://unsplash.com/photos/Ud8fi9jG44g) |
| `assets/onboarding/welcome-forest.jpg` | Sunset over the mountain forest | Ryan McMahon ([@ryanmcmahonn](https://unsplash.com/@ryanmcmahonn)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sunset_over_the_mountain_forest_(Unsplash).jpg) · [Unsplash](https://unsplash.com/photos/Dmp7MITnr0s) |
| `assets/onboarding/welcome-bg.png` | Knight resting in a golden wildflower meadow | The owner | Used with permission | Supplied with the project |

The `.jpg` and `.png` files are the sources. `npm run assets` derives the WebPs
that ship in `src/assets/onboarding/`; the sources themselves are never bundled
into the app.

## Typefaces

| Family | Role | Licence |
|---|---|---|
| [Fraunces](https://github.com/undercasetype/Fraunces) | Display headings and figures | [SIL OFL 1.1](https://openfontlicense.org/) |
| [Geist](https://github.com/vercel/geist-font) | All interface text | [SIL OFL 1.1](https://openfontlicense.org/) |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | Clock, axis ticks, shortcuts, ASCII marks | [SIL OFL 1.1](https://openfontlicense.org/) |

The woff2 files are copied into `src/assets/fonts/` by `scripts/copy-fonts.mjs`
and loaded from disk. Nothing is fetched at runtime.

## Tooling

React, Vite, Tailwind CSS, Electron and electron-builder, each under its own
licence. See `package-lock.json` for the exact tree.
