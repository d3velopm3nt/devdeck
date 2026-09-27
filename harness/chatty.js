// A dev server that will not shut up: 1,000 lines a second, in the same
// shape harness/perf.mjs pushed, so the two runs can be compared.
let seq = 0
setInterval(() => {
  for (let k = 0; k < 50; k++) {
    seq++
    console.log(`GET /api/items/${seq} 200 in ${seq % 90}ms`)
  }
}, 50)
