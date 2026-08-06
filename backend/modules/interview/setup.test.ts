/**
 * Occupation title + cluster classification (issue #149). The `occupation` field is the
 * interview's label everywhere, so it must be a readable title in both languages — never a
 * bare keyword, never a mid-word slice — and a Turkish software listing must resolve to a
 * cluster, not fall through to null (which made the admin perOccupation chart blind to the
 * primary market).
 */
import { describe, expect, it } from 'vitest';

import { classify } from './setup';

describe('classify', () => {
  it('titles a Turkish listing from its first line and clusters it', () => {
    const { occupation, clusterKey } = classify(
      'Kıdemli Frontend Geliştirici (React) — Hibrit / İstanbul\n\nEkibimize katılacak, k',
    );
    expect(occupation).toBe('Kıdemli Frontend Geliştirici (React) — Hibrit / İstanbul');
    expect(clusterKey).toBe('software_engineering');
  });

  it('titles an English listing with the job title, not the matched keyword', () => {
    const { occupation, clusterKey } = classify('Senior Software Developer\nWe are hiring...');
    expect(occupation).toBe('Senior Software Developer');
    expect(clusterKey).toBe('software_engineering');
  });

  it('clusters a caps-lock Turkish listing despite Turkish-i casing', () => {
    // "YAZILIM".toLowerCase() is "yazilim" (dotted i) and "GELİŞTİRİCİ" folds through a
    // combining dot — neither matches the dotless-ı keyword without the fold (issue #149 §1).
    expect(classify('YAZILIM GELİŞTİRİCİ ARANIYOR').clusterKey).toBe('software_engineering');
    expect(classify('KIDEMLI YAZILIM MÜHENDİSİ').clusterKey).toBe('software_engineering');
  });

  it('does not fire "veri" on ordinary words that merely contain it', () => {
    // "verilen"/"verimli" must not drag a listing into data_science (issue #149 §4).
    const { clusterKey } = classify('Pazarlama uzmanı: müşterilere verilen sözleri takip eder');
    expect(clusterKey).toBe('marketing');
    expect(classify('Veri Bilimci aranıyor').clusterKey).toBe('data_science');
  });

  it('matches Turkish inflected suffixes via keyword stems', () => {
    // Turkish is suffixing: "Mühendisi"/"Geliştiricisi"/"Tasarımcısı" must match "mühendis*"
    // etc., which a whole-word keyword would miss (issue #149 stem support).
    expect(classify('Kıdemli Makine Mühendisi').clusterKey).toBe('software_engineering'); // §5 known limit, accepted
    expect(classify('Yazılım Geliştiricisi').clusterKey).toBe('software_engineering');
    expect(classify('KIDEMLİ YAZILIM MÜHENDİSİ').clusterKey).toBe('software_engineering');
    expect(classify('Ürün Tasarımcısı').clusterKey).toBe('design');
    expect(classify('Veri Mühendisi').clusterKey).toBe('data_science'); // ordering: data before software
    expect(
      classify('Verilen hedefler doğrultusunda çalışacak satış temsilcisi').clusterKey,
    ).toBe('sales');
  });

  it('does not let a stem over-match a longer unrelated word', () => {
    // The negatives that prove the `*` tolerance is safe: "salesforce" is not "sales*", and
    // "database" is not "data*" (issue #149 §4).
    expect(classify('Salesforce Developer').clusterKey).toBe('software_engineering');
    expect(classify('Database Administrator').clusterKey).not.toBe('data_science');
  });

  it('truncates a very long first line at a word boundary with an ellipsis', () => {
    const long =
      'Kıdemli Frontend ve Backend Yazılım Geliştirici Uzman Mühendis Aranıyor Hibrit İstanbul Ankara';
    const { occupation } = classify(long);
    expect(occupation.endsWith('…')).toBe(true);
    expect(occupation.length).toBeLessThanOrEqual(81); // 80 cap + ellipsis
    expect(occupation).not.toContain('\n');
    // cut at a space, so the last visible token is whole
    expect(occupation.slice(0, -1).endsWith(' ')).toBe(false);
    expect(long.startsWith(occupation.slice(0, -1))).toBe(true);
  });

  it('leaves an unmatched listing uncategorised but still titled', () => {
    const { occupation, clusterKey } = classify('Zamboni Technician\nIce rink maintenance.');
    expect(occupation).toBe('Zamboni Technician');
    expect(clusterKey).toBeNull();
  });

  it('still clusters when the first line is a company header, not a title', () => {
    // Known ceiling: the title is only as good as the first line (a company name here), but a
    // keyword anywhere in the body still resolves the cluster (issue #149 §3).
    const { occupation, clusterKey } = classify(
      'ACME Teknoloji A.Ş.\nKıdemli Backend Yazılım Geliştirici arıyoruz.',
    );
    expect(occupation).toBe('ACME Teknoloji A.Ş.');
    expect(clusterKey).toBe('software_engineering');
  });
});
