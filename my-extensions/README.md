# My extensions

Personal Pi extensions, backed up here so a fresh machine setup doesn't lose
them. These are **not** auto-loaded from this folder — Pi only auto-loads
extensions from a project's `.pi/extensions/` or the global
`~/.pi/agent/extensions/`.

## Install

Copy (or symlink, to pick up future edits automatically) into the global
extensions directory:

```bash
ln -sf "$(pwd)/my-extensions/compaction-status.ts" ~/.pi/agent/extensions/compaction-status.ts
```

## What's here

- **compaction-status.ts** — adds `Context: used/threshold (%)` and
  `$Min/req: cost` to the footer status line, reusing Pi's own compaction
  settings and cost calculation.
