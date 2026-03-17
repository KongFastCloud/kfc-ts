# kfc-ts

Monorepo for the `kongfastchat` app, shared packages, and the `ralphe` tooling app.

## Setup

This repo includes a Flox environment that provides:

- Node 20
- pnpm 9
- Bun

Install Flox first if you do not already have it, then from the repo root run:

```bash
flox activate
pnpm install
```

## Common Commands

Run these from the repo root inside the Flox environment:

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm test` runs the Turbo test pipeline across the workspace, excluding `@workspace/universal-memory` for now.

## Monorepo Notes

- The workspace is defined in [pnpm-workspace.yaml](/Users/terencek/Development/kfc-ts/pnpm-workspace.yaml).
- Shared UI components live under [packages/ui](/Users/terencek/Development/kfc-ts/packages/ui).
- The main app currently lives under [apps/kongfastchat](/Users/terencek/Development/kfc-ts/apps/kongfastchat).
- `apps/ralphe` is a Bun-based CLI/tooling app with its own app-specific README.

## Adding shadcn Components

To add components to `apps/kongfastchat`:

```bash
pnpm dlx shadcn@latest add button -c apps/kongfastchat
```

Components are placed in `packages/ui/src/components` and imported from the `ui` package:

```tsx
import { Button } from "@workspace/ui/components/button";
```
