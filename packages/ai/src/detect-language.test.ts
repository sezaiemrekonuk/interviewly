import { describe, expect, it } from 'vitest';
import { detectLanguage } from './detect-language';

describe('detectLanguage', () => {
  it('classifies clear English and clear Turkish', () => {
    expect(detectLanguage('I have been working with the team on this for a while now', 'tr')).toEqual(
      { language: 'en', ambiguous: false },
    );
    expect(
      detectLanguage('Bu proje için ekiple birlikte çok daha fazla şey yaptık ve bu bir başarıydı', 'en'),
    ).toEqual({ language: 'tr', ambiguous: false });
  });

  it('keeps the current language and flags ambiguity below the margin', () => {
    // Technical noun soup: no stop-word clears 0.15 in either list.
    expect(detectLanguage('Kubernetes Postgres Redis Docker Kafka Terraform', 'en')).toEqual({
      language: 'en',
      ambiguous: true,
    });
    expect(detectLanguage('', 'tr')).toEqual({ language: 'tr', ambiguous: true });
  });

  it('uses the script histogram before the stop-word lists', () => {
    expect(detectLanguage('Здравствуйте, я работал над этим проектом', 'en')).toEqual({
      language: 'ru',
      ambiguous: false,
    });
  });

  it('is synchronous and pure — there is no call to record', () => {
    expect(detectLanguage('the and of to', 'tr')).not.toBeInstanceOf(Promise);
  });
});
