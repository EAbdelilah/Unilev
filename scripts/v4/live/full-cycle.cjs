// Full-cycle live execution driver for Eswap V4.
// Runs the Foundry full-cycle B2B test and streams its trace.
const { spawnSync } = require("child_process");

const args = [
  "test",
  "--offline",
  "--match-path",
  "test/v4/FullCycleB2BTest.t.sol",
  "-vvv"
];

const result = spawnSync("forge", args, {
  stdio: "inherit",
  cwd: process.cwd(),
  shell: true
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
console.log("FULL CYCLE: PASS");
