#!/usr/bin/env node
const startTunnel = require('../src/client.js');

const args = process.argv.slice(2);
let port = null;

if (args.includes('--version') || args.includes('-v')) {
    const pkg = require('../package.json');
    console.log(`v${pkg.version}`);
    process.exit(0);
}

if (args[0] && !args[0].startsWith('-')) {
    port = parseInt(args[0], 10);
} else {
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' || args[i] === '-p') {
            port = parseInt(args[i + 1], 10);
        }
    }
}

if (isNaN(port)) {
    console.error("shp-serve: invalid port specified");
    process.exit(1);
}

startTunnel(port);
