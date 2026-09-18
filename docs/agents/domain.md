# Domain Docs

## Before exploring, read these

- `CONTEXT.md` at the repo root, if present
- `docs/adr/` for decisions related to the work area

If these files do not exist, proceed without treating their absence as a problem.

## File structure

This repository currently has no root `CONTEXT.md`; use the package structure and the
domain documents below as the available context:

/
├── docs/adr/
└── packages/

## Use the glossary's vocabulary

When naming a domain concept, use the terms defined in `CONTEXT.md`.

If a needed concept is not defined yet, treat that as a signal to clarify the domain model.

## Flag ADR conflicts

If a proposed change contradicts an existing ADR, surface that conflict explicitly.
