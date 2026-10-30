---
description: Price a quote for an account from product codes and quantities, at the account's contract or level price, with each timber line's end use so the treatment is checked.
---

Ask for the account, the job and the lines. Use `npm run merchant -- products` to find codes and `npm run merchant -- end-uses` for the uses. Run `npm run merchant -- quote <account> --lines=CODE:qty:end-use,CODE:qty --job=<job>`. Show the value, the margin and any rule findings; if a line is the wrong treatment, propose the right product. To print it, `npm run docs -- quote`.
