const $ = s => document.querySelector(s);
const MAX_SEC = 20;
let students = [];

/* ---------- helpers ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }
function tilt(seed) { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ((h % 700) / 100 - 3.5).toFixed(1); }
function initials(name) { return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
function esc(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(sec) { return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
function revoke(urls) { for (const u of urls) if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

/* ---------- wall ---------- */
async function renderWall() {
  let rows;
  try { rows = await store.listStudents(); }
  catch (e) { $('#empty').hidden = false; $('#empty').textContent = 'Nu pot încărca albumul: ' + e.message; return; }
  revoke(students.flatMap(s => [s.photoUrl, s.audioUrl]));
  students = rows;
  const wall = $('#wall');
  wall.innerHTML = '';
  for (const s of students) {
    const card = document.createElement('button');
    card.className = 'card'; card.type = 'button';
    card.style.setProperty('--tilt', tilt(s.id) + 'deg');
    card.style.setProperty('--tape-tilt', (tilt(s.name) * 1.5) + 'deg');
    card.innerHTML = `<figure style="margin:0">
      ${s.photoUrl ? `<img src="${s.photoUrl}" alt="">` : `<div class="noimg">${esc(initials(s.name))}</div>`}
      <figcaption>${esc(s.name)}<small>${s.audioUrl ? 'are un mesaj vocal' : 'fără mesaj vocal'}</small></figcaption></figure>`;
    card.addEventListener('click', () => openView(s));
    wall.appendChild(card);
  }
  const add = document.createElement('button');
  add.className = 'card add'; add.type = 'button'; add.textContent = '+ Adaugă-te în album';
  add.addEventListener('click', openAdd);
  wall.appendChild(add);
  $('#empty').hidden = students.length > 0;
  $('#count').hidden = students.length === 0;
  $('#countN').textContent = students.length;
}

/* ---------- add self: photo ---------- */
let stream = null, photoBlob = null, audioBlob = null;
const video = $('#video'), preview = $('#photoPreview');

function stopCam() { stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; video.hidden = true; $('#btnSnap').hidden = true; }

$('#btnCam').addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1024 } }, audio: false });
    video.srcObject = stream; video.hidden = false; preview.hidden = true; $('#photoPh').hidden = true;
    $('#btnSnap').hidden = false; $('#btnCam').hidden = true; $('#btnRetake').hidden = true;
  } catch { toast('Nu pot porni camera. Alege o poză din telefon.'); }
});

$('#btnSnap').addEventListener('click', () => {
  const size = Math.min(video.videoWidth, video.videoHeight);
  const c = document.createElement('canvas'); c.width = c.height = 800;
  const ctx = c.getContext('2d');
  ctx.translate(800, 0); ctx.scale(-1, 1); // keep the mirrored view kids saw
  ctx.drawImage(video, (video.videoWidth - size) / 2, (video.videoHeight - size) / 2, size, size, 0, 0, 800, 800);
  c.toBlob(b => setPhoto(b), 'image/jpeg', 0.85);
  stopCam();
});

$('#fileIn').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  stopCam();
  try {
    const img = await createImageBitmap(f, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(f));
    const size = Math.min(img.width, img.height);
    const c = document.createElement('canvas'); c.width = c.height = 800;
    c.getContext('2d').drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 800, 800);
    img.close?.();
    c.toBlob(b => setPhoto(b), 'image/jpeg', 0.85);
  } catch { toast('Nu pot deschide poza asta. Încearcă alta.'); }
});

function setPhoto(blob) {
  if (!blob) { toast('Poza nu a ieșit. Mai încearcă o dată.'); clearPhoto(); return; }
  revoke([preview.src]);
  photoBlob = blob; preview.src = URL.createObjectURL(blob); preview.hidden = false; $('#photoPh').hidden = true;
  $('#btnRetake').hidden = false; $('#btnCam').hidden = true; $('#btnSnap').hidden = true;
}
function clearPhoto() {
  revoke([preview.src]);
  photoBlob = null; preview.removeAttribute('src'); preview.hidden = true; $('#photoPh').hidden = false;
  $('#btnRetake').hidden = true; $('#btnSnap').hidden = true; $('#btnCam').hidden = false;
}
$('#btnRetake').addEventListener('click', clearPhoto);

