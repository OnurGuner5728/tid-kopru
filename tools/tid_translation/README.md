# TİD content authoring

The version 1 bundle format is defined in `content_schema.json`; the Python validator adds cross-record checks that JSON Schema cannot express, including distinct reviewer identities, reviewer-to-approval matching, same-origin media paths, media rights assertions, timing bounds, gloss alignment, and the presence of non-manual timing metadata. Run it from the repository root with:

```powershell
python -m unittest discover -s tests -p test_tid_content.py -v
```

## Current product status

The packaged `pilot-content-0` release currently contains zero reviewed sentences, zero production templates, and zero TİD media assets. The browser can analyze a bounded set of Turkish morphology and connect exact reviewed content to playback, but morphology is not TİD grammar and the analyzer's synthetic tests do not approve a sign-language expression. For example, a test that preserves the second-person feature in `Sen iyisin` does not provide an approved TİD translation for that sentence. Until real content is reviewed and licensed, the UI must return unsupported/text-only and must not play a guessed sign.

The public release gate requires 300 held-out Turkish sentences, balanced for person, negation, questions, time, possession, and inflection. Two fluent TİD reviewers assess each sentence independently; a third adjudicates disagreements. At least 90% semantic acceptance after adjudication is required, along with a licensed video or validated animation for every supported result. Record aggregate evidence in `docs/tid-text-to-sign-evaluation.md`; never create reviewer outcomes or participant records to make a gate appear complete.

## Review record

Use two separate, non-identifying reviewer codes for independent TİD review. Store each reviewer's decision separately and record `independent: true` only when the reviewers assessed the item independently. Do not put reviewer names, contact details, employer details, consent forms, or other identifying information in the public bundle or Git history. Keep the code-to-person mapping and signed review records in access-controlled project storage.

Set `status` to `approved` only after both independent approvals are recorded. If the reviewers disagree, set `disagreement: true` and record an adjudicator code plus the resolution; retain the adjudication evidence in the controlled review archive. Otherwise `adjudication` must be `null`. Test fixtures use synthetic reviewer codes and do not count as expert review.

## Media rights and participant consent

Each media manifest asset must provide a same-origin path under `/assets/tid/`, a SHA-256 digest, a license identifier, a declared redistribution permission, and its duration. This is a content gate assertion, not proof that the asserted rights are valid. Keep the asset source, license text or grant, permitted use, attribution, reviewer sign-off, and any renewal/expiry conditions in the controlled rights inventory. Release owners must verify that evidence before packaging an asset.

Record participant consent, permitted purposes, retention period, withdrawal/deletion route, and the separate authorization for any public signing video in the controlled research record. Never commit to Git names, contact information, consent documents, raw camera or participant video, landmarks, or a participant identity key. Research consent does not automatically permit product distribution. Raw camera/participant recordings are never eligible for the public media manifest or the browser's versioned TİD media cache.

Text-only gloss candidates are non-playable. Imported TULAP sentence descriptions remain candidates until separately reviewed; they are neither a gloss animation nor evidence of TİD acceptance. A passing validator only checks structure and declared gates; qualified reviewers and rights holders determine linguistic correctness and permission.

Do not send live user text, audio, video, or landmarks to hosted AI endpoints. The application does not use NVIDIA's hosted models or contain an API key. Generated gloss suggestions are not production content; they require the same independent TİD review, media licensing, held-out evaluation, and release approval as any other candidate.

## Importing TULAP candidates

The [TULAP Sign Language Corpus record](https://tulap.cmpe.boun.edu.tr/items/4bccab49-30e9-4c94-bdd0-ae5171e074f9/full) lists an Excel workbook named `tid_vs_tr.xlsx`, with Turkish sentences in the first column and TİD sentence descriptions in the second. The record identifies the source license as Apache 2.0 and credits Buse Buz and Tunga Güngör. The workbook is source material for review, not ready-to-play content.

Download the workbook from the record over a valid TLS connection and keep it outside this repository and outside `public/`. Inspect the first worksheet to count the header rows; the importer intentionally has no default and will not guess. Record the downloaded file checksum before importing:

```powershell
Get-FileHash C:\data\tid_vs_tr.xlsx -Algorithm SHA256
python -m tools.tid_translation.import_tulap C:\data\tid_vs_tr.xlsx --header-rows N --output C:\data\tid-candidates.jsonl
```

Replace `N` with the header-row count you inspected. Each output line includes the source row ID, both text fields, source record URL, Apache 2.0 attribution, source-file SHA-256, and `reviewStatus: candidate`. The command refuses destinations under `public/`; it never approves candidates or creates playable entries.

Keep the JSONL export in controlled review storage. Two TİD reviewers should assess each candidate independently, with pseudonymous reviewer codes and separately recorded decisions. A third reviewer resolves disagreement. Keep names, code-to-person mappings, consent records, and private review evidence out of Git. After linguistic review, a separate editor may create a reviewed bundle entry; only then can the content validator accept it, and only licensed media with timing and non-manual metadata can make it playable. Never change a candidate's status directly to approved or copy candidate text into `public/` as if it were animation.
