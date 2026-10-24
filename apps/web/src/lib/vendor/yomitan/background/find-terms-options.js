/*
 * Copyright (C) 2023-2026  Yomitan Authors
 * Copyright (C) 2016-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// chimimouryou: Backend._getTranslatorFindTermsOptions and its helpers from backend.js, as
// functions (the rest of the Backend is extension plumbing).

/**
 * Creates an options object for use with `Translator.findTerms`.
 * @param {import('translator').FindTermsMode} mode The display mode for the dictionary entries.
 * @param {import('api').FindTermsDetails} details Custom info for finding terms.
 * @param {import('settings').ProfileOptions} options The options.
 * @returns {import('translation').FindTermsOptions} An options object.
 */
export function getTranslatorFindTermsOptions(mode, details, options) {
    let {matchType, deinflect, primaryReading} = details;
    if (typeof matchType !== 'string') { matchType = /** @type {import('translation').FindTermsMatchType} */ ('exact'); }
    if (typeof deinflect !== 'boolean') { deinflect = true; }
    if (typeof primaryReading !== 'string') { primaryReading = ''; }
    const enabledDictionaryMap = getTranslatorEnabledDictionaryMap(options);
    const {
        general: {mainDictionary, sortFrequencyDictionary, sortFrequencyDictionaryOrder, language},
        scanning: {alphanumeric},
        translation: {
            textReplacements: textReplacementsOptions,
            searchResolution,
        },
    } = options;
    const textReplacements = getTranslatorTextReplacements(textReplacementsOptions);
    let excludeDictionaryDefinitions = null;
    if (mode === 'merge' && !enabledDictionaryMap.has(mainDictionary)) {
        enabledDictionaryMap.set(mainDictionary, {
            index: enabledDictionaryMap.size,
            alias: mainDictionary,
            allowSecondarySearches: false,
            partsOfSpeechFilter: true,
            useDeinflections: true,
        });
        excludeDictionaryDefinitions = new Set();
        excludeDictionaryDefinitions.add(mainDictionary);
    }
    return {
        matchType,
        deinflect,
        primaryReading,
        mainDictionary,
        sortFrequencyDictionary,
        sortFrequencyDictionaryOrder,
        removeNonJapaneseCharacters: !alphanumeric,
        searchResolution,
        textReplacements,
        enabledDictionaryMap,
        excludeDictionaryDefinitions,
        language,
        useAllFrequencyDictionaries: false,
    };
}

/**
 * @param {import('settings').ProfileOptions} options
 * @returns {Map<string, import('translation').FindTermDictionary>}
 */
export function getTranslatorEnabledDictionaryMap(options) {
    const enabledDictionaryMap = new Map();
    for (const dictionary of options.dictionaries) {
        if (!dictionary.enabled) { continue; }
        const {name, alias, allowSecondarySearches, partsOfSpeechFilter, useDeinflections} = dictionary;
        enabledDictionaryMap.set(name, {
            index: enabledDictionaryMap.size,
            alias,
            allowSecondarySearches,
            partsOfSpeechFilter,
            useDeinflections,
        });
    }
    return enabledDictionaryMap;
}

/**
 * @param {import('settings').TranslationTextReplacementOptions} textReplacementsOptions
 * @returns {(?(import('translation').FindTermsTextReplacement[]))[]}
 */
function getTranslatorTextReplacements(textReplacementsOptions) {
    /** @type {(?(import('translation').FindTermsTextReplacement[]))[]} */
    const textReplacements = [];
    for (const group of textReplacementsOptions.groups) {
        /** @type {import('translation').FindTermsTextReplacement[]} */
        const textReplacementsEntries = [];
        for (const {pattern, ignoreCase, replacement} of group) {
            let patternRegExp;
            try {
                patternRegExp = ignoreCase ?
                    new RegExp(pattern.replace(/['’]/g, "['’]"), 'gi') :
                    new RegExp(pattern, 'g');
            } catch (e) {
                // Invalid pattern
                continue;
            }
            textReplacementsEntries.push({pattern: patternRegExp, replacement});
        }
        if (textReplacementsEntries.length > 0) {
            textReplacements.push(textReplacementsEntries);
        }
    }
    if (textReplacements.length === 0 || textReplacementsOptions.searchOriginal) {
        textReplacements.unshift(null);
    }
    return textReplacements;
}
