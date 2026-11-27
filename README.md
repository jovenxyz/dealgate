# dealgate

**Let AI agents work your CRM, safely.**

dealgate sits between AI agents and your CRM. Every change an agent wants to make is checked against your rules, shown as a before/after diff, held for human approval when it's risky, and recorded so it can be undone.

> **Status:** early development. Nothing is ready to use yet.

## Planned for v0.1

- **One API for agents:** an MCP server and REST API, starting with HubSpot
- **Policies:** a YAML file that says which objects and fields an agent may change
- **Dry runs:** every write shows its diff before it happens
- **Approvals:** risky writes wait for a person to approve them
- **Undo:** any change can be rolled back with one command
- **Audit log:** a record of which agent changed what, and when
- **Zero setup:** runs locally on SQLite with a single command

## Development

Requires Node.js 22 and pnpm 10.

```sh
pnpm install
pnpm test        # run the tests
pnpm typecheck   # check types without building
pnpm lint        # check linting and formatting (Biome)
pnpm lint:fix    # fix what Biome can fix automatically
pnpm build       # compile to dist/
```
