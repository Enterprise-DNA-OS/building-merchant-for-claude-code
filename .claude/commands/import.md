---
description: Bring customers or products across from an Epicor BisTrack export (a grid or report saved as CSV).
---

Read docs/replace-bistrack.md. Check the file's columns against the accepted names. Add any branches and price levels the file uses first. Run `npm run merchant -- import bistrack-customers --file=imports/<file>.csv --dry-run` (or `bistrack-products`), show the counts, then repeat without --dry-run. A code that already exists stops the whole file.
