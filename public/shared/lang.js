// Language definitions and detection, shared by the server and the browser

export const LANGS = {
  ja: { name: '日本語', short: 'JA' },
  en: { name: 'English', short: 'EN' },
  zh: { name: '中文（简体）', short: '中文' },
};

export const TARGET_LANGS = ['en', 'zh'];

const KANA = /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f]/;
const JA_ONLY_CHARS = /[々〆ヶ]/;
const HAN = /\p{Script=Han}/gu;
const LATIN = /[A-Za-z]/g;

// Kana means Japanese. Without kana, an English session picks whichever of Han or Latin
// characters dominates, and a Chinese session assumes Chinese.
export function detectSourceLang(text, targetLang) {
  if (KANA.test(text) || JA_ONLY_CHARS.test(text)) return 'ja';
  if (targetLang === 'zh') return 'zh';
  const han = text.match(HAN)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  if (han > 0 && han >= latin) return 'ja';
  return latin > 0 ? 'en' : 'ja';
}

export function translationLangOf(sourceLang, targetLang) {
  return sourceLang === 'ja' ? targetLang : 'ja';
}