/* ---------- add self: voice ---------- */
let rec = null, chunks = [], recTimer = null, analyser = null, raf = null, audioCtx = null;
const wave = $('#wave'), wctx = wave.getContext('2d');

function drawWave() {
  const data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteTimeDomainData(data);
  wctx.clearRect(0, 0, wave.width, wave.height);
  wctx.strokeStyle = '#e4572e'; wctx.lineWidth = 3; wctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = i / data.length * wave.width, y = data[i] / 255 * wave.height;
    i ? wctx.lineTo(x, y) : wctx.moveTo(x, y);
  }
  wctx.stroke(); raf = requestAnimationFrame(drawWave);
}

$('#btnRec').addEventListener('click', async () => {
  if (rec && rec.state === 'recording') return stopRec();
  try {
    const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    rec = new MediaRecorder(ms, mime ? { mimeType: mime } : undefined); chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
      audioBlob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      $('#audioPreview').src = URL.createObjectURL(audioBlob); $('#audioPreview').hidden = false;
      ms.getTracks().forEach(t => t.stop()); cancelAnimationFrame(raf); audioCtx?.close();
      wctx.clearRect(0, 0, wave.width, wave.height);
    };
    audioCtx = new AudioContext(); analyser = audioCtx.createAnalyser(); analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(ms).connect(analyser); drawWave();
    rec.start();
    $('#btnRec').textContent = 'Oprește'; $('#btnRec').setAttribute('aria-pressed', 'true'); $('#audioPreview').hidden = true;
    let sec = 0; $('#timer').textContent = fmt(0);
    recTimer = setInterval(() => { sec++; $('#timer').textContent = fmt(sec); if (sec >= MAX_SEC) stopRec(); }, 1000);
  } catch { toast('Nu pot porni microfonul. Verifică permisiunile.'); }
});

function stopRec() {
  clearInterval(recTimer); rec?.stop();
  $('#btnRec').textContent = 'Înregistrează din nou'; $('#btnRec').setAttribute('aria-pressed', 'false');
}

/* ---------- add self: save ---------- */
function openAdd() {
  audioBlob = null;
  $('#formAdd').reset(); stopCam(); clearPhoto();
  $('#audioPreview').hidden = true; $('#timer').textContent = fmt(0); $('#btnRec').textContent = 'Înregistrează'; $('#addErr').hidden = true;
  $('#dlgAdd').showModal();
}
$('#dlgAdd').addEventListener('close', () => { stopCam(); if (rec?.state === 'recording') stopRec(); });

$('#formAdd').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#name').value.trim(); if (!name) return;
  if (!photoBlob && !audioBlob) { $('#addErr').textContent = 'Adaugă cel puțin o poză sau o înregistrare.'; $('#addErr').hidden = false; return; }
  $('#btnSave').disabled = true; $('#btnSave').textContent = 'Se salvează…';
  try {
    await store.createStudent({ name, photo: photoBlob, audio: audioBlob });
    $('#dlgAdd').close(); toast(`Bun venit în album, ${name}!`); await renderWall();
  } catch (err) { $('#addErr').textContent = 'Nu s-a putut salva: ' + err.message; $('#addErr').hidden = false; }
  finally { $('#btnSave').disabled = false; $('#btnSave').textContent = 'Salvează în album'; }
});

