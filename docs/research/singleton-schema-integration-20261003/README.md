# ADR 0009 publication evidence

Date: 2026-10-03. The recovery remains off by default.

A clean omission of the sole metadata-operation answer currently stops an otherwise
resolved schema request. ADR 0009 permits one deterministic selection only when the
host has a current, complete catalog with exactly one schema operation and the
existing discovery.describe permission allows that exact operation. It performs
the first metadata read through the existing service and evidence barriers. This
does not retry a provider, add permission, or turn a safe stop into a task success.

## Reviewed identity and publication scope

- Base and remote main checked before publication:
  `079a8c9fbc4b51812802e971971b101db682444d`.
- Approved code: `68826edb0a78ba53e91369ac49b72c7d8c447765`;
  tree `14120d10aa5ac7e5603216445438a2105b6ebb09`.
- Independently reviewed evidence:
  `98946ac219c7560287195c90453b34bb33e115cb`.
- Independent review approved the code and evidence with zero findings.

The twelve changed source, test, and architecture/ADR files have the exact reviewed
Git blobs. The entire apps and packages subtrees also match the approved code.
This publication adds only this repository-safe evidence directory to that tree.
Its single commit descends directly from the base; prototype history is excluded.
The ADR's historical status text is preserved with its approved blob; the current
review result is recorded here.

The inventory adapter, permission checks, continuation/CAS owner, router, renderer,
dependencies, workflows, and packaging/security configuration are unchanged.
The trusted option is forwarded only by the existing offline-test installation
path. There is no production enablement, data migration, or deployment here.

## What the experiment establishes

The real Jev parser, request reader/session, registered HTTP metadata service and
local adapter run with scripted fetch responses and frozen synthetic data. Desktop
episodes additionally pass through the real trusted IPC/store path. The bounded
tag accepts an empty answer map in the known envelope only. Malformed responses,
HTTP 200 error/unknown-key envelopes, wrong questions, ambiguity, incomplete
coverage, denied permission, stale identity, and cancellation cannot qualify.

The fixture is a registered field dictionary for OrdersAPI: orderId is a required
string; quantity has unknown type and requiredness. This is saved metadata, with
no claim about remote records, actual provider schemas, or a discovered API.
Injected operation descriptions cannot become instructions or permission.

| Layer | Episodes | Full completions | Noncompletions | Required clarification | Unnecessary clarification |
| --- | ---: | ---: | ---: | ---: | ---: |
| Core | 96 | 5 | 91 | 8 | 0 |
| IPC | 63 | 5 | 58 | 8 | 0 |

The three eligible Korean paraphrases complete 0/3 with the option off and 3/3
with it on, in each layer. Both conditions make the same two scripted evaluations;
the enabled condition performs one first metadata read per eligible request.
The layers repeat scenarios and are not 159 independent language samples.
The 24 existing request-understanding acceptance cases also pass unchanged.

Task completion requires a validated dictionary reply; IPC additionally requires
its persisted reply. Failed reads, invalidated evidence, and CAS conflicts remain
noncompletion even if a service attempt or an earlier valid evidence callback
occurred. No failures are removed from the denominator. A passing safety assertion
is distinct from legitimate task completion. No live gain or semantic-quality
improvement has been measured.

Core uses 177 scripted fetches, 422,037 request bytes, 11 first service attempts and
5 approved-evidence callbacks. IPC uses 114, 276,046, 7 and 6 respectively. One IPC
callback precedes a later CAS conflict and is not a completion. Live provider,
connector, body-read, queue, send and prose-generation calls in this experiment
are zero. Local elapsed times in the raw data are fixture timings only.

## Final local aggregate validation

The publication uses existing dependencies copied into its owned workspace,
without a successful installation or rebuild of native dependencies. The live
Jev test option is explicitly off. Vitest uses its native config loader to avoid
the local sandbox's config-bundler ancestor-read restriction. Tests and production
configuration are unmodified.

| Check | Final result |
| --- | --- |
| Entire Core suite | 2,681 passed; 11 skipped; 484 files passed, 2 skipped |
| Desktop package suite (`electron src`) | 340 passed; 54 files passed |
| Core evaluation | 11 passed; 5 files passed |
| Dependency/security and webhook tests | 8 passed |
| Renderer absent/stale-dist regression | 2 passed |
| Packaging path/isolation tests | 13 passed; 5 platform skips |
| Document engine (existing Python 3.12 interpreter) | 90 passed |
| Core production/test and Desktop type checks | Passed |
| Core and Desktop production builds | Passed |
| Architecture | Passed; 1,338 modules and 5,099 dependencies |

Document-engine results and local CI gaps are recorded in
[aggregate-validation.json](aggregate-validation.json). Remote Linux/Windows CI,
product GUI smoke and Windows packaging are separate checks; these local results
do not imply they passed. OAuth build environment values were removed, and the
build checked that no environment file existed before configuration loading.

Earlier unsuccessful attempts are retained in the aggregate record. Forcing
SQL.js on the entire Core suite yielded six failures (two native-branch assertions
and four fixture data-directory errors); the CI-default backend then passed with
identical source. An initial Desktop import tried Electron's automatic installer
because the owned copy lacked its binary; the download failed under network
restriction. Existing binary files were then copied as regular files into the
owned workspace, without launching Electron. A subsequent overly broad Vitest
invocation incorrectly collected a Node-test file; the package's original
`electron src` scope passed. Two renderer tests first failed on the sandbox's
ancestor-read restriction and passed unchanged with approved unrestricted test
execution. These are recorded as runner failures, not discarded product outcomes.

## Public artifacts and reproducibility

`metrics.json` and the two schema observation files retain every frozen synthetic
episode. The legacy request-understanding observations cover the unchanged 24
case gate. [artifact-manifest.json](artifact-manifest.json) records their SHA-256
hashes and the twelve reviewed source blobs. Folder attributes preserve exact
artifact bytes. Absolute workstation paths, private full runner logs, credentials,
canonical sentinels, unrelated historical billing ledgers and executable outputs
are excluded. Candidate file checks cover machine paths/accounts, credential
tokens and credential-bearing URLs; raw data was also inspected for synthetic
source and request content. This is a bounded publication check, not a repository
security scan.

Run the existing Core and Desktop package tests plus Core evaluation for the
aggregate gates. The focused tests are
`request-understanding.singleton-schema.test.ts` and
`metadata-turns.singleton-schema.test.ts`; their fixture contains the frozen
requests and scripted transport oracle. Provider access remains opt-in and is
not required to reproduce this experiment. Changing the frozen cases, their
oracle, the option's scope or a reviewed source blob requires another review.
