// 브라우저 내장 TTS (iOS Safari 포함)

export const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function englishVoices() {
  if (!supported) return [];
  return speechSynthesis.getVoices().filter((v) => (v.lang || '').toLowerCase().startsWith('en'));
}

export function onVoicesChanged(cb) {
  if (supported && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', cb);
}

export function speak(text, { voice = '', rate = 0.9 } = {}) {
  if (!supported || !text) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  const v = englishVoices().find((x) => x.voiceURI === voice);
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  u.rate = rate;
  speechSynthesis.speak(u);
  return true;
}

// ---------- 듣기 (Part 2~4): 화자별 음성 · 억양 · 순서대로 읽기 ----------
const FEMALE = ['samantha', 'karen', 'moira', 'tessa', 'victoria', 'allison', 'ava', 'susan', 'serena', 'kate', 'martha', 'nicky', 'zoe', 'fiona', 'catherine', 'zira', 'aria', 'jenny', 'libby', 'natasha', 'sonia', 'female'];
const MALE = ['daniel', 'alex', 'fred', 'aaron', 'arthur', 'gordon', 'rishi', 'tom', 'oliver', 'lee', 'david', 'guy', 'ryan', 'william', 'george', 'male'];
const has = (v, names) => names.some((n) => (v.name || '').toLowerCase().includes(n));
const region = (v) => (v.lang || '').replace('_', '-').split('-')[1]?.toUpperCase() || 'US';

// W(여) · M(남) · M2(남2) · N(내레이터) 음성. 억양 섞기면 미국·영국·호주를 나눠 줌
export function pickVoices(mix = true) {
  const all = englishVoices();
  const used = new Set();
  const pick = (names, regions) => {
    const pool = all.filter((v) => !used.has(v.voiceURI));
    for (const r of regions) {
      const v = pool.find((x) => region(x) === r && has(x, names));
      if (v) return used.add(v.voiceURI), v;
    }
    const v = pool.find((x) => has(x, names)) || null;
    if (v) used.add(v.voiceURI);
    return v;
  };
  const us = ['US'];
  const W = pick(FEMALE, mix ? ['US', 'AU', 'GB'] : us);
  const M = pick(MALE, mix ? ['GB', 'AU', 'US'] : us);
  const M2 = pick(MALE, mix ? ['AU', 'US', 'GB'] : us);
  const N = pick([...FEMALE, ...MALE], mix ? ['US', 'GB'] : us) || W || M;
  return { W, M, M2: M2 || M, N };
}
// 음성을 찾지 못하면 높낮이로 화자를 구분
const PITCH = { W: 1.15, M: 0.85, M2: 0.72, N: 1 };

// lines: [{ who, text }] → 순서대로 읽기. 음성이 없거나 끝 신호가 안 오면 글자 수로 시간을 계산해 넘어감
export function speakLines(lines, { rate = 1, mix = true, gap = 450, onLine } = {}) {
  let stopped = false;
  let timer = null;
  const voices = pickVoices(mix);
  const done = new Promise((resolve) => {
    let i = 0;
    const next = () => {
      clearTimeout(timer);
      if (stopped || i >= lines.length) return resolve(!stopped);
      const line = lines[i++];
      onLine?.(i - 1);
      const words = line.text.split(/\s+/).length;
      const guess = Math.max(1200, (words * 380) / rate) + 1200;
      let moved = false;
      const go = () => {
        if (moved) return;
        moved = true;
        clearTimeout(timer);
        timer = setTimeout(next, gap);
      };
      timer = setTimeout(go, guess);
      if (supported) {
        const u = new SpeechSynthesisUtterance(line.text);
        const v = voices[line.who] || voices.N;
        u.lang = v?.lang || 'en-US';
        if (v) u.voice = v;
        u.pitch = v && voices[line.who] ? 1 : PITCH[line.who] || 1;
        u.rate = rate;
        u.onend = go;
        u.onerror = go;
        speechSynthesis.speak(u);
      }
    };
    if (supported) speechSynthesis.cancel();
    next();
  });
  return {
    done,
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (supported) speechSynthesis.cancel();
    },
  };
}

export function stopAll() {
  if (supported) speechSynthesis.cancel();
}
