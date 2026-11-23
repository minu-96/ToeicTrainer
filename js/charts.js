// 가벼운 SVG 차트 (라이브러리 없이, 오프라인에서도 동작)
// 선 2px · 점 지름 8px+ · 막대 위쪽만 4px 둥글게 · 쌓인 막대 사이 2px 간격 · 격자는 흐리게
// 터치/마우스를 올리면 세로 안내선과 툴팁이 나온다.

const W = 340;
const PAD = { l: 36, r: 10, t: 14, b: 24 };
const registry = new Map();
let seq = 0;

const escText = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 눈금 4칸으로 나눴을 때 깔끔한 숫자가 되는 최댓값
function niceMax(v) {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 4, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

// x축 라벨: 5개 안팎만, 마지막(지금 기간)은 항상 표시
function xLabels(points, xAt) {
  const n = points.length;
  const every = Math.max(1, Math.ceil(n / 5));
  const show = new Set();
  for (let i = 0; i < n; i += every) show.add(i);
  const lastShown = Math.max(...show);
  if (lastShown !== n - 1) {
    if (n - 1 - lastShown < every * 0.6 && lastShown !== 0) show.delete(lastShown);
    show.add(n - 1);
  }
  return [...show]
    .map((i) => `<text class="ax" x="${xAt(i)}" y="${H() - 6}" text-anchor="middle">${escText(points[i].label)}</text>`)
    .join('');
}

const H = () => 170;

function frame(yMin, yMax, fmt, ticks = 4) {
  const h = H();
  const yAt = (v) => PAD.t + (h - PAD.t - PAD.b) * (1 - (v - yMin) / (yMax - yMin || 1));
  let grid = '';
  for (let k = 0; k <= ticks; k++) {
    const v = yMin + ((yMax - yMin) * k) / ticks;
    const y = yAt(v);
    grid += `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/><text class="ax" x="${PAD.l - 6}" y="${y + 4}" text-anchor="end">${escText(fmt(v))}</text>`;
  }
  return { h, yAt, grid };
}

function wrap(id, svg, legend, aria) {
  return `<div class="chart" data-cid="${id}">
    ${legend}
    <div class="chart-box">
      <svg viewBox="0 0 ${W} ${H()}" role="img" aria-label="${escText(aria)}">${svg}<line class="guide" x1="0" x2="0" y1="${PAD.t}" y2="${H() - PAD.b}" style="display:none"/></svg>
      <div class="tip" role="status"></div>
    </div>
  </div>`;
}

function legendHtml(series) {
  if (series.length < 2) return '';
  return `<ul class="legend chart-legend">${series.map((s) => `<li><b class="sw ${s.cls}"></b>${escText(s.name)}</li>`).join('')}</ul>`;
}

// points: [{ label, values: { key: number|null }, tip: '툴팁 문구' }]
// series: [{ key, name, cls: 'c1'|'c2' }]
export function line({ points, series, yMin = 0, yMax, ticks = 4, fmt = (v) => v, ref, aria = '' }) {
  const id = 'c' + ++seq;
  const all = points.flatMap((p) => series.map((s) => p.values[s.key])).filter((v) => v !== null && v !== undefined);
  const top = yMax ?? niceMax(Math.max(...all, ref?.value ?? 0, 1));
  const { yAt, grid } = frame(yMin, top, fmt, ticks);
  const step = (W - PAD.l - PAD.r) / Math.max(1, points.length - 1);
  const xAt = (i) => (points.length === 1 ? (PAD.l + W - PAD.r) / 2 : PAD.l + i * step);

  let body = '';
  if (ref && ref.value >= yMin && ref.value <= top) {
    const y = yAt(ref.value);
    body += `<line class="ref" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/><text class="ref-label" x="${PAD.l + 4}" y="${y - 5}">${escText(ref.label)}</text>`;
  }
  for (const s of series) {
    // 값이 없는 구간은 선을 끊는다
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      const v = p.values[s.key];
      if (v === null || v === undefined) return (pen = false);
      d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      pen = true;
    });
    if (d) body += `<path class="ln ${s.cls}" d="${d}"/>`;
    points.forEach((p, i) => {
      const v = p.values[s.key];
      if (v === null || v === undefined) return;
      const last = i === points.length - 1 || points.slice(i + 1).every((q) => q.values[s.key] == null);
      body += `<circle class="pt ${s.cls}" cx="${xAt(i)}" cy="${yAt(v)}" r="${last ? 5 : 4}"/>`;
      if (last && series.length === 1) {
        const nearRef = ref && Math.abs(yAt(ref.value) - (yAt(v) - 10)) < 12;
        const ly = nearRef || yAt(v) - 10 < PAD.t ? yAt(v) + 18 : yAt(v) - 10;
        body += `<text class="val" x="${xAt(i)}" y="${ly}" text-anchor="${i === 0 ? 'start' : 'end'}">${escText(fmt(v))}</text>`;
      }
    });
  }
  registry.set(id, { points, xAt, step });
  return wrap(id, grid + body + xLabels(points, xAt), legendHtml(series), aria);
}

