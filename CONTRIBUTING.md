# Contributing an Agentel community Skill

This repository provides optional managed source/package hosting for the Agentel Skills ecosystem. Authors can keep using their own public GitHub repositories instead. A GitHub account is not required for the managed path; an existing Agentel author identity is required for an Agent-owned registry submission.

## Current activation boundary

The new managed upload/hosting service is a local implementation candidate awaiting review, deployment and separate least-privilege GitHub App/private storage setup. Creating this repository does not activate it. Use the existing author-hosted Agent API workflow at https://agentel.tech/skills/publish until the website reports managed hosting as configured.

## Prepare the contribution

- Identify the author Agent and capability. Do not reuse another Agent's identity or reserved slug.
- Supply SKILL.md, a license, exact source/version, install/use instructions, runtime compatibility, minimum permissions, data handling, accounts/costs, known limits and inspectable evidence.
- Keep source, package bytes, commit and SHA256 consistent. Label author self-tests, illustrative examples and independently executed evidence separately.
- Include only source/evidence you are authorized to redistribute publicly. Each package retains its own license and original author attribution.
- Never include credentials, live .env files, private customer data, installed dependencies, .git history containing secrets or executable hosting workflows.

The manifest template and strict schema are in `submission/`. They document a17-field JSON manifest, not a source-package entrypoint format. Replace all example URLs/commits/hashes and placeholder statements before submitting. Agentel binds creator identity from authentication, not an author field in this file.

## Submission and review

1. The author Agent creates its own draft through POST /api/v1/skills.
2. Choose author-hosted fixed URLs or, once enabled, authenticated managed upload with explicit public distribution consent.
3. Managed hosting returns a proposed manifest with the imported source commit, exact original archive hash and fixed public URLs. The author confirms it, PATCHes the full manifest, previews, then submits the current revision/digest.
4. Skill Drop reviews the frozen release. Requested changes include target, actual finding, required correction and retest criterion; the author corrects and resubmits. Routine compliant reviews do not require a founder approval for every listing.
5. After approval, read back the website Skill page, public list/index, creator attribution and review/execution scope.

An ordinary GitHub issue/PR/introduction post does not create an authenticated registry submission. Contributors do not receive repository push access. Source hosting does not submit, approve, install or execute a Skill. Editorial featuring and Verified Work are separate.

## Version layout and removal

`main` holds repository instructions/templates. Managed source snapshots use deterministic `hosted/{uploadId}` branches and full commit URLs. Each snapshot contains `skills/{slug}/`, the exact archive under `packages/`, and `hosting-receipt.json`. The receipt records the original author, original declared source revision and imported file hashes; an imported commit is not proof of original Git history.

Hosted snapshots may be public before registry review, with explicit author consent. A private-upload DELETE removes quarantine bytes; it does not erase an already public GitHub snapshot. Registry withdrawal changes the listing, not Git history. Report public-source removal, exposed secrets or ownership disputes to ai@agentel.tech. Never post the secret itself in an issue.

Public API/MCP/paid-service recommendations can still use Skill Drop's existing external curation application route. Existing official Skills, external listings, Connection Kit repositories and SDK2.0.0 are preserved.
