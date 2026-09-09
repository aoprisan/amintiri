# Album de absolvire — Clasa a IV-a

Static PWA (vanilla JS, no build step), deployed to GitHub Pages by GitHub Actions.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` publishes the repo root to Pages on every push to `main`, and on demand via **Actions → Deploy to GitHub Pages → Run workflow**.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Without it the workflow's deploy step fails.

Live at `https://<user>.github.io/<repo>/`. Every path in the app is relative, so a project page (served from a sub-path) works unchanged.

The workflow rewrites `CACHE` in `sw.js` to the commit SHA before publishing, so you no longer have to bump it by hand — an installed client picks up each deploy.

## Files
- `index.html`, `app.js` — UI: polaroid wall, add-yourself flow (camera + 20 s voice note), per-student page with sticky-note impressions, and the shared photo gallery (*Amintiri*) with its full-screen viewer.
- `store.js` — data layer. `LocalStore` (IndexedDB, default) or `RemoteStore` (your backend).
- `config.js` — set `window.API_BASE` to switch to the backend. Empty string = local only.
- `sw.js`, `manifest.webmanifest`, `icon.svg` — installable/offline app shell. `CACHE` is stamped at deploy time by CI.

## Backend contract (what `RemoteStore` expects)
All requests carry `X-Class-Code: <code>`; the client prompts for it once and keeps it in `localStorage`. Return 401/403 to make the client forget it and re-prompt.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/students` | — | `[{ id, name, photoUrl, audioUrl, createdAt }]` (urls absolute or same-origin; `null` if missing) |
| POST | `/students` | `multipart/form-data`: `name`, `photo` (JPEG ≤ 800×800), `audio` (webm/opus or mp4) | `{ id }` |
| GET | `/students/:id/impressions` | — | `[{ id, studentId, from, text, color, createdAt }]` |
| POST | `/students/:id/impressions` | JSON `{ from, text, color }` — `color` ∈ yellow/blue/pink/green, `text` ≤ 300 chars | the created impression |
| GET | `/photos` | — | `[{ id, url, thumbUrl, caption, from, createdAt }]`, newest first (`thumbUrl` may be `null` — the client falls back to `url`) |
| POST | `/photos` | `multipart/form-data`: `photo` (JPEG, longest side ≤ 1600), `thumb` (JPEG ≤ 480), `caption` (≤ 120 chars, may be empty), `from` | `{ id }` |

CORS: allow the Pages origin, `X-Class-Code`, `Content-Type`.

## Photos
The gallery is separate from the portraits on the wall: anyone can add several photos at once (file picker or the phone camera), with one caption and a name for the batch. The browser resizes each one before it is stored — a full-size JPEG (longest side 1600, quality .82) and a thumbnail for the grid (480, .7) — so a 4 MB phone photo lands at a few hundred KB and the grid stays quick.

Locally they go to the `photos` object store in IndexedDB (added in DB version 2; an album created before the gallery upgrades in place). The app asks for `navigator.storage.persist()` on the first save so the browser does not evict the album when space runs low — still, a browser is not a backup: set `API_BASE` if the photos matter.

## Worth doing server-side (kids' data)
- Parental consent before a child is added; keep the class code out of anything public.
- Rate-limit `POST` and cap upload size (~1 MB portrait, ~1 MB audio, ~2 MB gallery photo) — the client resizes before upload, but do not trust it.
- A teacher-only delete/hide endpoint — the client has no delete on purpose, so nobody can remove a classmate's card or a saved photo.
- Impressions are unmoderated by default; a `pending` flag + teacher approval is a small addition if you want it.
