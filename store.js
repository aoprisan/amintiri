/* Data layer. Set API_BASE (in config.js or window.API_BASE) to use your backend;
 * leave empty to keep everything in this browser (IndexedDB). See README for the API contract. */

const API_BASE = (window.API_BASE || '').replace(/\/$/, '');

/* ---------- Local store: IndexedDB, blobs kept as-is ---------- */
class LocalStore {
  constructor() { this.dbp = new Promise((res, rej) => {
    const r = indexedDB.open('absolvire', 3);
    r.onupgradeneeded = () => {
      const db = r.result;
      // Guarded so an album created before the gallery or the wall existed upgrades in place.
      if (!db.objectStoreNames.contains('students')) db.createObjectStore('students', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('impressions')) db.createObjectStore('impressions', { keyPath: 'id' }).createIndex('by_student', 'studentId');
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('drawings')) db.createObjectStore('drawings', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }); }
  async _tx(name, mode, fn) {
    const db = await this.dbp;
    return new Promise((res, rej) => {
      const tx = db.transaction(name, mode); const st = tx.objectStore(name);
      const out = fn(st); tx.oncomplete = () => res(out.result ?? out); tx.onerror = () => rej(tx.error);
    });
  }
  async listStudents() {
    const rows = await this._tx('students', 'readonly', st => st.getAll());
    return rows.sort((a, b) => a.createdAt - b.createdAt).map(s => ({
      id: s.id, name: s.name, createdAt: s.createdAt,
      photoUrl: s.photo ? URL.createObjectURL(s.photo) : null,
      audioUrl: s.audio ? URL.createObjectURL(s.audio) : null,
      signatureUrl: s.signature ? URL.createObjectURL(s.signature) : null,
    }));
  }
  async createStudent({ name, photo, audio, signature }) {
    const s = { id: crypto.randomUUID(), name, photo, audio, signature, createdAt: Date.now() };
    await this._tx('students', 'readwrite', st => st.put(s));
    return s.id;
  }
  async listImpressions(studentId) {
    const db = await this.dbp;
    return new Promise((res, rej) => {
      const req = db.transaction('impressions').objectStore('impressions').index('by_student').getAll(studentId);
      req.onsuccess = () => res(req.result.sort((a, b) => a.createdAt - b.createdAt)); req.onerror = () => rej(req.error);
    });
  }
  async addImpression(studentId, { from, text, color }) {
    const n = { id: crypto.randomUUID(), studentId, from, text, color, createdAt: Date.now() };
    await this._tx('impressions', 'readwrite', st => st.put(n));
    return n;
  }
  async listPhotos() {
    const rows = await this._tx('photos', 'readonly', st => st.getAll());
    return rows.sort((a, b) => b.createdAt - a.createdAt).map(p => ({
      id: p.id, caption: p.caption || '', from: p.from || '', createdAt: p.createdAt,
      url: URL.createObjectURL(p.photo),
      thumbUrl: p.thumb ? URL.createObjectURL(p.thumb) : null,
    }));
  }
  async addPhoto({ photo, thumb, caption, from }) {
    const p = { id: crypto.randomUUID(), photo, thumb, caption: caption || '', from: from || '', createdAt: Date.now() };
    await this._tx('photos', 'readwrite', st => st.put(p));
    return p.id;
  }
  // The wall is its layers in the order they were added: each one is a
  // transparent PNG the size of the wall, and drawing them oldest-first is
  // exactly what the kids saw when they drew.
  async listDrawings() {
    const rows = await this._tx('drawings', 'readonly', st => st.getAll());
    return rows.sort((a, b) => a.createdAt - b.createdAt).map(d => ({
      id: d.id, from: d.from || '', createdAt: d.createdAt, url: URL.createObjectURL(d.drawing),
    }));
  }
  async addDrawing({ from, drawing }) {
    const d = { id: crypto.randomUUID(), from: from || '', drawing, createdAt: Date.now() };
    await this._tx('drawings', 'readwrite', st => st.put(d));
    return d.id;
  }
}

/* ---------- Remote store: your backend ---------- */
class RemoteStore {
  constructor(base) { this.base = base; }
  get code() { return localStorage.getItem('classCode') || ''; }
  headers(extra = {}) { return { 'X-Class-Code': this.code, ...extra }; }
  async _json(res) {
    if (res.status === 401 || res.status === 403) { localStorage.removeItem('classCode'); throw new Error('Codul clasei nu e bun. Reîncarcă pagina și introdu-l din nou.'); }
    if (!res.ok) throw new Error(`Serverul a răspuns ${res.status}`);
    return res.json();
  }
  async listStudents() {
    return this._json(await fetch(`${this.base}/students`, { headers: this.headers() }));
  }
  async createStudent({ name, photo, audio, signature }) {
    const fd = new FormData();
    fd.append('name', name);
    if (photo) fd.append('photo', photo, 'photo.jpg');
    if (audio) fd.append('audio', audio, 'voice.' + (audio.type.includes('mp4') ? 'm4a' : 'webm'));
    if (signature) fd.append('signature', signature, 'signature.png');
    const s = await this._json(await fetch(`${this.base}/students`, { method: 'POST', headers: this.headers(), body: fd }));
    return s.id;
  }
  async listImpressions(studentId) {
    return this._json(await fetch(`${this.base}/students/${studentId}/impressions`, { headers: this.headers() }));
  }
  async addImpression(studentId, body) {
    return this._json(await fetch(`${this.base}/students/${studentId}/impressions`, {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
    }));
  }
  async listPhotos() {
    return this._json(await fetch(`${this.base}/photos`, { headers: this.headers() }));
  }
  async addPhoto({ photo, thumb, caption, from }) {
    const fd = new FormData();
    fd.append('photo', photo, 'photo.jpg');
    if (thumb) fd.append('thumb', thumb, 'thumb.jpg');
    fd.append('caption', caption || '');
    fd.append('from', from || '');
    const p = await this._json(await fetch(`${this.base}/photos`, { method: 'POST', headers: this.headers(), body: fd }));
    return p.id;
  }
  async listDrawings() {
    return this._json(await fetch(`${this.base}/drawings`, { headers: this.headers() }));
  }
  async addDrawing({ from, drawing }) {
    const fd = new FormData();
    fd.append('from', from || '');
    fd.append('drawing', drawing, 'desen.png');
    const d = await this._json(await fetch(`${this.base}/drawings`, { method: 'POST', headers: this.headers(), body: fd }));
    return d.id;
  }
}

window.store = API_BASE ? new RemoteStore(API_BASE) : new LocalStore();
if (API_BASE && !localStorage.getItem('classCode')) {
  const c = prompt('Codul clasei (l-ai primit de la doamna/domnul învățător):');
  if (c) localStorage.setItem('classCode', c.trim());
}
