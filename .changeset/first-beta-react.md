---
"weft-react": patch
---

- `weft-core` is a caret peer range, where it used to pack as an exact version pin.
- Each module format has its own type declarations, so a CommonJS project under `node16` resolution type-checks.