// 쌓인 막대
export function bars({ points, series, fmt = (v) => v, aria = '' }) {
  const id = 'c' + ++seq;
  const totals = points.map((p) => series.reduce((s, x) => s + (p.values[x.key] || 0), 0));
  const top = niceMax(Math.max(...totals, 1));
  const { yAt, grid } = frame(0, top, fmt);
  const step = (W - PAD.l - PAD.r) / points.length;
  const bw = Math.min(22, step * 0.62);
  const xAt = (i) => PAD.l + step * (i + 0.5);
  const base = yAt(0);

  let body = '';
  points.forEach((p, i) => {
    let y0 = base;
    const segs = series.map((s) => ({ s, v: p.values[s.key] || 0 })).filter((x) => x.v > 0);
    segs.forEach((seg, k) => {
      const hgt = base - yAt(seg.v);
      const gap = k > 0 ? 2 : 0; // 쌓인 칸 사이 2px
      const yTop = y0 - hgt;
      const x = xAt(i) - bw / 2;
      const isTop = k === segs.length - 1;
      const r = isTop ? Math.min(4, hgt / 2, bw / 2) : 0;
      const yb = y0 - gap;
      const yt = Math.min(yTop, yb - 1);
      body += `<path class="bar ${seg.s.cls}" d="M${x},${yb} L${x},${yt + r} Q${x},${yt} ${x + r},${yt} L${x + bw - r},${yt} Q${x + bw},${yt} ${x + bw},${yt + r} L${x + bw},${yb} Z"/>`;
      y0 = yTop;
    });
  });
  registry.set(id, { points, xAt, step, bar: true });
  return wrap(id, grid + body + xLabels(points, xAt), legendHtml(series), aria);
}

// 화면에 넣은 뒤 툴팁 연결
export function bind(root) {
  root.querySelectorAll('.chart[data-cid]').forEach((el) => {
    const data = registry.get(el.dataset.cid);
    if (!data) return;
    const svg = el.querySelector('svg');
    const tip = el.querySelector('.tip');
    const guide = el.querySelector('.guide');
    const show = (ev) => {
      const rect = svg.getBoundingClientRect();
      const scale = rect.width / W;
      const x = (ev.clientX - rect.left) / scale;
      let i = data.bar ? Math.floor((x - PAD.l) / data.step) : Math.round((x - PAD.l) / (data.step || 1));
      i = Math.max(0, Math.min(data.points.length - 1, i));
      const p = data.points[i];
      const gx = data.xAt(i);
      guide.setAttribute('x1', gx);
      guide.setAttribute('x2', gx);
      guide.style.display = '';
      tip.innerHTML = p.tip;
      tip.style.display = 'block';
      const left = gx * scale;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(rect.width - tw, left - tw / 2)) + 'px';
    };
    const hide = () => {
      guide.style.display = 'none';
      tip.style.display = 'none';
    };
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointermove', (e) => (e.pointerType === 'mouse' || e.buttons) && show(e));
    svg.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hide());
  });
}
