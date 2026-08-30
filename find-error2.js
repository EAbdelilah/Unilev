const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

function scanDir(dir) {
    const files = fs.readdirSync(dir);
    for (const f of files) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
            scanDir(full);
        } else if (f.endsWith(".sol")) {
            const content = fs.readFileSync(full, "utf8");
            const matches = content.matchAll(/error\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g);
            for (const m of matches) {
                const name = m[1];
                const params = m[2].split(",").map(p => p.trim().split(" ")[0]).filter(Boolean).join(",");
                const sig = `${name}(${params})`;
                const selector = ethers.id(sig).slice(0, 10);
                if (selector.toLowerCase() === "0xd70354ef".toLowerCase()) {
                    console.log(`FOUND ERROR: ${sig} in ${full}`);
                }
            }
        }
    }
}

scanDir("./src");
scanDir("./lib");
