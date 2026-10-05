# American English pronunciations

`en_US.txt` is the unmodified General American wordlist from
[open-dict-data/ipa-dict](https://github.com/open-dict-data/ipa-dict), based on
Carnegie Mellon University's pronouncing dictionary via cmudict-ipa, with stress
markers added by ipa-dict. It contains 125,927 entries and may list several
pronunciations for the same spelling.

- Source revision: `44accfb5b0c4c7c146e666c9c7161a5b66e61720`
- Source file: https://raw.githubusercontent.com/open-dict-data/ipa-dict/44accfb5b0c4c7c146e666c9c7161a5b66e61720/data/en_US.txt
- SHA-256: `2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67`
- ipa-dict: MIT, copyright 2016 dohliam (`LICENSE-ipa-dict.txt`)
- cmudict-ipa: MIT, copyright 2016 Lingliang Zhang (`LICENSE-cmudict-ipa.txt`)
- Underlying CMU dictionary: BSD-style license (`LICENSE-cmudict.txt`)

The wordlist is bundled into the main process by Vite's raw-text import. Lookups
never contact a dictionary service and do not add a runtime dependency or API key.
Pronunciations retain the source's broad IPA conventions (including /ɹ/ and /ɫ/).
Only exact entries are used; pronunciations are not composed from stems and suffixes.

This wordlist is the first source, not the only one. A word it lacks is looked up in
macOS Dictionary Services via `src/main/native/dictionary-macos.ts`. This depends on
the user's installed and enabled dictionaries. Compatible NOAD respellings are
converted to IPA by `src/core/noad.ts`; unsupported entries are ignored. Failing both,
`unverifiedPronunciations` may show the model's reading marked as unverified.
This wordlist always wins where it has an entry.
`src/core/pronunciation-usage.ts` adds brief sense/grammar labels for common
homographs such as "read"; these labels reference the existing IPA candidates and
never add or replace pronunciations.

When updating the data, retain its notices, update the revision and checksum here,
and bump `PRONUNCIATION_CACHE_VERSION` in `src/core/pronunciation.ts` to invalidate
contextual choices made against earlier candidates.
