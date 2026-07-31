/**
 * B3 — server-side language classification. Makes NO LLM call and writes no `llm_calls`
 * row (ADR-I09, ai AC-13): it is a Unicode-script histogram plus a stop-word ratio over two
 * committed lists.
 *
 * This function classifies ONE text. The two-consecutive-turn switch rule that acts on the
 * result is backend's (I10) — nothing here counts turns or touches an interview.
 */

/** §3.4 margins. Both are ratios of the text, not absolute counts. */
export const SCRIPT_MARGIN = 0.6;
export const STOPWORD_MARGIN = 0.15;

/**
 * MVP interview languages are `{ en, tr }` (ai Q1). This map only decides what a clearly
 * non-Latin text is; a hit here means the answer is in neither supported language, which
 * backend treats as an unsupported-language turn.
 */
const SCRIPT_LANGUAGES: { language: string; regex: RegExp }[] = [
  { language: 'ru', regex: /\p{Script=Cyrillic}/u },
  { language: 'el', regex: /\p{Script=Greek}/u },
  { language: 'ar', regex: /\p{Script=Arabic}/u },
  { language: 'he', regex: /\p{Script=Hebrew}/u },
  { language: 'zh', regex: /\p{Script=Han}/u },
  { language: 'ja', regex: /\p{Script=Hiragana}|\p{Script=Katakana}/u },
  { language: 'ko', regex: /\p{Script=Hangul}/u },
  { language: 'hi', regex: /\p{Script=Devanagari}/u },
];

const STOP_WORDS: Record<string, Set<string>> = {
  en: new Set([
    'the', 'and', 'a', 'an', 'to', 'of', 'in', 'is', 'it', 'that', 'for', 'was', 'with',
    'as', 'on', 'are', 'this', 'at', 'be', 'have', 'has', 'had', 'not', 'but', 'they',
    'we', 'you', 'i', 'my', 'me', 'our', 'from', 'by', 'so', 'if', 'when', 'then',
    'there', 'their', 'would', 'could', 'about', 'because', 'were', 'been', 'do', 'did',
  ]),
  tr: new Set([
    've', 'bir', 'bu', 'için', 'ile', 'da', 'de', 'ne', 'çok', 'daha', 'gibi', 'ama',
    'ben', 'benim', 'biz', 'bizim', 'sen', 'siz', 'o', 'onlar', 'şey', 'olarak', 'olan',
    'var', 'yok', 'ki', 'ise', 'ya', 'her', 'en', 'kadar', 'sonra', 'önce', 'çünkü',
    'ancak', 'veya', 'hem', 'değil', 'oldu', 'olur', 'yapmak', 'ettim', 'ettik', 'bunu',
  ]),
};

export interface LanguageDetection {
  language: string;
  ambiguous: boolean;
}

/**
 * @param text    the turn to classify
 * @param current the interview's language, returned unchanged when the text decides nothing
 */
export function detectLanguage(text: string, current: string): LanguageDetection {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length > 0) {
    for (const { language, regex } of SCRIPT_LANGUAGES) {
      const hits = letters.filter((ch) => regex.test(ch)).length;
      if (hits / letters.length > SCRIPT_MARGIN) return { language, ambiguous: false };
    }
  }

  // Plain toLowerCase, not the tr locale: the Turkish rule maps "I" to "ı", which would
  // hide the English stop-word "i" in every English answer that starts a sentence with it.
  const tokens = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (tokens.length === 0) return { language: current, ambiguous: true };

  let best = { language: current, ratio: 0 };
  for (const [language, words] of Object.entries(STOP_WORDS)) {
    const ratio = tokens.filter((t) => words.has(t)).length / tokens.length;
    if (ratio > best.ratio) best = { language, ratio };
  }

  if (best.ratio >= STOPWORD_MARGIN) return { language: best.language, ambiguous: false };
  return { language: current, ambiguous: true };
}
