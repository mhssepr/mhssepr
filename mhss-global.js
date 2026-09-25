/* MHSS Global UI State
 * dashboard.html is the source of truth for theme + language.
 * Legacy page-specific keys are mirrored automatically so existing pages
 * keep their current UI/translation code without breaking.
 */
(function () {
  'use strict';

  const THEME_KEY = 'mhss:theme';
  const LANG_KEY = 'mhss:language';

  const themeAliases = [
    'mh_theme_pref',
    'mh_theme',
    'mh_begena_theme',
    'mh_equipment_theme',
    'mh_finance_theme',
    'mh_report_theme',
    'mhss-theme'
  ];

  const langAliases = [
    'mh_lang_pref',
    'mh_lang',
    'mh_begena_lang',
    'mh_equipment_lang',
    'mh_finance_lang',
    'mh_report_lang',
    'mhss-lang'
  ];

  let syncing = false;

  function normalizeTheme(value) {
    return value === 'dark' ? 'dark' : 'light';
  }

  function normalizeLang(value) {
    return value === 'am' ? 'am' : 'en';
  }

  function firstStored(keys) {
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value !== null && value !== '') return value;
    }

    return null;
  }

  function mirror(keys, value) {
    for (const key of keys) {
      localStorage.setItem(key, value);
    }
  }

  const initialTheme = normalizeTheme(
    localStorage.getItem(THEME_KEY) ||
    firstStored(themeAliases) ||
    (
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    )
  );

  const initialLang = normalizeLang(
    localStorage.getItem(LANG_KEY) ||
    firstStored(langAliases) ||
    'en'
  );

  localStorage.setItem(THEME_KEY, initialTheme);
  localStorage.setItem(LANG_KEY, initialLang);

  mirror(themeAliases, initialTheme);
  mirror(langAliases, initialLang);

  function applyTheme(theme) {
    const next = normalizeTheme(theme);

    document.documentElement.setAttribute(
      'data-theme',
      next
    );

    document.documentElement.dataset.mhssTheme = next;
    document.documentElement.style.colorScheme = next;
  }

  function applyLanguage(lang) {
    const next = normalizeLang(lang);

    document.documentElement.lang = next;
    document.documentElement.dataset.lang = next;
    document.documentElement.dataset.mhssLanguage = next;

    document.documentElement.classList.toggle(
      'mhss-amharic',
      next === 'am'
    );
  }

  function setGlobalTheme(theme, source) {
    const next = normalizeTheme(theme);
    const previous = normalizeTheme(
      localStorage.getItem(THEME_KEY)
    );

    if (syncing) return;

    syncing = true;

    localStorage.setItem(
      THEME_KEY,
      next
    );

    mirror(
      themeAliases,
      next
    );

    syncing = false;

    applyTheme(next);

    if (previous !== next) {
      window.dispatchEvent(
        new CustomEvent(
          'mhss:theme-change',
          {
            detail: {
              theme: next,
              source: source || 'unknown'
            }
          }
        )
      );
    }
  }

  function setGlobalLanguage(lang, source) {
    const next = normalizeLang(lang);
    const previous = normalizeLang(
      localStorage.getItem(LANG_KEY)
    );

    if (syncing) return;

    syncing = true;

    localStorage.setItem(
      LANG_KEY,
      next
    );

    mirror(
      langAliases,
      next
    );

    syncing = false;

    applyLanguage(next);

    if (previous !== next) {
      window.dispatchEvent(
        new CustomEvent(
          'mhss:language-change',
          {
            detail: {
              language: next,
              source: source || 'unknown'
            }
          }
        )
      );
    }
  }

  /*
   * Keep every existing MHSS page synchronized.
   */
  const originalSetItem = Storage.prototype.setItem;

  Storage.prototype.setItem = function (key, value) {

    if (syncing) {
      return originalSetItem.call(
        this,
        key,
        String(value)
      );
    }

    const stringValue = String(value);

    if (
      key === THEME_KEY ||
      themeAliases.includes(key)
    ) {
      setGlobalTheme(
        stringValue,
        key
      );

      return;
    }

    if (
      key === LANG_KEY ||
      langAliases.includes(key)
    ) {
      setGlobalLanguage(
        stringValue,
        key
      );

      return;
    }

    return originalSetItem.call(
      this,
      key,
      stringValue
    );
  };

  /*
   * Apply immediately.
   */
  applyTheme(initialTheme);
  applyLanguage(initialLang);

  /*
   * Cross-tab synchronization.
   */
  window.addEventListener(
    'storage',
    (event) => {

      if (
        !event.key ||
        event.storageArea !== localStorage
      ) {
        return;
      }

      if (
        event.key === THEME_KEY ||
        themeAliases.includes(event.key)
      ) {

        const next = normalizeTheme(
          event.newValue
        );

        syncing = true;

        localStorage.setItem(
          THEME_KEY,
          next
        );

        mirror(
          themeAliases,
          next
        );

        syncing = false;

        applyTheme(next);

        window.dispatchEvent(
          new CustomEvent(
            'mhss:theme-change',
            {
              detail: {
                theme: next,
                source: 'storage'
              }
            }
          )
        );
      }

      if (
        event.key === LANG_KEY ||
        langAliases.includes(event.key)
      ) {

        const next = normalizeLang(
          event.newValue
        );

        syncing = true;

        localStorage.setItem(
          LANG_KEY,
          next
        );

        mirror(
          langAliases,
          next
        );

        syncing = false;

        applyLanguage(next);

        window.dispatchEvent(
          new CustomEvent(
            'mhss:language-change',
            {
              detail: {
                language: next,
                source: 'storage'
              }
            }
          )
        );
      }
    }
  );

  window.addEventListener(
    'mhss:theme-change',
    (event) => {
      applyTheme(
        event.detail.theme
      );
    }
  );

  /*
   * Existing pages already have their own translation renderers.
   * Reload those pages after a real language change so they rebuild
   * their complete UI in the selected language.
   *
   * Dashboard is excluded because it already translates live.
   */
  window.addEventListener(
    'mhss:language-change',
    (event) => {

      const path =
        (
          location.pathname
            .split('/')
            .pop() || ''
        ).toLowerCase();

      if (path === 'dashboard.html') {
        return;
      }

      if (
        event.detail.source === 'storage'
      ) {
        return;
      }

      if (
        document.readyState === 'loading'
      ) {
        return;
      }

      if (
        !window.__mhssLanguageReloading
      ) {

        window.__mhssLanguageReloading = true;

        location.reload();
      }
    }
  );

  window.MHSSGlobal = Object.freeze({

    getTheme: () =>
      normalizeTheme(
        localStorage.getItem(THEME_KEY)
      ),

    getLanguage: () =>
      normalizeLang(
        localStorage.getItem(LANG_KEY)
      ),

    setTheme: setGlobalTheme,
    setLanguage: setGlobalLanguage,

    themeKey: THEME_KEY,
    languageKey: LANG_KEY
  });

})();