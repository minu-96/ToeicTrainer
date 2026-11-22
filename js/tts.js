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
