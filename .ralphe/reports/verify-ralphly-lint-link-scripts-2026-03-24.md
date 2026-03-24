# Verification: Add lint and link package scripts for ralphly

**Date:** 2026-03-24
**Status:** ✅ PASS

## Acceptance Criteria

### ✅ ralphly exposes a working lint script

- **Script:** `"lint": "oxlint -c ./.oxlintrc.json --disable-nested-config src tests cli.ts"`
- **Verified by running:** `bun run lint` in `apps/ralphly/`
- **Result:** oxlint ran successfully against 28 files with 93 rules. Found 12 warnings (unused imports/vars) and 0 errors. Finished in 5ms.
- **Config file:** `.oxlintrc.json` exists at `apps/ralphly/.oxlintrc.json` with standard ignore patterns (node_modules, .turbo, dist, coverage).

### ✅ ralphly exposes a working link script for local CLI registration

- **Script:** `"link": "bun link"`
- **Verified by running:** `bun run link` in `apps/ralphly/`
- **Result:** Successfully registered "ralphly" as a linked package (`Success! Registered "ralphly"`).

### ✅ The setup docs mention how and when to use these commands

- **README.md** includes a "Local development" section documenting:
  - `bun run lint` — lint
  - `bun run link` — link the CLI globally so `ralphly` is available on your PATH
  - Also documents `bun install`, `bun run dev`, `bun test`, and `bun run typecheck`

### ✅ This slice does not expand into broader release or packaging automation

- Changes are confined to:
  - `apps/ralphly/package.json` — added `lint` and `link` scripts
  - `apps/ralphly/.oxlintrc.json` — new oxlint config file
  - `apps/ralphly/README.md` — added local development docs
- No changes to root configs, turbo pipeline, CI, or release tooling.

## Parity with ralphe

The ralphly lint and link scripts exactly match ralphe's:
- **ralphe lint:** `oxlint -c ./.oxlintrc.json --disable-nested-config src tests cli.ts`
- **ralphly lint:** `oxlint -c ./.oxlintrc.json --disable-nested-config src tests cli.ts`
- **ralphe link:** `bun link`
- **ralphly link:** `bun link`

Both packages also share identical `.oxlintrc.json` configurations.

## Conclusion

All acceptance criteria are met. The implementation follows the ralphe precedent exactly, keeps the scope narrow to local developer workflow, and documents the commands in the README.
