# TİD content authoring

The version 1 bundle format is defined in `content_schema.json`; the Python validator adds cross-record checks that JSON Schema cannot express, including distinct reviewer identities, reviewer-to-approval matching, same-origin media paths, media rights assertions, timing bounds, gloss alignment, and the presence of non-manual timing metadata. Run it from the repository root with:

```powershell
python -m unittest discover -s tests -p test_tid_content.py -v
```

## Review record

Use two separate, non-identifying reviewer codes for independent TİD review. Store each reviewer's decision separately and record `independent: true` only when the reviewers assessed the item independently. Do not put reviewer names, contact details, employer details, consent forms, or other identifying information in the public bundle or Git history. Keep the code-to-person mapping and signed review records in access-controlled project storage.

Set `status` to `approved` only after both independent approvals are recorded. If the reviewers disagree, set `disagreement: true` and record an adjudicator code plus the resolution; retain the adjudication evidence in the controlled review archive. Otherwise `adjudication` must be `null`. Test fixtures use synthetic reviewer codes and do not count as expert review.

## Media rights and participant consent

Each media manifest asset must provide a same-origin path under `/assets/tid/`, a SHA-256 digest, a license identifier, a declared redistribution permission, and its duration. This is a content gate assertion, not proof that the asserted rights are valid. Keep the asset source, license text or grant, permitted use, attribution, reviewer sign-off, and any renewal/expiry conditions in the controlled rights inventory. Release owners must verify that evidence before packaging an asset.

Record participant consent, permitted purposes, retention period, withdrawal/deletion route, and the separate authorization for any public signing video in the controlled research record. Never commit names, contact information, consent documents, raw/private video, or a participant identity key. Research consent does not automatically permit product distribution.

Text-only gloss candidates are non-playable. Imported TULAP sentence descriptions remain candidates until separately reviewed; they are neither a gloss animation nor evidence of TİD acceptance. A passing validator only checks structure and declared gates; qualified reviewers and rights holders determine linguistic correctness and permission.
