// 단어 문제 만들기: 뜻 고르기 / 단어 고르기 / 예문 빈칸

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 예문 속 단어 위치 찾기 (scheduled, supplies처럼 형태가 바뀐 것도 찾음)
export function findWordInSentence(word, sentence) {
  if (!sentence || !word) return null;
  const w = word.toLowerCase().trim();
  if (w.includes(' ')) {
    const i = sentence.toLowerCase().indexOf(w);
    return i >= 0 ? { start: i, end: i + w.length } : null;
  }
  const stems = [w];
  if (w.endsWith('e')) stems.push(w.slice(0, -1));
  if (w.endsWith('y')) stems.push(w.slice(0, -1) + 'i');
  const re = /[A-Za-zÀ-ÿ'-]+/g;
  let m;
  while ((m = re.exec(sentence))) {
    const tok = m[0].toLowerCase().replace(/'s$/, '');
    if (tok === w || stems.some((s) => tok.startsWith(s) && tok.length - s.length <= 4)) {
      return { start: m.index, end: m.index + m[0].length };
    }
  }
  return null;
}

export function canCloze(w) {
  return !!findWordInSentence(w.word, w.example);
}

function posKey(w) {
  return (w.pos || '').charAt(0);
}

// 오답 보기 3개: 같은 품사 우선, 뜻이 겹치지 않게
function distractors(target, pool, field, n = 3) {
  const seen = new Set([target[field]]);
  const same = shuffle(pool.filter((w) => w.id !== target.id && posKey(w) === posKey(target)));
  const other = shuffle(pool.filter((w) => w.id !== target.id && posKey(w) !== posKey(target)));
  const out = [];
  for (const w of [...same, ...other]) {
    if (out.length >= n) break;
    if (seen.has(w[field])) continue;
    seen.add(w[field]);
    out.push(w[field]);
  }
  return out;
}

function choicesWith(answer, wrong) {
  const choices = shuffle([answer, ...wrong]);
  return { choices, answer: choices.indexOf(answer) };
}

// 영어 단어 → 뜻 고르기
export function meaningQuestion(w, pool) {
  return { type: 'meaning', ...choicesWith(w.meaning, distractors(w, pool, 'meaning')) };
}

// 뜻 → 영어 단어 고르기
export function wordQuestion(w, pool) {
  return { type: 'word', ...choicesWith(w.word, distractors(w, pool, 'word')) };
}

// 예문 빈칸에 들어갈 단어 고르기 (예문이 없으면 단어 고르기로 대체)
export function clozeQuestion(w, pool) {
  const pos = findWordInSentence(w.word, w.example);
  if (!pos) return wordQuestion(w, pool);
  return {
    type: 'cloze',
    before: w.example.slice(0, pos.start),
    after: w.example.slice(pos.end),
    ...choicesWith(w.word, distractors(w, pool, 'word')),
  };
}

export function makeQuestion(step, w, pool) {
  if (step === 'meaning') return meaningQuestion(w, pool);
  if (step === 'cloze') return clozeQuestion(w, pool);
  if (step === 'word') return wordQuestion(w, pool);
  return { type: step }; // intro, recall은 보기 없음
}

// 예문 속 단어에 <mark> 표시 (escape 함수를 받아서 사용)
export function highlight(sentence, word, esc) {
  const pos = findWordInSentence(word, sentence);
  if (!pos) return esc(sentence);
  return esc(sentence.slice(0, pos.start)) + '<mark>' + esc(sentence.slice(pos.start, pos.end)) + '</mark>' + esc(sentence.slice(pos.end));
}
