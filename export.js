/* Download the album: a browsable offline copy (.zip) and a printable one (.pdf).
 *
 * Both are read-only on purpose. An album a child can take home should be a
 * keepsake, not a second editable copy that quietly drifts from the real one —
 * so the exported site has no forms and, deliberately, no JavaScript at all:
 * plain HTML and CSS that a browser opens straight off a memory stick, years
 * from now, with no server and no build step.
 *
 * The data comes from the store like any other read, so this works the same
 * whether the album lives in IndexedDB or behind API_BASE.
 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const say = m => (window.toast ? window.toast(m) : null);

  /* ---------- small helpers ---------- */

  const escape = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // NFD strips ă/â/î to their base letters; ș and ț decompose too, so a name
  // becomes a filename that survives every filesystem and zip tool.
  function slug(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
  }

  const pad = (i, w) => String(i).padStart(w || 2, '0');

  // Romanian counts in three forms: 1 coleg, 2 colegi, 20 de colegi — and the
  // "de" comes back every hundred (119 colegi, 120 de colegi). A class album
  // that says "1 amintiri" reads like a machine wrote it, which it did.
  function count(nr, one, few) {
    if (nr === 1) return `1 ${one}`;
    const r = nr % 100;
    return nr === 0 || (r >= 1 && r <= 19) ? `${nr} ${few}` : `${nr} de ${few}`;
  }

  const EXT = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
    'audio/aac': 'aac', 'audio/wav': 'wav', 'video/mp4': 'mp4', 'video/webm': 'webm',
  };
  const ext = (blob, fallback) => EXT[(blob.type || '').split(';')[0].trim()] || fallback;

  function isoDay(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function longDate(d) {
    try { return new Intl.DateTimeFormat('ro-RO', { dateStyle: 'long' }).format(d); }
    catch { return isoDay(d); }
  }
  function shortDate(ms) {
    if (!ms) return '';
    try { return new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium' }).format(new Date(ms)); }
    catch { return isoDay(new Date(ms)); }
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    // Safari needs the URL to outlive the click by a good margin.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* The album's own heading, so an exported copy is titled like the page it
   * came from even after somebody edits index.html. */
  function heading() {
    const h1 = document.querySelector('header h1');
    const lines = h1 ? h1.innerText.split('\n').map(s => s.trim()).filter(Boolean) : [];
    return {
      html: h1 ? h1.innerHTML : 'Album de absolvire',
      lines: lines.length ? lines : ['Album de absolvire'],
      intro: document.querySelector('header p')?.textContent?.trim() || '',
      title: document.title || 'Album de absolvire',
    };
  }

  /* ---------- gathering ---------- */

  // The store hands back URLs, not blobs — blob: ones locally, http ones from a
  // backend. Fetching covers both. A single missing file must not lose the
  // whole album, so every failure degrades to "not in this copy".
  async function grab(url) {
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const b = await res.blob();
      return b && b.size ? b : null;
    } catch { return null; }
  }

  function revoke(urls) {
    for (const u of urls) if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
  }

  async function snapshot(progress) {
    progress(0.02, 'Citesc albumul…');
    // Collected as we go, so a failure halfway still hands every URL back.
    const created = [];
    try {
      const rows = await store.listStudents();
      created.push(...rows.flatMap(s => [s.photoUrl, s.audioUrl, s.signatureUrl]));
      const shots = await store.listPhotos();
      created.push(...shots.flatMap(p => [p.url, p.thumbUrl]));

      const total = rows.length + shots.length || 1;
      let done = 0;
      const students = [];
      for (const s of rows) {
        let impressions = [];
        try { impressions = await store.listImpressions(s.id); } catch { impressions = []; }
        students.push({
          id: s.id, name: s.name, createdAt: s.createdAt, impressions,
          photo: await grab(s.photoUrl),
          audio: await grab(s.audioUrl),
          signature: await grab(s.signatureUrl),
        });
        progress(0.02 + 0.38 * (++done / total), `Adun colegii… ${done}/${rows.length}`);
      }

      const photos = [];
      for (const p of shots) {
        photos.push({
          id: p.id, caption: p.caption || '', from: p.from || '', createdAt: p.createdAt,
          photo: await grab(p.url),
          thumb: await grab(p.thumbUrl),
        });
        progress(0.02 + 0.38 * (++done / total), `Adun pozele… ${photos.length}/${shots.length}`);
      }

      return { students, photos, at: new Date(), head: heading() };
    } finally {
      revoke(created);
    }
  }

  /* ---------- the offline site ---------- */

  const CSS = `/* Albumul, ca pagină de hârtie. Nimic din afara acestui dosar. */
:root{
  --paper:#ffffff; --rule:#dbe6f2; --ink:#1c2541; --ink-soft:#5a6480;
  --yellow:#f7c948; --blue:#3e7cb1; --tape:rgba(247,201,72,.75);
  --display:'Patrick Hand','Bradley Hand','Segoe Print','Comic Sans MS',cursive;
  --body:'Nunito','Trebuchet MS',system-ui,-apple-system,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  font-family:var(--body); color:var(--ink); background:var(--paper);
  background-image:linear-gradient(var(--rule) 1px,transparent 1px);
  background-size:100% 32px; line-height:1.5; min-height:100vh;
}
a{color:var(--blue)}
img{max-width:100%}
header{padding:28px 20px 8px; max-width:960px; margin:0 auto}
header h1{font-family:var(--display); font-size:clamp(2.2rem,8vw,4rem); line-height:.95; margin:0}
header h1 mark{background:none; color:inherit; position:relative; z-index:1}
header h1 mark::before{
  content:""; position:absolute; left:-4px; right:-4px; bottom:6%; height:38%;
  background:var(--yellow); z-index:-1; transform:rotate(-1.2deg);
  border-radius:4px 40px 6px 30px/30px 6px 40px 4px;
}
header p{margin:10px 0 0; color:var(--ink-soft); max-width:52ch}
.badge{
  display:inline-block; margin-top:14px; padding:6px 12px; border-radius:999px;
  border:2px dashed var(--ink-soft); color:var(--ink-soft); font-weight:700; font-size:.9rem;
}
main{max-width:960px; margin:0 auto; padding:16px 20px 80px}
h2{font-family:var(--display); font-size:2.2rem; margin:56px 0 0; line-height:1}
h3{font-family:var(--display); font-size:1.6rem; margin:26px 0 8px}
.back{display:inline-block; margin:20px 0 0; font-weight:700}

/* zidul cu poze */
.wall{display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:26px 20px; padding:12px 0 0}
.card{
  position:relative; display:block; background:#fff; padding:10px 10px 14px; color:inherit; text-decoration:none;
  box-shadow:0 2px 3px rgba(28,37,65,.08),0 10px 24px -8px rgba(28,37,65,.25);
  transform:rotate(var(--tilt,0deg)); transition:transform .15s;
}
.card:hover,.card:focus{transform:rotate(0deg) scale(1.03); z-index:2}
.card::before{
  content:""; position:absolute; top:-10px; left:50%; width:64px; height:22px; margin-left:-32px;
  background:var(--tape); transform:rotate(var(--tape-tilt,-3deg));
}
.card img,.card .noimg{display:block; width:100%; aspect-ratio:1; object-fit:cover; background:#eef3f9}
.card .noimg{display:grid; place-items:center; font-family:var(--display); font-size:3rem; color:var(--blue)}
.card figcaption{font-family:var(--display); font-size:1.35rem; margin-top:8px; line-height:1.1}
.card small{display:block; font-family:var(--body); font-size:.8rem; color:var(--ink-soft); font-weight:700}
.card .sig{width:100%; height:28px; aspect-ratio:auto; object-fit:contain; object-position:left center; margin-top:4px; background:none; opacity:.9}

/* pagina unui coleg */
.profile{display:grid; grid-template-columns:160px 1fr; gap:18px; align-items:start; margin-top:8px}
.profile .portrait,.profile .noimg{width:160px; height:160px; object-fit:cover; display:block; background:#eef3f9; border:2px solid var(--ink); transform:rotate(-2deg)}
.profile .noimg{display:grid; place-items:center; font-family:var(--display); font-size:4rem; color:var(--blue)}
.profile h1{font-family:var(--display); font-size:2.6rem; margin:0 0 6px; line-height:1}
.profile audio{width:100%; max-width:420px; margin-top:10px}
.sigshow{margin:14px 0 0}
.sigshow img{display:block; width:auto; max-width:100%; max-height:90px; object-fit:contain}
.sigshow figcaption{font-size:.85rem; color:var(--ink-soft); font-weight:700}
@media(max-width:460px){.profile{grid-template-columns:1fr}}

.notes{list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:12px; max-width:640px}
.note{padding:12px 14px 10px; border-radius:2px; font-size:1.05rem; line-height:1.4;
  transform:rotate(var(--tilt,0deg)); box-shadow:0 4px 10px -4px rgba(28,37,65,.35); white-space:pre-wrap}
.note[data-color=yellow]{background:#fff2b3}.note[data-color=blue]{background:#d6e8f7}
.note[data-color=pink]{background:#fbdbec}.note[data-color=green]{background:#dcf1dd}
.note cite{display:block; font-style:normal; font-family:var(--display); font-size:1.15rem; margin-top:6px; text-align:right}
.note cite::before{content:"— "}
.hint{color:var(--ink-soft)}

/* amintiri */
.gallery{display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:22px 18px; padding:14px 0 0}
.shot{display:block; background:#fff; padding:8px 8px 10px; color:inherit; text-decoration:none;
  box-shadow:0 2px 3px rgba(28,37,65,.08),0 10px 24px -8px rgba(28,37,65,.25);
  transform:rotate(var(--tilt,0deg)); transition:transform .15s}
.shot:hover,.shot:focus{transform:rotate(0deg) scale(1.03); z-index:2}
.shot img,.shot .noimg{display:block; width:100%; aspect-ratio:4/3; object-fit:cover; background:#eef3f9}
.shot .noimg{display:grid; place-items:center; font-family:var(--display); font-size:2.4rem; color:var(--blue)}
.shot figcaption{font-family:var(--display); font-size:1.1rem; margin-top:6px; line-height:1.15}
.shot small{display:block; font-family:var(--body); font-size:.78rem; color:var(--ink-soft); font-weight:700}

.big{margin:0 0 56px; padding:14px 14px 16px; background:#fff; box-shadow:0 2px 3px rgba(28,37,65,.08),0 10px 24px -8px rgba(28,37,65,.25); scroll-margin-top:16px}
.big img{display:block; width:100%; height:auto; background:#eef3f9}
.big figcaption{font-family:var(--display); font-size:1.5rem; margin-top:10px; line-height:1.15}
.big small{display:block; font-family:var(--body); font-size:.85rem; color:var(--ink-soft); font-weight:700}
.big nav{margin-top:10px; display:flex; gap:16px; font-weight:700; font-size:.95rem}
footer{max-width:960px; margin:0 auto; padding:0 20px 60px; color:var(--ink-soft); font-size:.9rem}

@media print{
  body{background:#fff}
  .card,.shot,.big,.note{box-shadow:none; transform:none}
  .card::before{display:none}
  nav,.back{display:none}
  .big{break-inside:avoid}
}
`;

  // The same hash the wall uses, so a polaroid keeps its tilt in the copy.
  function tilt(seed) {
    let h = 0;
    for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return ((h % 700) / 100 - 3.5).toFixed(1);
  }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }

  function page(title, body, up) {
    const root = up ? '../' : '';
    return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<link rel="stylesheet" href="${root}stil.css">
</head>
<body>
${body}
</body>
</html>
`;
  }

  async function buildZip(snap, progress) {
    const zip = new Zip();
    const { students, photos, head, at } = snap;
    const stamp = longDate(at);
    let missing = 0;

    // Filenames are decided first so every page can link to them.
    students.forEach((s, i) => {
      const base = `${pad(i + 1)}-${slug(s.name)}`;
      s.file = `elevi/${base}.html`;
      s.media = {
        photo: s.photo ? `media/elevi/${base}-poza.${ext(s.photo, 'jpg')}` : null,
        signature: s.signature ? `media/elevi/${base}-semnatura.${ext(s.signature, 'png')}` : null,
        audio: s.audio ? `media/elevi/${base}-voce.${ext(s.audio, 'webm')}` : null,
      };
    });
    photos.forEach((p, i) => {
      p.anchor = `poza-${pad(i + 1, 3)}`;
      p.media = p.photo ? `media/amintiri/${pad(i + 1, 3)}.${ext(p.photo, 'jpg')}` : null;
      p.thumbMedia = p.thumb ? `media/amintiri/${pad(i + 1, 3)}-mic.${ext(p.thumb, 'jpg')}` : p.media;
    });

    /* --- index.html --- */
    const wall = students.map(s => {
      const img = s.media.photo
        ? `<img src="${s.media.photo}" alt="Poza lui/ei ${escape(s.name)}" loading="lazy">`
        : `<div class="noimg">${escape(initials(s.name))}</div>`;
      const sig = s.media.signature ? `<img class="sig" src="${s.media.signature}" alt="" loading="lazy">` : '';
      return `      <a class="card" href="${s.file}" style="--tilt:${tilt(s.id)}deg;--tape-tilt:${(tilt(s.name) * 1.5).toFixed(1)}deg">
        <figure style="margin:0">${img}
          <figcaption>${escape(s.name)}<small>${s.media.audio ? 'are un mesaj vocal' : 'fără mesaj vocal'}</small>${sig}</figcaption>
        </figure>
      </a>`;
    }).join('\n');

    const grid = photos.map(p => `      <a class="shot" href="amintiri.html#${p.anchor}" style="--tilt:${(tilt(p.id) / 2.5).toFixed(1)}deg">
        <figure style="margin:0">${p.thumbMedia
        ? `<img src="${p.thumbMedia}" alt="${escape(p.caption || 'Amintire din album')}" loading="lazy">`
        : '<div class="noimg">?</div>'}
          <figcaption>${escape(p.caption || 'Amintire')}${p.from ? `<small>adăugată de ${escape(p.from)}</small>` : ''}</figcaption>
        </figure>
      </a>`).join('\n');

    await zip.add('index.html', page(head.title, `<header>
  <h1>${head.html}</h1>
  ${head.intro ? `<p>${escape(head.intro)}</p>` : ''}
  <p class="badge">Copie offline · ${count(students.length, 'coleg', 'colegi')} · ${count(photos.length, 'poză', 'poze')} · ${escape(stamp)}</p>
</header>

<main>
  <div class="wall">
${wall || '      <p class="hint">Albumul era gol când s-a făcut copia.</p>'}
  </div>

  <section>
    <h2>Amintiri din clasa a IV-a</h2>
    <div class="gallery">
${grid || '      <p class="hint">Nicio poză în copie.</p>'}
    </div>
  </section>
</main>

<footer>
  <p>Copie de citit a albumului, salvată la ${escape(stamp)}. Nu se poate scrie în ea:
  ca să adaugi ceva, deschide albumul de unde ai descărcat-o.</p>
</footer>`, false), true);

    /* --- o pagină pentru fiecare coleg --- */
    for (const s of students) {
      const portrait = s.media.photo
        ? `<img class="portrait" src="../${s.media.photo}" alt="Poza lui/ei ${escape(s.name)}">`
        : `<div class="noimg">${escape(initials(s.name))}</div>`;
      const audio = s.media.audio
        ? `<audio controls preload="none" src="../${s.media.audio}"></audio>`
        : '<p class="hint">Nu are o înregistrare în album.</p>';
      const sig = s.media.signature
        ? `<figure class="sigshow"><img src="../${s.media.signature}" alt="Semnătura lui/ei ${escape(s.name)}"><figcaption>semnătura lui/ei</figcaption></figure>`
        : '';
      const notes = s.impressions.length
        ? `<ul class="notes">\n${s.impressions.map(nte => `    <li class="note" data-color="${escape(nte.color || 'yellow')}" style="--tilt:${(tilt(nte.id) / 2).toFixed(1)}deg">${escape(nte.text)}<cite>${escape(nte.from)}</cite></li>`).join('\n')}\n  </ul>`
        : '<p class="hint">Nimeni n-a scris nimic până la copia asta.</p>';

      await zip.add(s.file, page(`${s.name} — ${head.title}`, `<main>
  <p><a class="back" href="../index.html">← Înapoi la album</a></p>
  <article class="profile">
    ${portrait}
    <div>
      <h1>${escape(s.name)}</h1>
      ${audio}
      ${sig}
    </div>
  </article>

  <h3>Impresii de la colegi</h3>
  ${notes}

  <p><a class="back" href="../index.html">← Înapoi la album</a></p>
</main>`, true), true);
    }

    /* --- amintiri.html: pozele mari, una sub alta, cu ancore --- */
    const big = photos.map((p, i) => {
      const prev = photos[i - 1], next = photos[i + 1];
      const nav = [
        prev ? `<a href="#${prev.anchor}">‹ înapoi</a>` : '',
        next ? `<a href="#${next.anchor}">înainte ›</a>` : '',
        '<a href="index.html">toate pozele</a>',
      ].filter(Boolean).join('\n      ');
      const meta = [p.from && `adăugată de ${p.from}`, shortDate(p.createdAt), `${i + 1} / ${photos.length}`]
        .filter(Boolean).map(escape).join(' · ');
      return `  <figure class="big" id="${p.anchor}">
    ${p.media ? `<img src="${p.media}" alt="${escape(p.caption || 'Amintire din album')}" loading="lazy">` : '<p class="hint">Poza lipsește din copie.</p>'}
    <figcaption>${escape(p.caption || 'Amintire')}<small>${meta}</small></figcaption>
    <nav>
      ${nav}
    </nav>
  </figure>`;
    }).join('\n');

    await zip.add('amintiri.html', page(`Amintiri — ${head.title}`, `<header>
  <h1>Amintiri</h1>
  <p class="badge">${count(photos.length, 'poză', 'poze')} · ${escape(stamp)}</p>
</header>
<main>
  <p><a class="back" href="index.html">← Înapoi la album</a></p>
${big || '  <p class="hint">Nicio poză în copie.</p>'}
  <p><a class="back" href="index.html">← Înapoi la album</a></p>
</main>`, false), true);

    await zip.add('stil.css', CSS, true);

    /* --- fișierele --- */
    const files = [];
    for (const s of students) {
      if (s.photo) files.push([s.media.photo, s.photo]);
      if (s.signature) files.push([s.media.signature, s.signature]);
      if (s.audio) files.push([s.media.audio, s.audio]);
      if (!s.photo && !s.signature && !s.audio) missing++;
    }
    for (const p of photos) {
      if (p.photo) files.push([p.media, p.photo]); else missing++;
      if (p.thumb && p.thumbMedia !== p.media) files.push([p.thumbMedia, p.thumb]);
    }
    let done = 0;
    for (const [name, blob] of files) {
      await zip.add(name, blob, false); // already-compressed bytes; deflate would only cost time
      progress(0.45 + 0.5 * (++done / (files.length || 1)), `Împachetez… ${done}/${files.length}`);
    }

    /* --- datele brute, pentru orice ar veni după --- */
    await zip.add('date.json', JSON.stringify({
      album: head.title,
      exportat: at.toISOString(),
      colegi: students.map(s => ({
        nume: s.name, adaugat: s.createdAt ? new Date(s.createdAt).toISOString() : null,
        pagina: s.file, poza: s.media.photo, semnatura: s.media.signature, voce: s.media.audio,
        impresii: s.impressions.map(i => ({ de_la: i.from, text: i.text, culoare: i.color, data: i.createdAt ? new Date(i.createdAt).toISOString() : null })),
      })),
      amintiri: photos.map(p => ({
        titlu: p.caption, de_la: p.from, poza: p.media, miniatura: p.thumbMedia,
        data: p.createdAt ? new Date(p.createdAt).toISOString() : null,
      })),
    }, null, 2), true);

    await zip.add('CITESTE-MA.txt', [
      head.title,
      '='.repeat(head.title.length),
      '',
      `Copie de citit a albumului, salvată la ${stamp}.`,
      '',
      'Cum o deschizi:',
      '  1. Dezarhivează tot dosarul (nu deschide paginile din arhivă).',
      '  2. Deschide index.html cu orice browser — Chrome, Safari, Firefox, Edge.',
      '  3. Nu ai nevoie de internet. Merge și de pe un stick.',
      '',
      'Ce e înăuntru:',
      '  index.html      zidul cu colegi si pozele din album',
      '  amintiri.html   toate pozele, mari, una sub alta',
      '  elevi/          cate o pagina pentru fiecare coleg',
      '  media/          pozele, semnaturile si mesajele vocale, ca fisiere',
      '  date.json       aceleasi date, pentru cine vrea sa le prelucreze',
      '',
      'Copia e doar de citit: nu poti adauga colegi, poze sau impresii in ea.',
      'Pentru asta deschide albumul de unde ai descarcat-o.',
      '',
      'Mesajele vocale sunt in media/ si se asculta direct din pagina fiecarui coleg.',
      missing ? `\nAtentie: ${count(missing, 'fisier n-a', 'fisiere n-au')} putut fi citit si lipseste din copie.` : '',
    ].filter(x => x !== '').join('\n') + '\n', true);

    progress(0.97, 'Închid arhiva…');
    return { blob: zip.blob(), missing };
  }

  /* ---------- the PDF ---------- */

  // Canvas is the one decoder every browser agrees on: whatever the store held
  // (JPEG, PNG, WebP, transparent or not) comes out as baseline RGB JPEG, which
  // is exactly what /DCTDecode wants. Transparency is flattened onto paper white.
  async function toJpeg(blob, maxPx, quality) {
    if (!blob) return null;
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch { return null; }
    const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const out = await new Promise(r => c.toBlob(r, 'image/jpeg', quality || 0.82));
    if (!out) return null;
    return { bytes: new Uint8Array(await out.arrayBuffer()), w: c.width, h: c.height };
  }

  const M = 48;                       // margin
  const NOTE_COLORS = { yellow: '#fff2b3', blue: '#d6e8f7', pink: '#fbdbec', green: '#dcf1dd' };

  async function buildPdf(snap, progress) {
    const { students, photos, head, at } = snap;
    const doc = new Pdf({ title: head.title, author: head.lines.join(' · '), size: Pdf.A4 });
    const CW = doc.W - 2 * M;
    const BOTTOM = doc.H - M;

    // Decode once, use twice: the same portrait appears on the wall and again
    // on the child's own page.
    const portraits = new Map(), shots = new Map();
    let step = 0;
    const totalImgs = students.length * 2 + photos.length || 1;
    const tick = label => progress(0.45 + 0.35 * (++step / totalImgs), label);

    for (const s of students) {
      const p = await toJpeg(s.photo, 460, 0.82);
      if (p) portraits.set(s.id, doc.image(p.bytes, p.w, p.h));
      tick('Pregătesc pozele…');
      const g = await toJpeg(s.signature, 800, 0.9);
      if (g) portraits.set(s.id + ':sig', doc.image(g.bytes, g.w, g.h));
      tick('Pregătesc semnăturile…');
    }
    for (const p of photos) {
      const j = await toJpeg(p.photo || p.thumb, 720, 0.8);
      if (j) shots.set(p.id, doc.image(j.bytes, j.w, j.h));
      tick('Pregătesc amintirile…');
    }

    progress(0.82, 'Așez paginile…');

    /* --- coperta --- */
    doc.addPage();
    doc.bookmark('Copertă', 0);
    doc.rect(0, 0, doc.W, 26, { fill: '#f7c948' });
    let y = 190;
    head.lines.forEach((line, i) => {
      if (i === head.lines.length - 1 && head.lines.length > 1) {
        // Echoes the marker stripe behind "Promoția 2026" on the wall.
        const w = Pdf.textWidth(line, 'F2', 34);
        doc.rect(doc.W / 2 - w / 2 - 8, y + 13, w + 16, 17, { fill: '#f7c948' });
      }
      doc.text(line, doc.W / 2, y, { size: 34, font: 'F2', align: 'center' });
      y += 46;
    });
    y += 14;
    if (head.intro) y = doc.paragraph(head.intro, M + 60, y, CW - 120, { size: 12, color: '#5a6480', align: 'center' }) + 24;
    doc.line(doc.W / 2 - 60, y, doc.W / 2 + 60, y, { color: '#dbe6f2', width: 2 });
    y += 26;
    doc.text(`${count(students.length, 'coleg', 'colegi')} · ${count(photos.length, 'amintire', 'amintiri')}`,
      doc.W / 2, y, { size: 14, font: 'F2', align: 'center' });
    y += 24;
    doc.text(`tipărit la ${longDate(at)}`, doc.W / 2, y, { size: 11, color: '#5a6480', align: 'center' });
    doc.paragraph(
      'Copie de citit a albumului. Mesajele vocale nu încap într-un PDF — sunt în arhiva .zip, ' +
      'lângă restul albumului.',
      M + 80, doc.H - 150, CW - 160, { size: 9.5, color: '#5a6480', align: 'center' });

    /* --- zidul cu colegi --- */
    const COLS = 3, CARD = 134, IMG = CARD - 16, CARD_H = 164, ROW = 172, TOP = 104, PITCH = CW / COLS;
    let first = true;
    for (let i = 0; i < students.length; i++) {
      const slot = i % (COLS * 4);
      if (slot === 0) {
        doc.addPage();
        doc.text(head.lines[0], M, M, { size: 18, font: 'F2' });
        doc.line(M, M + 26, doc.W - M, M + 26, { color: '#dbe6f2', width: 1.5 });
        if (first) { doc.bookmark(head.lines[0]); first = false; }
      }
      const s = students[i];
      const col = slot % COLS, row = Math.floor(slot / COLS);
      const x = M + col * PITCH + (PITCH - CARD) / 2;
      const top = TOP + row * ROW;
      const img = portraits.get(s.id);
      doc.tilted(x, top, CARD, CARD_H, +tilt(s.id) / 1.4, () => {
        doc.rect(x, top, CARD, CARD_H, { fill: '#ffffff', stroke: '#e6ecf4', width: 0.8 });
        if (img) doc.drawImage(img, x + 8, top + 8, IMG, IMG, { cover: true });
        else {
          doc.rect(x + 8, top + 8, IMG, IMG, { fill: '#eef3f9' });
          doc.text(initials(s.name), x + CARD / 2, top + 8 + IMG / 2 - 12, { size: 26, font: 'F2', color: '#3e7cb1', align: 'center' });
        }
        // Two lines: a double-barrelled name should not lose half of itself.
        const after = doc.paragraph(s.name, x + 8, top + IMG + 14, IMG, { size: 9.5, font: 'F2', lead: 11, maxLines: 2 });
        doc.text(s.audio ? 'are un mesaj vocal' : 'fără mesaj vocal', x + 8, after + 1, { size: 7, color: '#5a6480' });
      });
    }

    /* --- pagina fiecărui coleg --- */
    for (const s of students) {
      doc.addPage();
      doc.bookmark(s.name);
      doc.text(s.name, M, M, { size: 24, font: 'F2' });
      doc.line(M, M + 34, doc.W - M, M + 34, { color: '#dbe6f2', width: 1.5 });

      const img = portraits.get(s.id);
      const top = 100, side = 150;
      if (img) {
        doc.rect(M - 4, top - 4, side + 8, side + 8, { fill: '#ffffff', stroke: '#e6ecf4', width: 0.8 });
        doc.drawImage(img, M, top, side, side, { cover: true });
      } else {
        doc.rect(M, top, side, side, { fill: '#eef3f9' });
        doc.text(initials(s.name), M + side / 2, top + side / 2 - 16, { size: 40, font: 'F2', color: '#3e7cb1', align: 'center' });
      }

      const rx = M + side + 26, rw = doc.W - M - rx;
      let ry = top + 4;
      doc.text(s.audio ? 'Are un mesaj vocal în album.' : 'Nu are un mesaj vocal.', rx, ry, { size: 11, font: 'F2' });
      ry += 16;
      if (s.audio) {
        ry = doc.paragraph('Se ascultă din copia .zip a albumului — pagina lui/ei, în dosarul elevi/.',
          rx, ry, rw, { size: 9, color: '#5a6480' }) + 10;
      }
      const sig = portraits.get(s.id + ':sig');
      if (sig) {
        const sw = Math.min(rw, 220), sh = Math.min(72, sw * sig.h / sig.w);
        doc.drawImage(sig, rx, ry + 6, sw, sh);
        doc.text('semnătura lui/ei', rx, ry + 12 + sh, { size: 8, color: '#5a6480' });
      }

      let ny = Math.max(top + side, ry + 96) + 26;
      doc.text('Impresii de la colegi', M, ny, { size: 15, font: 'F2' });
      ny += 26;
      if (!s.impressions.length) {
        doc.text('Nimeni n-a scris nimic până la tipărire.', M, ny, { size: 10.5, color: '#5a6480' });
      }
      for (const note of s.impressions) {
        const inner = CW - 28;
        const lines = Pdf.wrap(note.text || '', 'F1', 11, inner);
        const h = 14 + lines.length * 15 + 20;
        if (ny + h > BOTTOM) {                       // biletele continuă pe pagina următoare
          doc.addPage();
          doc.text(`${s.name} — impresii (continuare)`, M, M, { size: 13, font: 'F2', color: '#5a6480' });
          ny = M + 34;
        }
        doc.rect(M, ny, CW, h, { fill: NOTE_COLORS[note.color] || NOTE_COLORS.yellow });
        let ty = ny + 11;
        for (const line of lines) { doc.text(line, M + 14, ty, { size: 11 }); ty += 15; }
        doc.text('— ' + (note.from || ''), doc.W - M - 14, ty + 1, { size: 10.5, align: 'right' });
        ny += h + 12;
      }
    }

    /* --- amintirile --- */
    if (photos.length) {
      // Room under the photo for a caption that runs to two lines and the
      // "added by" under it — the tallest a card gets.
      const GC = 2, GPITCH = CW / GC, GCARD = 232, GIMG = GCARD - 16;
      const GCARD_H = 8 + GIMG * 3 / 4 + 52, GROW = GCARD_H + 8, GTOP = 104;
      let firstGal = true;
      for (let i = 0; i < photos.length; i++) {
        const slot = i % (GC * 3);
        if (slot === 0) {
          doc.addPage();
          doc.text('Amintiri din clasa a IV-a', M, M, { size: 18, font: 'F2' });
          doc.line(M, M + 26, doc.W - M, M + 26, { color: '#dbe6f2', width: 1.5 });
          if (firstGal) { doc.bookmark('Amintiri'); firstGal = false; }
        }
        const p = photos[i];
        const col = slot % GC, row = Math.floor(slot / GC);
        const x = M + col * GPITCH + (GPITCH - GCARD) / 2;
        const top = GTOP + row * GROW;
        const img = shots.get(p.id);
        doc.tilted(x, top, GCARD, GCARD_H, +tilt(p.id) / 3, () => {
          doc.rect(x, top, GCARD, GCARD_H, { fill: '#ffffff', stroke: '#e6ecf4', width: 0.8 });
          if (img) doc.drawImage(img, x + 8, top + 8, GIMG, GIMG * 3 / 4, { cover: true });
          else doc.rect(x + 8, top + 8, GIMG, GIMG * 3 / 4, { fill: '#eef3f9' });
          const cy = top + 8 + GIMG * 3 / 4 + 12;
          const after = doc.paragraph(p.caption || 'Amintire', x + 8, cy, GIMG, { size: 10.5, font: 'F2', lead: 13, maxLines: 2 });
          if (p.from) doc.text('adăugată de ' + p.from, x + 8, after + 1, { size: 7.5, color: '#5a6480' });
        });
      }
    }

    progress(0.97, 'Scriu PDF-ul…');
    return doc.build();
  }

  /* ---------- UI ---------- */

  const dlg = $('#dlgExport');
  const bar = $('#exportBar'), barFill = $('#exportFill'), label = $('#exportLabel'), err = $('#exportErr');
  const btnZip = $('#btnExportZip'), btnPdf = $('#btnExportPdf');
  const btnClose = $('#dlgExport .close');
  let busy = false;

  function setBusy(on, text) {
    busy = on;
    btnZip.disabled = on; btnPdf.disabled = on;
    // Esc is already refused below; the ✕ has to agree with it.
    btnClose.disabled = on;
    bar.hidden = !on;
    if (text) label.textContent = text;
    if (!on) barFill.style.width = '0%';
  }
  function progress(fraction, text) {
    barFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
    if (text) label.textContent = text;
  }

  function baseName(head, at) {
    return `${slug(head.title) || 'album'}-${isoDay(at)}`;
  }

  async function run(kind) {
    if (busy) return;
    err.hidden = true;
    setBusy(true, 'Pregătesc…');
    try {
      const snap = await snapshot(progress);
      if (!snap.students.length && !snap.photos.length) throw new Error('Albumul e gol — nu e nimic de descărcat încă.');
      if (kind === 'zip') {
        progress(0.45, 'Construiesc paginile…');
        const { blob, missing } = await buildZip(snap, progress);
        download(blob, baseName(snap.head, snap.at) + '.zip');
        say(missing ? `Album descărcat. ${count(missing, 'fișier lipsește', 'fișiere lipsesc')} din copie.` : 'Album descărcat.');
      } else {
        const blob = await buildPdf(snap, progress);
        download(blob, baseName(snap.head, snap.at) + '.pdf');
        say('PDF descărcat.');
      }
      progress(1, 'Gata.');
      dlg.close();
    } catch (e) {
      err.textContent = 'Nu s-a putut face descărcarea: ' + (e && e.message ? e.message : e);
      err.hidden = false;
    } finally {
      setBusy(false);
    }
  }

  $('#btnExport').addEventListener('click', () => {
    err.hidden = true; setBusy(false); label.textContent = '';
    dlg.showModal();
  });
  btnZip.addEventListener('click', () => run('zip'));
  btnPdf.addEventListener('click', () => run('pdf'));
  // A download half-written is worse than one the reader waits for.
  dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
})();
