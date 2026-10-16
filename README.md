# Agentel Community Skills

Community-authored Agent Skills with inspectable source, fixed package bytes, attribution, licenses and evidence. Managed by Agentel at https://agentel.tech.

## Status

This public repository has been prepared for optional Agentel managed hosting. The website upload/hosting increment is under local acceptance and review; it is not deployed or activated by creating this repository. No community package has been automatically imported or approved here.

## Two author paths

- **Your own public GitHub or fixed HTTPS host:** keep your source and releases where they are. Submit the exact source commit, source URL, package URL, SHA256 and disclosures through your own Agentel identity. Public URL submission does not require connecting a GitHub account to Agentel.
- **Optional Agentel managed hosting:** once the service is deployed and configured, an authenticated author can provide a gzip-compressed ustar source package and explicitly consent to public redistribution under its declared license. The platform hosting service generates fixed GitHub source/package links. The author confirms the resulting manifest, previews and submits it for Skill Drop review.

Start with https://agentel.tech/skills/publish and the deployed documentation. SDK 2.0.0 remains supported through direct REST requests; no SDK upgrade is required for the publishing protocol.

## Hosting and review are separate

A hosted package is not an approved registry listing, an editorial recommendation, Verified Work or an execution guarantee. Authors remain credited as authors; Agentel is the hosting provider. Each package retains its own license. There is no blanket relicensing of contributed source.

The planned hosting layout uses deterministic per-upload `hosted/{uploadId}` branches, fixed commit URLs, `skills/{slug}/` source, exact `packages/` archives and `hosting-receipt.json`. The receipt records the original author, package digest, original declared source revision and imported source-file hashes. The hosting commit identifies the imported snapshot; it does not establish the author's original Git history. These branches do not modify main or install workflows from uploaded packages.

Authors must understand that hosted snapshots can be publicly accessible before registry review. Registry draft records remain private, while source/package URLs explicitly chosen for public distribution remain public. Removing a private upload or withdrawing a registry listing does not erase an already public GitHub snapshot; contact Agentel Ops for source-removal incidents.

## Package requirements

The candidate ingestion contract accepts `.tar.gz`/`.tgz` in ustar format: up to 2MiB compressed, 8MiB expanded, 64 regular files, 512KiB per file and 8 binary files. Include SKILL.md with matching name/description frontmatter and a nonempty LICENSE. Include actual usage instructions, permissions, data handling, limits and shareable test evidence.

Do not include credentials, live environment files, private customer data, `.git`, `.github`, installed dependencies, links, devices, path traversal or duplicate paths. Ingestion checks package structure and common secret patterns without executing the package; automated scanning cannot guarantee absence of secrets. Skill Drop reviews the exact frozen manifest and separately discloses execution coverage.

## Contribution and operations

Use an existing Agentel author identity. A GitHub PR alone does not create a credential-bound Skill submission. Ordinary contributors are not given write access to this repository. A separate least-privilege hosting App will be limited to this selected repository; Skill Drop's reviewer key has no repository-write permission. Runtime activation, App installation and key provisioning remain separate operator steps.

Preserve existing official Skills, external curated Skills, the Applied AI Source Receipt Checker 0.2.1 release and the existing Connection Kit repositories. This repository is not another SDK.

Questions or removal reports: ai@agentel.tech.
