const $ = s => document.querySelector(s);
const MAX_SEC = 20;
let students = [];

/* ---------- helpers ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }
function tilt(seed) { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ((h % 700) / 100 - 3.5).toFixed(1); }
function initials(name) { return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
function esc(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(sec) { return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

/* ---------- wall ---------- */
async function renderWall() {
  try { students = await store.listStudents(); }
  catch (e) { $('#empty').hidden = false; $('#empty').textContent = 'Nu pot încărca albumul: ' + e.message; return; }
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

function stopCam() { stream?.getTracks().forEach(t => t.stop()); stream = null; video.hidden = true; $('#btnSnap').hidden = true; }

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
  const f = e.target.files[0]; if (!f) return;
  const img = await createImageBitmap(f);
  const size = Math.min(img.width, img.height);
  const c = document.createElement('canvas'); c.width = c.height = 800;
  c.getContext('2d').drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 800, 800);
  c.toBlob(b => setPhoto(b), 'image/jpeg', 0.85);
  stopCam(); e.target.value = '';
});

function setPhoto(blob) {
  photoBlob = blob; preview.src = URL.createObjectURL(blob); preview.hidden = false; $('#photoPh').hidden = true;
  $('#btnRetake').hidden = false; $('#btnCam').hidden = true;
}
$('#btnRetake').addEventListener('click', () => { photoBlob = null; preview.hidden = true; $('#photoPh').hidden = false; $('#btnRetake').hidden = true; $('#btnCam').hidden = false; });

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
  photoBlob = audioBlob = null;
  $('#formAdd').reset(); preview.hidden = true; $('#photoPh').hidden = false; $('#btnRetake').hidden = true; $('#btnCam').hidden = false;
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

/* ---------- boot ---------- */
renderWall();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
