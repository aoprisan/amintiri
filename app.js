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
  revoke(students.flatMap(s => [s.photoUrl, s.audioUrl, s.signatureUrl]));
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
      <figcaption>${esc(s.name)}<small>${s.audioUrl ? 'are un mesaj vocal' : 'fără mesaj vocal'}</small>
        ${s.signatureUrl ? `<img class="sig" src="${s.signatureUrl}" alt="" loading="lazy">` : ''}</figcaption></figure>`;
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

/* ---------- add self: signature (finger or mouse) ---------- */
const sig = $('#sig'), sctx = sig.getContext('2d');
let sigDrawing = false, sigLast = null, sigBox = null, sigScale = 1;

// The pad lives in a closed dialog at load time, so it has no size until the
// dialog opens; size it there and again only while it is still blank.
function sizeSignature() {
  const r = sig.getBoundingClientRect();
  if (!r.width || !r.height) return;
  sigScale = Math.min(window.devicePixelRatio || 1, 3);
  sig.width = Math.round(r.width * sigScale);
  sig.height = Math.round(r.height * sigScale);
  sctx.setTransform(sigScale, 0, 0, sigScale, 0, 0);
  sctx.strokeStyle = sctx.fillStyle = '#1c2541';
  sctx.lineWidth = 3; sctx.lineCap = sctx.lineJoin = 'round';
}
function clearSignature() {
  sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, sig.width, sig.height);
  sctx.setTransform(sigScale, 0, 0, sigScale, 0, 0);
  sigBox = null; sigDrawing = false; sigLast = null;
  $('#sigWrap').classList.remove('signed'); $('#btnSigClear').disabled = true;
}
function sigPoint(e) {
  const r = sig.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function sigMark(p) {
  sigBox = sigBox
    ? { x0: Math.min(sigBox.x0, p.x), y0: Math.min(sigBox.y0, p.y), x1: Math.max(sigBox.x1, p.x), y1: Math.max(sigBox.y1, p.y) }
    : { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
}

sig.addEventListener('pointerdown', e => {
  e.preventDefault();
  sig.setPointerCapture(e.pointerId);
  sigDrawing = true; sigLast = sigPoint(e);
  // A tap without a drag should still leave a dot.
  sctx.beginPath(); sctx.arc(sigLast.x, sigLast.y, sctx.lineWidth / 2, 0, Math.PI * 2); sctx.fill();
  sigMark(sigLast);
  $('#sigWrap').classList.add('signed'); $('#btnSigClear').disabled = false;
});
sig.addEventListener('pointermove', e => {
  if (!sigDrawing) return;
  e.preventDefault();
  // Coalesced events keep a fast finger from turning curves into corners.
  for (const ev of (e.getCoalescedEvents?.() || [e])) {
    const p = sigPoint(ev);
    sctx.beginPath(); sctx.moveTo(sigLast.x, sigLast.y); sctx.lineTo(p.x, p.y); sctx.stroke();
    sigLast = p; sigMark(p);
  }
});
for (const ev of ['pointerup', 'pointercancel']) sig.addEventListener(ev, () => { sigDrawing = false; });
// Rotating the phone changes the pad's width; re-fit it, but never over a signature.
window.addEventListener('resize', () => { if ($('#dlgAdd').open && !sigBox) sizeSignature(); });
$('#btnSigClear').addEventListener('click', clearSignature);

// Crop to the ink so a signature scribbled in one corner isn't mostly blank.
function signatureBlob() {
  if (!sigBox) return Promise.resolve(null);
  const pad = 10;
  const x = Math.max(0, (sigBox.x0 - pad) * sigScale), y = Math.max(0, (sigBox.y0 - pad) * sigScale);
  const w = Math.min(sig.width - x, (sigBox.x1 - sigBox.x0 + pad * 2) * sigScale);
  const h = Math.min(sig.height - y, (sigBox.y1 - sigBox.y0 + pad * 2) * sigScale);
  const k = Math.min(1, 800 / w);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(sig, x, y, w, h, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/png')); // transparent, so it sits on the paper
}

/* ---------- add self: save ---------- */
function openAdd() {
  audioBlob = null;
  $('#formAdd').reset(); stopCam(); clearPhoto();
  $('#audioPreview').hidden = true; $('#timer').textContent = fmt(0); $('#btnRec').textContent = 'Înregistrează'; $('#addErr').hidden = true;
  $('#dlgAdd').showModal();
  sizeSignature(); clearSignature();
}
$('#dlgAdd').addEventListener('close', () => { stopCam(); if (rec?.state === 'recording') stopRec(); });

$('#formAdd').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#name').value.trim(); if (!name) return;
  const signature = await signatureBlob();
  if (!photoBlob && !audioBlob && !signature) { $('#addErr').textContent = 'Adaugă cel puțin o poză, o înregistrare sau o semnătură.'; $('#addErr').hidden = false; return; }
  $('#btnSave').disabled = true; $('#btnSave').textContent = 'Se salvează…';
  try {
    await store.createStudent({ name, photo: photoBlob, audio: audioBlob, signature });
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
  $('#viewSigWrap').hidden = !s.signatureUrl;
  if (s.signatureUrl) { $('#viewSig').src = s.signatureUrl; $('#viewSig').alt = `Semnătura lui/ei ${s.name}`; }
  else $('#viewSig').removeAttribute('src');
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

/* ---------- the drawing wall ---------- */
// One wall for the whole class. Every visit adds a transparent layer on top of
// what is already there, so nobody can paint over a classmate by accident and
// two phones drawing at once simply both land. The wall has a fixed size in
// its own pixels; on screen it is scaled to fit, and strokes are recorded in
// wall pixels, so a drawing made on a small phone is as crisp as any other.
const WALL_W = 1200, WALL_H = 1500;
let drawings = [], muralGen = 0;
const mural = $('#mural'), muralCtx = mural.getContext('2d');

// 1 desen, 3 desene, 20 de desene — and the "de" comes back every hundred.
function countLabel(n, one, few) {
  if (n === 1) return one;
  const r = n % 100;
  return n === 0 || (r >= 1 && r <= 19) ? few : 'de ' + few;
}
function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('desen ilizibil')); i.src = url; });
}

async function renderMural() {
  const gen = ++muralGen;
  let rows;
  try { rows = await store.listDrawings(); }
  catch (e) { $('#muralErr').textContent = 'Nu pot încărca peretele: ' + e.message; $('#muralErr').hidden = false; return; }
  if (gen !== muralGen) return;
  $('#muralErr').hidden = true;
  revoke(drawings.map(d => d.url));
  drawings = rows;
  muralCtx.clearRect(0, 0, WALL_W, WALL_H);
  for (const d of drawings) {
    let img = null;
    try { img = await loadImage(d.url); } catch { /* one lost layer must not empty the wall */ }
    if (gen !== muralGen) return;
    if (img) muralCtx.drawImage(img, 0, 0, WALL_W, WALL_H);
  }
  const names = [...new Set(drawings.map(d => d.from.trim()).filter(Boolean))];
  $('#muralWho').textContent = names.length ? 'Au desenat: ' + names.join(', ') : '';
  $('#muralEmpty').hidden = drawings.length > 0;
  $('#muralCountWrap').hidden = drawings.length === 0;
  $('#muralCount').textContent = drawings.length;
  $('#muralCountLabel').textContent = countLabel(drawings.length, 'desen', 'desene');
  mural.setAttribute('aria-label', drawings.length
    ? `Peretele cu desene: ${drawings.length} ${countLabel(drawings.length, 'desen', 'desene')}, de la ${names.join(', ')}`
    : 'Peretele cu desene, încă gol');
}

/* --- the easel --- */
const inkCv = $('#drawInk'), inkCtx = inkCv.getContext('2d');
const baseCv = $('#drawBase'), baseCtx = baseCv.getContext('2d');
// Every stroke is kept, not just drawn, so "înapoi" can replay all but the last.
let strokes = [], stroke = null, strokeId = null, erasing = false;

function inkColor() {
  const v = document.querySelector('input[name=ink]:checked').value;
  return v === 'custom' ? $('#inkPick').value : v;
}
function inkWidth() { return +document.querySelector('input[name=size]:checked').value; }

// Fit the wall inside whatever the board has, keeping its shape: portrait like
// a phone, so the drawing area is not a letterbox.
function fitBoard() {
  const b = $('#board').getBoundingClientRect();
  const k = Math.min((b.width - 12) / WALL_W, (b.height - 12) / WALL_H);
  if (!(k > 0)) return;
  $('#paper').style.width = Math.floor(WALL_W * k) + 'px';
  $('#paper').style.height = Math.floor(WALL_H * k) + 'px';
}
function inkPoint(e) {
  const r = inkCv.getBoundingClientRect();
  return [(e.clientX - r.left) * WALL_W / r.width, (e.clientY - r.top) * WALL_H / r.height];
}
function setPen(s) {
  // The eraser only takes ink off this child's own layer; the wall underneath
  // shows through, untouched.
  inkCtx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
  inkCtx.strokeStyle = inkCtx.fillStyle = s.color;
  inkCtx.lineWidth = s.width; inkCtx.lineCap = inkCtx.lineJoin = 'round';
}
function dot(p, w) { inkCtx.beginPath(); inkCtx.arc(p[0], p[1], w / 2, 0, Math.PI * 2); inkCtx.fill(); }
function segment(a, b) { inkCtx.beginPath(); inkCtx.moveTo(a[0], a[1]); inkCtx.lineTo(b[0], b[1]); inkCtx.stroke(); }
function replay() {
  inkCtx.globalCompositeOperation = 'source-over';
  inkCtx.clearRect(0, 0, WALL_W, WALL_H);
  for (const s of strokes) {
    setPen(s); dot(s.pts[0], s.width);
    for (let i = 1; i < s.pts.length; i++) segment(s.pts[i - 1], s.pts[i]);
  }
}
function drawState() { $('#btnUndo').disabled = $('#btnDrawClear').disabled = !strokes.length; }
function setEraser(on) { erasing = on; $('#btnEraser').setAttribute('aria-pressed', String(on)); }

inkCv.addEventListener('pointerdown', e => {
  // A second finger resting on the glass must not start a second line.
  if (stroke || !e.isPrimary) return;
  e.preventDefault();
  inkCv.setPointerCapture(e.pointerId);
  strokeId = e.pointerId;
  stroke = { color: inkColor(), width: inkWidth() * (erasing ? 2 : 1), erase: erasing, pts: [inkPoint(e)] };
  setPen(stroke); dot(stroke.pts[0], stroke.width); // a tap leaves a dot
});
inkCv.addEventListener('pointermove', e => {
  if (!stroke || e.pointerId !== strokeId) return;
  e.preventDefault();
  for (const ev of (e.getCoalescedEvents?.() || [e])) {
    const p = inkPoint(ev);
    segment(stroke.pts[stroke.pts.length - 1], p);
    stroke.pts.push(p);
  }
});
for (const ev of ['pointerup', 'pointercancel']) inkCv.addEventListener(ev, e => {
  if (!stroke || e.pointerId !== strokeId) return;
  strokes.push(stroke); stroke = null; strokeId = null;
  drawState();
});

$('#inkPick').addEventListener('input', e => {
  $('#customSw').style.setProperty('--c', e.target.value);
  document.querySelector('input[name=ink][value=custom]').checked = true;
});
$('#inkPick').addEventListener('click', () => { document.querySelector('input[name=ink][value=custom]').checked = true; });
$('#btnEraser').addEventListener('click', () => setEraser(!erasing));
$('#btnUndo').addEventListener('click', () => { strokes.pop(); replay(); drawState(); });
$('#btnDrawClear').addEventListener('click', () => { strokes = []; replay(); drawState(); });
window.addEventListener('resize', () => { if ($('#dlgDraw').open) fitBoard(); });

function openDraw() {
  strokes = []; stroke = null; strokeId = null; setEraser(false);
  inkCtx.globalCompositeOperation = 'source-over'; inkCtx.clearRect(0, 0, WALL_W, WALL_H);
  // The wall as it is now sits under the new layer, so the child draws on the
  // real thing and not on a blank sheet.
  baseCtx.clearRect(0, 0, WALL_W, WALL_H); baseCtx.drawImage(mural, 0, 0);
  $('#drawFrom').value = localStorage.getItem('myName') || '';
  $('#drawErr').hidden = true;
  $('#dlgDraw').showModal();
  fitBoard(); drawState();
}
// A drawing not yet on the wall is worth one question before it is lost.
function closeDraw() {
  if (!strokes.length || confirm('Desenul nu e încă pe perete. Închizi oricum?')) $('#dlgDraw').close();
}
$('#btnDrawClose').addEventListener('click', closeDraw);
$('#dlgDraw').addEventListener('cancel', e => { e.preventDefault(); closeDraw(); });
$('#btnDraw').addEventListener('click', openDraw);
mural.addEventListener('click', openDraw);

$('#formDraw').addEventListener('submit', async e => {
  e.preventDefault();
  const from = $('#drawFrom').value.trim(); if (!from) return;
  if (!strokes.some(s => !s.erase)) { $('#drawErr').textContent = 'Desenează ceva mai întâi.'; $('#drawErr').hidden = false; return; }
  localStorage.setItem('myName', from);
  navigator.storage?.persist?.().catch(() => {});
  const btn = $('#btnSaveDraw'); btn.disabled = true; btn.textContent = 'Se lipește…';
  try {
    const drawing = await new Promise(r => inkCv.toBlob(r, 'image/png')); // transparent: only this child's ink
    if (!drawing) throw new Error('desenul nu a putut fi salvat');
    await store.addDrawing({ from, drawing });
    strokes = [];
    $('#dlgDraw').close(); toast('Desenul tău e pe perete!');
    await renderMural();
  } catch (err) { $('#drawErr').textContent = 'Nu s-a putut lipi pe perete: ' + err.message; $('#drawErr').hidden = false; }
  finally { btn.disabled = false; btn.textContent = 'Lipește pe perete'; }
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
renderMural();
renderGallery();

/* ---------- PWA: install, updates, offline ---------- */
const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: minimal-ui)').matches ||
  navigator.standalone === true;

// iOS reports itself as a Mac when the iPad asks for a desktop site, hence the
// touch-point check next to the plain user-agent one.
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

const btnInstall = $('#btnInstall');
let installPrompt = null;

addEventListener('beforeinstallprompt', e => {
  // Keep the browser's own mini-infobar away; the header button does this job.
  e.preventDefault();
  installPrompt = e;
  btnInstall.hidden = false;
});

// Safari never fires that event, so on an iPhone we offer the button anyway and
// explain the two taps by hand — which is where most of these kids will be.
if (isIos && !isStandalone()) btnInstall.hidden = false;

btnInstall.addEventListener('click', async () => {
  if (!installPrompt) {
    // No prompt to show: either iOS, or the user already dismissed one (the
    // event is single-use). Both cases end in the same short instructions.
    $('#instrIos').hidden = !isIos;
    $('#instrOther').hidden = isIos;
    $('#dlgInstall').showModal();
    return;
  }
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  // Leave the button up after a dismissal so it can be tried again; the click
  // above falls back to the instructions now that the prompt is spent.
  if (outcome === 'accepted') btnInstall.hidden = true;
});

addEventListener('appinstalled', () => { installPrompt = null; btnInstall.hidden = true; });

const offlinePill = $('#offlinePill');
const showOnline = () => { offlinePill.hidden = navigator.onLine; };
addEventListener('offline', showOnline);
addEventListener('online', () => { showOnline(); toast('Ai revenit online.'); });
showOnline();

if ('serviceWorker' in navigator) {
  // Set when the user accepts the update, so the reload below only fires for a
  // swap they asked for — not for the first worker claiming the page.
  let swapping = false;

  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = worker => {
      // A worker waiting with nothing in control is just the first install.
      if (!worker || !navigator.serviceWorker.controller) return;
      $('#updateBar').hidden = false;
      $('#btnUpdate').onclick = () => {
        swapping = true;
        $('#updateBar').hidden = true;
        worker.postMessage('skip-waiting');
      };
    };
    $('#btnUpdateLater').onclick = () => { $('#updateBar').hidden = true; };

    offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    // An installed album can stay open for days; look for a deploy now and then.
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!swapping) return;
    swapping = false;
    location.reload();
  });
}

// Manifest shortcuts (long-press the installed icon) arrive as ?actiune=…
const shortcut = new URLSearchParams(location.search).get('actiune');
if (shortcut === 'poze') $('#btnAddPhotos').click();
else if (shortcut === 'adauga') openAdd();
else if (shortcut === 'deseneaza') openDraw();
// Drop the parameter so a reload does not reopen the sheet.
if (shortcut) history.replaceState(null, '', location.pathname);

