# Album de absolvire — Clasa a IV-a

Static PWA (vanilla JS, no build step), deployed to GitHub Pages by GitHub Actions.
Installs to the home screen and works offline; see [Installing and working
offline](#installing-and-working-offline).

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` publishes the repo root to Pages on every push to `main`, and on demand via **Actions → Deploy to GitHub Pages → Run workflow**.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Without it the workflow's deploy step fails.

Live at `https://<user>.github.io/<repo>/`. Every path in the app is relative, so a project page (served from a sub-path) works unchanged.

The workflow rewrites `CACHE` in `sw.js` to the commit SHA before publishing, so you no longer have to bump it by hand — an installed client picks up each deploy.

## Files
- `index.html`, `app.js` — UI: polaroid wall, add-yourself flow (camera + 20 s voice note + signature), per-student page with sticky-note impressions, and the shared photo gallery (*Amintiri*) with its full-screen viewer.
- `store.js` — data layer. `LocalStore` (IndexedDB, default) or `RemoteStore` (your backend).
- `config.js` — set `window.API_BASE` to switch to the backend. Empty string = local only.
- `export.js`, `zip.js`, `pdf.js` — the download: a browsable offline copy of the album as a `.zip`, and a printable `.pdf`. See [Taking the album home](#taking-the-album-home).
- `sw.js`, `manifest.webmanifest`, `icon*.svg`, `icon*.png` — installable/offline app shell. `CACHE` is stamped at deploy time by CI.
- `tools/make-icons.py` — regenerates the PNG icons from the two SVGs. Not deployed.

## Installing and working offline

The album installs to the home screen and runs without a network.

**Install.** A button in the header offers it as soon as the browser does
(`beforeinstallprompt`, which we intercept so the browser's own infobar stays out of
the way). Safari never fires that event, so on an iPhone the button is shown anyway
and explains the two taps by hand — which is where most of these families are. The
button disappears once the app is installed.

**Icons.** `icon.svg` is the artwork; `tools/make-icons.py` rasterises it into the
PNGs the platforms actually require — Chrome wants 192 and 512 PNGs before it will
offer an install, and iOS refuses an SVG touch icon outright. `icon-maskable.svg` is
the same drawing scaled into the middle 80% on a full-bleed background, so an Android
launcher can crop it to a circle or a squircle without slicing the polaroid. Rerun the
script (`pip install cairosvg && python3 tools/make-icons.py`) whenever the artwork
changes; the PNGs are committed.

**Offline.** The service worker precaches the app shell at install, plus the Google
Fonts stylesheet and font files in a cache of their own — without those the album
loses its handwriting the moment it goes offline. The shell is served **cache-first,
on purpose**: a deploy changes `index.html` and `app.js` together, so serving a fresh
page against a cached script would break the app in ways neither file shows on its
own. Every response therefore comes from a single cache generation. Nothing else is
cached — the API in `API_BASE` and the photos it serves always go to the network, so
nobody sees a stale classmate list and the cache cannot grow without a bound. The
album's own data lives in IndexedDB, not here.

**Updates.** CI stamps `CACHE` with the commit SHA, so every deploy is a new
generation. The new worker installs its cache alongside the old one and then *waits*
rather than taking over: a child halfway through a photo, a recording and a signature
should not have the page swapped under them. The page shows a "versiune nouă" banner,
and only when the reader accepts does the worker activate and the page reload — whole,
never half-new. A page left open for days re-checks hourly.

## Taking the album home

**Descarcă albumul** in the header offers two copies of the album as it stands.
Both are read-only, and that is the point: an album a child takes home should be a
keepsake, not a second editable copy that quietly drifts from the real one. Both are
built in the browser from `store`, so they work the same against IndexedDB or a
backend, and they work with no network — the three scripts are precached with the
rest of the shell.

**`.zip` — the whole album, browsable offline.** A folder of plain HTML: `index.html`
with the polaroid wall and the photo grid, a page per classmate under `elevi/` with
their portrait, voice note, signature and every impression, `amintiri.html` with the
photos full-size, and `media/` holding the actual files. There is **no JavaScript in
it at all** — no forms, no service worker, nothing to go stale — so it opens off a
memory stick years from now by double-clicking `index.html`. `date.json` carries the
same data structured, for whatever comes after this app. `zip.js` writes the archive:
local header, central directory, CRC-32, text deflated through `CompressionStream`
where the browser has it, photos and audio stored as-is because they are compressed
already. Blobs stay Blobs in the parts list and are read once to hash, so a large
album never sits in memory twice.

**`.pdf` — one file to print.** Cover, the wall, a page per classmate with their
impressions as the same coloured sticky notes, then the photos. Bookmarked by
section. `pdf.js` writes it by hand — objects, xref, content streams — because the
repo has no build step and a PDF does not need one. Photos go in as JPEG bytes
(`/DCTDecode`) after a resize through canvas, which also flattens the transparent
signature PNGs onto white. Voice notes cannot travel in a PDF; the cover says so and
points at the `.zip`.

Text is the one place a PDF fights Romanian. Nothing is embedded — the two Helvetica
faces are the reader's — but WinAnsi has `â` and `î` and not `ă`, `ș` or `ț`. So six
codes WinAnsi spends on glyphs no Romanian word needs (`Scaron` and friends) are
remapped to `abreve`, `scedilla`, `tcommaaccent` and their capitals, which every
substitute font actually has, and a `/ToUnicode` map sends them back to U+0103,
U+0219 and U+021B — the page shows `ș`, and copying it out of the PDF yields the
right code point rather than a cedilla or a question mark. Widths are declared in
`/Widths` and measured with those same numbers, so a line that fits when we lay it
out fits when the reader draws it. Titles and bookmarks are UTF-16BE instead, since
PDF reads those itself rather than drawing them with our font.

## Backend contract (what `RemoteStore` expects)
All requests carry `X-Class-Code: <code>`; the client prompts for it once and keeps it in `localStorage`. Return 401/403 to make the client forget it and re-prompt.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/students` | — | `[{ id, name, photoUrl, audioUrl, signatureUrl, createdAt }]` (urls absolute or same-origin; `null` if missing) |
| POST | `/students` | `multipart/form-data`: `name`, `photo` (JPEG ≤ 800×800), `audio` (webm/opus or mp4), `signature` (PNG, transparent, ≤ 800 px wide) — all three optional, at least one required | `{ id }` |
| GET | `/students/:id/impressions` | — | `[{ id, studentId, from, text, color, createdAt }]` |
| POST | `/students/:id/impressions` | JSON `{ from, text, color }` — `color` ∈ yellow/blue/pink/green, `text` ≤ 300 chars | the created impression |
| GET | `/photos` | — | `[{ id, url, thumbUrl, caption, from, createdAt }]`, newest first (`thumbUrl` may be `null` — the client falls back to `url`) |
| POST | `/photos` | `multipart/form-data`: `photo` (JPEG, longest side ≤ 1600), `thumb` (JPEG ≤ 480), `caption` (≤ 120 chars, may be empty), `from` | `{ id }` |

CORS: allow the Pages origin, `X-Class-Code`, `Content-Type`.

## Signature
Each child signs with a finger on the pad in the add-yourself sheet (a mouse works too). The pad is a canvas driven by pointer events, sized to the device pixel ratio so the ink is crisp, with `touch-action:none` so a finger draws instead of scrolling the sheet. On save the strokes are cropped to their bounding box (plus a small margin), scaled to at most 800 px wide and stored as a transparent PNG — so the signature sits on the paper both under the name on the polaroid and on the child's page. It is optional, like the photo and the voice note; a name plus any one of the three is enough to join the album.

## Photos
The gallery is separate from the portraits on the wall: anyone can add several photos at once (file picker or the phone camera), with one caption and a name for the batch. The browser resizes each one before it is stored — a full-size JPEG (longest side 1600, quality .82) and a thumbnail for the grid (480, .7) — so a 4 MB phone photo lands at a few hundred KB and the grid stays quick.

Locally they go to the `photos` object store in IndexedDB (added in DB version 2; an album created before the gallery upgrades in place). The app asks for `navigator.storage.persist()` on the first save so the browser does not evict the album when space runs low — still, a browser is not a backup: set `API_BASE` if the photos matter.

## Worth doing server-side (kids' data)
- Parental consent before a child is added; keep the class code out of anything public.
- Rate-limit `POST` and cap upload size (~1 MB portrait, ~1 MB audio, ~200 KB signature, ~2 MB gallery photo) — the client resizes before upload, but do not trust it.
- A teacher-only delete/hide endpoint — the client has no delete on purpose, so nobody can remove a classmate's card or a saved photo.
- Impressions are unmoderated by default; a `pending` flag + teacher approval is a small addition if you want it.
