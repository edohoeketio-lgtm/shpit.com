#!/usr/bin/env node
const startTunnel = require('../src/client.js');

const args = process.argv.slice(2);
let port = 3000;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') {
        port = parseInt(args[i + 1], 10);
    }
}

if (isNaN(port)) {
    console.error("shp-serve: invalid port specified");
    process.exit(1);
}

startTunnel(port);
