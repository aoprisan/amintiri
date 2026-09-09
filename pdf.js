/* Minimal PDF writer — the album as one file you can print or e-mail.
 *
 * Same reasoning as zip.js: no build step, so no library. A PDF is a list of
 * numbered objects, a cross-reference table of their byte offsets, and a
 * trailer pointing at the catalogue. Pages carry a content stream of drawing
 * operators; photos go in as the JPEG bytes themselves (/DCTDecode), which is
 * why the album's own JPEGs need no re-encoding beyond a resize.
 *
 * Text uses the two Helvetica faces every reader already has, so nothing is
 * embedded. Romanian is the catch: WinAnsi has â and î but not ă, ș or ț, so
 * six unused codes are remapped to those glyphs, and a /ToUnicode map sends
 * them back to the right code points — the page shows ș, and copying it out
 * of the PDF yields U+0219 rather than a cedilla or a question mark.
 */
(function () {
  'use strict';

  const A4 = [595.28, 841.89];

  /* ---------- encoding ---------- */

  // Six WinAnsi codes nothing Romanian needs (Scaron and friends), lent to the
  // letters that WinAnsi is missing. Cedilla-below glyph names on purpose:
  // every substitute font has scedilla, few have the comma-below variants.
  const SPARE = {
    0x81: ['abreve', 0x0103],
    0x8A: ['Tcommaaccent', 0x021A],
    0x8D: ['Abreve', 0x0102],
    0x8F: ['scedilla', 0x0219],
    0x90: ['Scedilla', 0x0218],
    0x9D: ['tcommaaccent', 0x021B],
  };

  // Unicode -> byte. Latin-1 rides along unchanged; the punctuation the app's
  // own copy uses (curly quotes, dashes, ellipsis) sits where WinAnsi keeps it.
  const MAP = new Map();
  for (let c = 32; c <= 126; c++) MAP.set(c, c);
  for (let c = 0xA0; c <= 0xFF; c++) MAP.set(c, c);
  const PUNCT = { 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85 };
  for (const k in PUNCT) MAP.set(+k, PUNCT[k]);
  // Both spellings of ș/ț — comma-below (correct) and the legacy cedilla ones.
  const RO = { 0x0103: 0x81, 0x0102: 0x8D, 0x0219: 0x8F, 0x015F: 0x8F, 0x0218: 0x90, 0x015E: 0x90, 0x021B: 0x9D, 0x0163: 0x9D, 0x021A: 0x8A, 0x0162: 0x8A };
  for (const k in RO) MAP.set(+k, RO[k]);

  // Byte -> Unicode, for /ToUnicode. The spare codes point at the real letter.
  const BACK = new Map();
  for (let c = 32; c <= 126; c++) BACK.set(c, c);
  for (let c = 0xA0; c <= 0xFF; c++) BACK.set(c, c);
  for (const k in PUNCT) BACK.set(PUNCT[k], +k);
  for (const k in SPARE) BACK.set(+k, SPARE[k][1]);

  function encode(s) {
    let out = '';
    for (const ch of String(s == null ? '' : s)) {
      const cp = ch.codePointAt(0);
      const b = MAP.get(cp);
      out += String.fromCharCode(b === undefined ? 63 /* ? */ : b);
    }
    return out;
  }

  /* ---------- widths ---------- */

  const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
  // Accented Latin-1 letters carry their base letter's width; '?' marks the ones
  // with no ASCII base (the ligatures, eth, thorn), listed in ODD below.
  const BASE = 'AAAAAA?CEEEEIIIIDNOOOOO?OUUUUY??aaaaaa?ceeeeiiii?nooooo?ouuuuy?y';
  // Helvetica's own values; the bold face differs by a point or two at most,
  // which is well inside what a supplied /Widths array has to be right about.
  const ODD = {
    0xA0: 278, 0xA1: 333, 0xA2: 556, 0xA3: 556, 0xA4: 556, 0xA5: 556, 0xA6: 260, 0xA7: 556,
    0xA8: 333, 0xA9: 737, 0xAA: 370, 0xAB: 556, 0xAC: 584, 0xAD: 333, 0xAE: 737, 0xAF: 333,
    0xB0: 400, 0xB1: 584, 0xB2: 333, 0xB3: 333, 0xB4: 333, 0xB5: 556, 0xB6: 537, 0xB7: 278,
    0xB8: 333, 0xB9: 333, 0xBA: 365, 0xBB: 556, 0xBC: 834, 0xBD: 834, 0xBE: 834, 0xBF: 611,
    0xC6: 1000, 0xD0: 722, 0xD7: 584, 0xDE: 667, 0xDF: 611,
    0xE6: 889, 0xF0: 556, 0xF7: 584, 0xF8: 611, 0xFE: 556,
  };

  function widths(bold) {
    const t = bold ? BOLD : REG, w = [];
    const at = ch => t[ch.charCodeAt(0) - 32];
    for (let c = 32; c <= 255; c++) {
      if (c <= 126) { w.push(t[c - 32]); continue; }
      if (SPARE[c]) { w.push(at(SPARE[c][0][0])); continue; }   // abreve -> a, Scedilla -> S
      if (c === 0x85) { w.push(1000); continue; }               // ellipsis
      if (c === 0x91 || c === 0x92) { w.push(at("'")); continue; }
      if (c === 0x93 || c === 0x94) { w.push(at('"')); continue; }
      if (c === 0x95) { w.push(350); continue; }                // bullet
      if (c === 0x96) { w.push(556); continue; }                // en dash
      if (c === 0x97) { w.push(1000); continue; }               // em dash
      if (c >= 0xC0 && BASE[c - 0xC0] !== '?') { w.push(at(BASE[c - 0xC0])); continue; }
      w.push(ODD[c] || 556);
    }
    return w;
  }
  const W = { F1: widths(false), F2: widths(true) };

  // Measured with the very widths the PDF declares, so a line that fits here
  // fits on the page too, whatever font the reader substitutes.
  function textWidth(str, font, size) {
    const t = W[font] || W.F1;
    let sum = 0;
    for (const ch of encode(str)) {
      const c = ch.charCodeAt(0);
      sum += c >= 32 && c <= 255 ? t[c - 32] : 556;
    }
    return sum * size / 1000;
  }

  function wrap(str, font, size, maxW) {
    const out = [];
    for (const para of String(str == null ? '' : str).split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let line = '';
      for (const word of words) {
        const next = line ? line + ' ' + word : word;
        if (line && textWidth(next, font, size) > maxW) { out.push(line); line = word; }
        else line = next;
        // A single word longer than the column (a URL, a very long name).
        while (textWidth(line, font, size) > maxW && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && textWidth(line.slice(0, cut), font, size) > maxW) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      if (line) out.push(line);
    }
    return out;
  }

  /* ---------- bytes ---------- */

  function latin1(s) {
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF;
    return u;
  }
  function pdfString(s) {
    return '(' + encode(s).replace(/[\\()]/g, m => '\\' + m)
      .replace(/[\x00-\x1f\x7f-\xff]/g, m => '\\' + m.charCodeAt(0).toString(8).padStart(3, '0')) + ')';
  }
  // Strings PDF reads for itself — the title bar, the bookmark tree — are never
  // drawn with our font, so they take PDF's own UTF-16BE form instead of the
  // page encoding, where 0x8A means Tcommaaccent to us and Scaron to the reader.
  function pdfTextString(s) {
    let out = 'FEFF';
    for (const ch of String(s == null ? '' : s)) {
      let cp = ch.codePointAt(0);
      if (cp > 0xFFFF) {
        cp -= 0x10000;
        out += (0xD800 + (cp >> 10)).toString(16).padStart(4, '0');
        out += (0xDC00 + (cp & 0x3FF)).toString(16).padStart(4, '0');
      } else out += cp.toString(16).padStart(4, '0');
    }
    return '<' + out.toUpperCase() + '>';
  }

  const n = v => (Math.round(v * 100) / 100).toString();

  /* ---------- document ---------- */

  class Pdf {
    constructor(opts) {
      opts = opts || {};
      this.W = (opts.size || A4)[0];
      this.H = (opts.size || A4)[1];
      this.title = opts.title || '';
      this.author = opts.author || '';
      this.objs = [];        // 1-based; objs[i - 1] = { head, stream }
      this.pages = [];       // { ops: [] }
      this.images = [];      // { num, w, h, bytes }
      this.bookmarks = [];   // { title, page }
      this.cur = null;
    }

    alloc() { this.objs.push(null); return this.objs.length; }
    put(num, head, stream) { this.objs[num - 1] = { head, stream: stream || null }; }

    addPage() { this.cur = { ops: [], images: new Set() }; this.pages.push(this.cur); return this.pages.length - 1; }
    get pageIndex() { return this.pages.length - 1; }
    op(s) { this.cur.ops.push(s); }

    bookmark(title, page) { this.bookmarks.push({ title, page: page == null ? this.pageIndex : page }); }

    /* Everything below takes top-left coordinates and flips them here, so the
     * layout code reads like the HTML it mirrors. */
    y(v) { return this.H - v; }

    rect(x, y, w, h, o) {
      o = o || {};
      this.op('q');
      if (o.fill) this.op(rgb(o.fill) + ' rg');
      if (o.stroke) { this.op(rgb(o.stroke) + ' RG'); this.op(n(o.width || 1) + ' w'); }
      this.op(`${n(x)} ${n(this.y(y + h))} ${n(w)} ${n(h)} re`);
      this.op(o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S');
      this.op('Q');
    }

    line(x1, y1, x2, y2, o) {
      o = o || {};
      this.op('q');
      this.op(rgb(o.color || '#000') + ' RG');
      this.op(n(o.width || 1) + ' w');
      this.op(`${n(x1)} ${n(this.y(y1))} m ${n(x2)} ${n(this.y(y2))} l S`);
      this.op('Q');
    }

    text(str, x, y, o) {
      o = o || {};
      const size = o.size || 11, font = o.font || 'F1';
      let tx = x;
      if (o.align === 'center') tx = x - textWidth(str, font, size) / 2;
      if (o.align === 'right') tx = x - textWidth(str, font, size);
      this.op('BT');
      this.op(rgb(o.color || '#1c2541') + ' rg');
      this.op(`/${font} ${n(size)} Tf`);
      this.op(`1 0 0 1 ${n(tx)} ${n(this.y(y + size * 0.8))} Tm`);
      this.op(`${pdfString(str)} Tj`);
      this.op('ET');
    }

    /* Returns the y just past the last line, so callers can stack blocks. */
    paragraph(str, x, y, maxW, o) {
      o = o || {};
      const size = o.size || 11, lead = o.lead || size * 1.35;
      const lines = wrap(str, o.font || 'F1', size, maxW);
      const limit = o.maxLines && lines.length > o.maxLines ? o.maxLines : lines.length;
      for (let i = 0; i < limit; i++) {
        let ln = lines[i];
        if (o.maxLines && limit < lines.length && i === limit - 1) ln = ln.replace(/[\s.,;:]+$/, '') + '…';
        this.text(ln, o.align === 'center' ? x + maxW / 2 : x, y + i * lead, { ...o, align: o.align });
      }
      return y + limit * lead;
    }

    /* img: { num, w, h } from Pdf.image(). Drawn into the box, aspect kept. */
    drawImage(img, x, y, w, h, o) {
      o = o || {};
      const k = o.cover
        ? Math.max(w / img.w, h / img.h)
        : Math.min(w / img.w, h / img.h);
      const dw = img.w * k, dh = img.h * k;
      const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
      this.cur.images.add(img.num);
      this.op('q');
      if (o.cover) this.op(`${n(x)} ${n(this.y(y + h))} ${n(w)} ${n(h)} re W n`); // crop to the frame
      this.op(`${n(dw)} 0 0 ${n(dh)} ${n(dx)} ${n(this.y(dy + dh))} cm`);
      this.op(`/I${img.num} Do`);
      this.op('Q');
    }

    /* The polaroids on the wall are tilted; so are these. Rotates about the
     * box's centre, then runs fn with the box moved to the origin's corner. */
    tilted(x, y, w, h, deg, fn) {
      const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      const cx = x + w / 2, cy = this.y(y + h / 2);
      this.op('q');
      this.op(`1 0 0 1 ${n(cx)} ${n(cy)} cm`);
      this.op(`${n(c)} ${n(s)} ${n(-s)} ${n(c)} 0 0 cm`);
      this.op(`1 0 0 1 ${n(-cx)} ${n(-cy)} cm`);
      fn();
      this.op('Q');
    }

    /* JPEG bytes straight in — no decoding, no re-encoding on our side. */
    image(bytes, w, h) {
      const num = this.alloc();
      const img = { num, w, h, bytes };
      this.images.push(img);
      return img;
    }

    build() {
      const catalog = this.alloc(), pagesObj = this.alloc(), info = this.alloc();
      const fonts = { F1: this.alloc(), F2: this.alloc() };
      const toUni = this.alloc();
      for (const key of ['F1', 'F2']) {
        this.put(fonts[key],
          '<< /Type /Font /Subtype /Type1 ' +
          `/BaseFont /${key === 'F2' ? 'Helvetica-Bold' : 'Helvetica'} ` +
          '/FirstChar 32 /LastChar 255 ' +
          `/Widths [${W[key].join(' ')}] ` +
          `/Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${
            Object.keys(SPARE).map(Number).sort((a, b) => a - b)
              .map(c => `${c} /${SPARE[c][0]}`).join(' ')} ] >> ` +
          `/ToUnicode ${toUni} 0 R >>`);
      }
      this.put(toUni, null, latin1(toUnicodeCMap()));

      for (const img of this.images) {
        this.put(img.num,
          `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} ` +
          '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>',
          img.bytes);
      }

      const pageNums = this.pages.map(() => this.alloc());
      this.pages.forEach((p, i) => {
        const content = this.alloc();
        this.put(content, null, latin1(p.ops.join('\n') + '\n'));
        const xo = [...p.images].map(num => `/I${num} ${num} 0 R`).join(' ');
        this.put(pageNums[i],
          `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(this.W)} ${n(this.H)}] ` +
          `/Resources << /Font << /F1 ${fonts.F1} 0 R /F2 ${fonts.F2} 0 R >>` +
          (xo ? ` /XObject << ${xo} >>` : '') + ' >> ' +
          `/Contents ${content} 0 R >>`);
      });

      this.put(pagesObj,
        `<< /Type /Pages /Count ${pageNums.length} /Kids [${pageNums.map(x => x + ' 0 R').join(' ')}] >>`);

      // A flat outline: one entry per section, so a reader can jump about.
      let outlineRef = '';
      if (this.bookmarks.length) {
        const root = this.alloc();
        const items = this.bookmarks.map(() => this.alloc());
        this.bookmarks.forEach((b, i) => {
          const dest = pageNums[Math.min(b.page, pageNums.length - 1)];
          this.put(items[i],
            `<< /Title ${pdfTextString(b.title)} /Parent ${root} 0 R ` +
            (i ? `/Prev ${items[i - 1]} 0 R ` : '') +
            (i < items.length - 1 ? `/Next ${items[i + 1]} 0 R ` : '') +
            `/Dest [${dest} 0 R /XYZ 0 ${n(this.H)} null] >>`);
        });
        this.put(root, `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items[items.length - 1]} 0 R /Count ${items.length} >>`);
        outlineRef = ` /Outlines ${root} 0 R /PageMode /UseOutlines`;
      }

      this.put(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R${outlineRef} >>`);
      this.put(info,
        `<< /Title ${pdfTextString(this.title)} /Author ${pdfTextString(this.author)} ` +
        `/Producer ${pdfTextString('Album de absolvire')} /CreationDate ${pdfString(pdfDate(new Date()))} >>`);

      /* ---- serialise ---- */
      const parts = [];
      let at = 0;
      const push = x => { const u = typeof x === 'string' ? latin1(x) : x; parts.push(u); at += u.length; };
      push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

      const offsets = new Array(this.objs.length).fill(0);
      for (let i = 0; i < this.objs.length; i++) {
        const o = this.objs[i] || { head: '<< >>', stream: null };
        offsets[i] = at;
        push(`${i + 1} 0 obj\n`);
        if (o.stream) {
          // /Length is only known now, so the dictionary is closed here.
          const dict = (o.head ? o.head.replace(/\s*>>\s*$/, ' ') : '<< ') + `/Length ${o.stream.length} >>`;
          push(dict + '\nstream\n');
          push(o.stream);
          push('\nendstream\n');
        } else {
          push(o.head + '\n');
        }
        push('endobj\n');
      }

      const xref = at;
      let x = `xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`;
      for (const off of offsets) x += String(off).padStart(10, '0') + ' 00000 n \n';
      push(x);
      push(`trailer\n<< /Size ${this.objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

      return new Blob(parts, { type: 'application/pdf' });
    }
  }

  function rgb(hex) {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const num = parseInt(v, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255].map(c => n(c / 255)).join(' ');
  }

  function pdfDate(d) {
    const p = v => String(v).padStart(2, '0');
    return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function toUnicodeCMap() {
    const codes = [...BACK.keys()].sort((a, b) => a - b);
    let body = '';
    for (let i = 0; i < codes.length; i += 100) {
      const chunk = codes.slice(i, i + 100);
      body += `${chunk.length} beginbfchar\n`;
      for (const c of chunk) {
        body += `<${c.toString(16).padStart(2, '0').toUpperCase()}> <${BACK.get(c).toString(16).padStart(4, '0').toUpperCase()}>\n`;
      }
      body += 'endbfchar\n';
    }
    return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<00> <FF>\nendcodespacerange\n' +
      body +
      'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
  }

  Pdf.textWidth = textWidth;
  Pdf.wrap = wrap;
  Pdf.A4 = A4;
  window.Pdf = Pdf;
})();