/* ---------- view student + impressions ---------- */
let current = null;
async function openView(s) {
  current = s;
  $('#viewName').textContent = s.name;
  $('#viewPhoto').innerHTML = s.photoUrl ? `<img src="${s.photoUrl}" alt="Poza lui/ei ${esc(s.name)}">` : `<div class="noimg">${esc(initials(s.name))}</div>`;
  const a = $('#viewAudio'); a.hidden = !s.audioUrl; $('#viewNoAudio').hidden = !!s.audioUrl;
  if (s.audioUrl) a.src = s.audioUrl;
  $('#formNote').reset(); $('#noteErr').hidden = true;
  $('#noteFrom').value = localStorage.getItem('myName') || '';
  await renderNotes();
  $('#dlgView').showModal(); $('#dlgView .sheet').scrollTop = 0;
}
$('#dlgView').addEventListener('close', () => $('#viewAudio').pause());

async function renderNotes() {
  const list = $('#notes'); list.innerHTML = '';
  let notes = [];
  try { notes = await store.listImpressions(current.id); } catch (e) { toast(e.message); }
  for (const n of notes) {
    const li = document.createElement('li'); li.className = 'note'; li.dataset.color = n.color || 'yellow';
    li.style.setProperty('--tilt', (tilt(n.id) / 2) + 'deg');
    li.innerHTML = `${esc(n.text)}<cite>${esc(n.from)}</cite>`;
    list.appendChild(li);
  }
  $('#notesEmpty').hidden = notes.length > 0;
}

$('#formNote').addEventListener('submit', async e => {
  e.preventDefault();
  const from = $('#noteFrom').value.trim(), text = $('#noteText').value.trim();
  const color = document.querySelector('input[name=color]:checked').value;
  if (!from || !text) return;
  localStorage.setItem('myName', from);
  try {
    await store.addImpression(current.id, { from, text, color });
    $('#noteText').value = ''; toast('Bilețel lipit!'); await renderNotes();
  } catch (err) { $('#noteErr').textContent = 'Nu s-a putut trimite: ' + err.message; $('#noteErr').hidden = false; }
});

/* ---------- gallery: save photos ---------- */
const MAX_SIDE = 1600, THUMB_SIDE = 480;
let photos = [], pending = [], lightIdx = 0;

// One decode, two JPEGs: a full-size one to keep and a small one for the grid.
async function shrink(bmp, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', quality));
}
async function prepare(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await createImageBitmap(file); }
  const photo = await shrink(bmp, MAX_SIDE, 0.82);
  const thumb = await shrink(bmp, THUMB_SIDE, 0.7);
  bmp.close?.();
  return { photo, thumb, url: URL.createObjectURL(thumb) };
}

async function renderGallery() {
  let rows;
  try { rows = await store.listPhotos(); }
  catch (e) { $('#galErr').textContent = 'Nu pot încărca pozele: ' + e.message; $('#galErr').hidden = false; return; }
  $('#galErr').hidden = true;
  revoke(photos.flatMap(p => [p.url, p.thumbUrl]));
  photos = rows;
  const grid = $('#gallery');
  grid.innerHTML = '';
  photos.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'shot'; b.type = 'button';
    b.style.setProperty('--tilt', (tilt(p.id) / 2.5) + 'deg');
    b.innerHTML = `<figure style="margin:0">
      <img src="${p.thumbUrl || p.url}" alt="${esc(p.caption || 'Amintire din album')}" loading="lazy">
      <figcaption>${esc(p.caption || 'Amintire')}${p.from ? `<small>adăugată de ${esc(p.from)}</small>` : ''}</figcaption></figure>`;
    b.addEventListener('click', () => openLight(i));
    grid.appendChild(b);
  });
  $('#galEmpty').hidden = photos.length > 0;
  $('#galCountWrap').hidden = photos.length === 0;
  $('#galCount').textContent = photos.length;
}

