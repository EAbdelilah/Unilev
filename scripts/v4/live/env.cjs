const { ethers } = require('ethers');
const fs = require('fs');

function loadEnv() {
  const txt = fs.readFileSync('.env', 'utf8');
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

module.exports = { loadEnv };
