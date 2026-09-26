# @townsquare/math

Polis-style opinion math: imputation, PCA by power iteration, k-means (k = 2..5 by silhouette),
representative statements, group-aware consensus and bridging rank.

`src/` is vendored unchanged from [Pocket Polis](https://github.com/mashbean/pocket-polis)
(`src/math/`, commit `7a725cd`, MIT, © 2026 mashbean). See `LICENSE`. The tests in `test/` are
Pocket Polis's own, with import paths adjusted.

Townsquare only adds `src/index.ts`. Results are hashed in `@townsquare/core`, so the same
input produces the same result hash in Node and in the browser.