/* --- pick photos --- */
function renderTray() {
  const list = $('#tray'); list.innerHTML = '';
  pending.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<img src="${p.url}" alt=""><button type="button" class="drop" aria-label="Scoate poza">✕</button>`;
    li.querySelector('.drop').addEventListener('click', () => {
      revoke([p.url]); pending.splice(i, 1); renderTray();
    });
    list.appendChild(li);
  });
  $('#trayEmpty').hidden = pending.length > 0;
}

async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try { pending.push(await prepare(f)); }
    catch { toast(`Nu pot deschide poza ${f.name || ''}`); }
  }
  renderTray();
}
$('#galFileIn').addEventListener('change', async e => { await addFiles([...e.target.files]); e.target.value = ''; });
$('#galCamIn').addEventListener('change', async e => { await addFiles([...e.target.files]); e.target.value = ''; });

function clearPending() { revoke(pending.map(p => p.url)); pending = []; renderTray(); }

$('#btnAddPhotos').addEventListener('click', () => {
  clearPending();
  $('#formPhotos').reset();
  $('#photoFrom').value = localStorage.getItem('myName') || '';
  $('#photosErr').hidden = true;
  $('#dlgPhotos').showModal();
});
$('#dlgPhotos').addEventListener('close', clearPending);

$('#formPhotos').addEventListener('submit', async e => {
  e.preventDefault();
  const from = $('#photoFrom').value.trim(), caption = $('#photoCaption').value.trim();
  if (!from) return;
  if (!pending.length) { $('#photosErr').textContent = 'Alege cel puțin o poză.'; $('#photosErr').hidden = false; return; }
  localStorage.setItem('myName', from);
  // Ask the browser not to evict the album if storage runs low.
  navigator.storage?.persist?.().catch(() => {});
  const btn = $('#btnSavePhotos'); btn.disabled = true;
  const total = pending.length;
  try {
    // Saved photos leave the tray one by one, so a retry after an error
    // picks up where it stopped instead of saving the same photo twice.
    while (pending.length) {
      btn.textContent = total > 1 ? `Se salvează ${total - pending.length + 1} din ${total}…` : 'Se salvează…';
      const p = pending[0];
      await store.addPhoto({ photo: p.photo, thumb: p.thumb, caption, from });
      revoke([p.url]); pending.shift();
    }
    $('#dlgPhotos').close();
    toast(total > 1 ? `${total} poze salvate!` : 'Poza e salvată!');
  } catch (err) {
    $('#photosErr').textContent = 'Nu s-au putut salva toate pozele: ' + err.message;
    $('#photosErr').hidden = false;
    renderTray();
  } finally {
    btn.disabled = false; btn.textContent = 'Salvează pozele';
    await renderGallery();
  }
});

/* --- lightbox --- */
function showLight() {
  const p = photos[lightIdx]; if (!p) return;
  $('#lightImg').src = p.url;
  $('#lightImg').alt = p.caption || 'Amintire din album';
  $('#lightCap').textContent = p.caption || '';
  $('#lightMeta').textContent = [p.from && `adăugată de ${p.from}`, `${lightIdx + 1} / ${photos.length}`].filter(Boolean).join(' · ');
  const prev = $('#lightPrev'), next = $('#lightNext');
  prev.disabled = lightIdx === 0;
  next.disabled = lightIdx === photos.length - 1;
  // Reaching an end disables the button you just used; hand focus to the other
  // one so tab/keyboard navigation doesn't fall out of the dialog.
  if (document.activeElement === prev && prev.disabled) (next.disabled ? $('#dlgLight .close') : next).focus();
  if (document.activeElement === next && next.disabled) (prev.disabled ? $('#dlgLight .close') : prev).focus();
}
function openLight(i) { lightIdx = i; showLight(); $('#dlgLight').showModal(); }
function step(d) { const n = lightIdx + d; if (n >= 0 && n < photos.length) { lightIdx = n; showLight(); } }
$('#lightPrev').addEventListener('click', () => step(-1));
$('#lightNext').addEventListener('click', () => step(1));
document.addEventListener('keydown', e => {
  if (!$('#dlgLight').open) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
});
$('#dlgLight').addEventListener('close', () => { $('#lightImg').removeAttribute('src'); });

/* ---------- boot ---------- */
renderWall();
renderGallery();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
