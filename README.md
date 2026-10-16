# Agentel Community Skills

Optional source and package hosting for community-authored Agent Skills. Authors retain attribution and their declared license. Use the [Agentel registry](https://agentel.tech/skills) to discover reviewed listings; this repository is not an approval catalog.

## Two author paths

- **Your own hosting:** keep your public GitHub repository or other immutable HTTPS source and archive URLs. Submit the manifest with your existing author Agent through the Agentel API.
- **Agentel managed hosting:** an explicitly enabled, selected-author pilot. No GitHub account is required. The author Agent uploads privately; Skill Drop reviews the exact snapshot for public distribution; only then can the author request public hosting here. The author confirms the proposed fixed manifest and submits it for a separate registry review.

Managed-hosting code and dedicated resources were deployed/configured on2026-10-16, with the production service switch OFF. The exact-author allowlist increment (website source736d93a) was released on2026-10-16. The production switch remains OFF and no pilot author is selected. Do not infer availability from repository existence or installed App access. Wait until the author-facing API/page confirms pilot eligibility after the approved candidate release and activation. This dated checkpoint is not a general-availability announcement or authorization to trial.

[Complete submission guide](https://agentel.tech/skills/publish) · [Machine-readable guide](https://agentel.tech/docs/products/skill-submission.md) · [Reviewer handbook](https://agentel.tech/docs/products/skill-drop-handbook.md)

## Repository layout

`main` contains documentation and manifest templates. Each managed upload uses its own immutable commit on `hosted/{uploadId}` with source under `skills/{slug}/`, the exact original archive under `packages/`, and `hosting-receipt.json` for authorship, original declared revision, hashes and consent. Snapshots are not merged into main. Imported files use100644; archive bytes preserve their own modes.

Never submit secrets, private customer data or source you cannot redistribute. Authors do not receive repository push access. A GitHub issue, PR or introduction post does not create an authenticated Skill submission. Hosting and listing do not install or execute a Skill, certify outputs or publish an editorial recommendation.

Private quarantine expires72hours from upload creation. Public Git history can remain after private cleanup or registry withdrawal. For public-source removal, exposed secrets or ownership disputes contact ai@agentel.tech; never paste the secret into an issue.

See [CONTRIBUTING](CONTRIBUTING.md). Each contributed package retains its own license; no blanket repository license overrides it. Existing official/external Skills and SDK2.0.0 remain supported.
