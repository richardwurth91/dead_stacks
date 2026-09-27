export class LocalizationManager {
  private currentLanguage: string = 'en';
  private translations: Map<string, Map<string, string>> = new Map(); // lang -> (key -> text)

  constructor(defaultLanguage: string = 'en') {
    this.currentLanguage = defaultLanguage;
    this.translations.set(defaultLanguage, new Map());
  }

  setLanguage(language: string): void {
    this.currentLanguage = language;
    if (!this.translations.has(language)) {
      this.translations.set(language, new Map());
    }
  }

  getLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * Ingests a Tab-Separated Values (.tsv) string.
   * First line must be headers: `key\ten\tes\tfr`
   */
  loadFromTsv(tsvContent: string): void {
    const lines = tsvContent.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) return;

    const headers = lines[0].split('\t').map((h) => h.trim().toLowerCase());
    const keyIndex = headers.indexOf('key');
    if (keyIndex === -1) {
      console.warn('[Localization] TSV missing "key" header column');
      return;
    }

    for (let r = 1; r < lines.length; r++) {
      const cols = lines[r].split('\t');
      const key = cols[keyIndex]?.trim();
      if (!key) continue;

      for (let c = 0; c < headers.length; c++) {
        if (c === keyIndex) continue;
        const lang = headers[c];
        const text = cols[c] !== undefined ? cols[c].trim() : '';

        if (!this.translations.has(lang)) {
          this.translations.set(lang, new Map());
        }
        this.translations.get(lang)!.set(key, text);
      }
    }
  }

  /**
   * Ingests a JSON key-value dictionary for a given language.
   */
  loadFromJson(json: Record<string, string>, language: string = this.currentLanguage): void {
    if (!this.translations.has(language)) {
      this.translations.set(language, new Map());
    }
    const map = this.translations.get(language)!;
    for (const [key, value] of Object.entries(json)) {
      map.set(key, value);
    }
  }

  /**
   * Resolves a token to localized text.
   * If key is not found, falls back to fallback parameter or the key itself.
   */
  t(key: string, fallback?: string): string {
    const langMap = this.translations.get(this.currentLanguage);
    if (langMap && langMap.has(key)) {
      const val = langMap.get(key)!;
      if (val.length > 0) return val;
    }

    // Fallback to English if current language missing entry
    if (this.currentLanguage !== 'en') {
      const enMap = this.translations.get('en');
      if (enMap && enMap.has(key)) {
        const val = enMap.get(key)!;
        if (val.length > 0) return val;
      }
    }

    return fallback !== undefined ? fallback : key;
  }

  clear(): void {
    this.translations.clear();
    this.translations.set(this.currentLanguage, new Map());
  }
}

export const globalLocalization = new LocalizationManager();
