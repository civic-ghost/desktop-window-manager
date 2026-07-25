// diagnose_cursor_offset.js — standalone, isolated repro of the two
// moveTo() offset failures from mouse.test.js, for comparison between an
// RDP/Enhanced Session connection and Basic Session Mode / a console session
// on rock1 or rock2.
//
// Run from wherever lib/ is reachable one level up, e.g.:
//   node diagnose_cursor_offset.js
//
// Prints the requested target, the actual landed position, and the delta
// for each of the two cases. No test framework, no assertions — just raw
// numbers to compare across sessions.

const mouse = require('../lib/mouse');
const screen = require('../lib/screen');
const { bezierPath } = require('../lib/path/bezier_path');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function reportMove(label, to, options) {
    await mouse.moveTo(to, options);
    await sleep(50);
    const actual = screen.getCursorPosition();
    const dx = actual.x - to.x;
    const dy = actual.y - to.y;
    console.log(`${label}:`);
    console.log(`  requested: (${to.x}, ${to.y})`);
    console.log(`  actual:    (${actual.x}, ${actual.y})`);
    console.log(`  delta:     (${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy})`);
    console.log('');
}

async function main() {
    console.log('=== cursor offset diagnostic ===\n');

    await reportMove('linearPath (default provider) -> (350, 250)', { x: 350, y: 250 });
    await reportMove('bezierPath (custom provider) -> (700, 500)', { x: 700, y: 500 }, { provider: bezierPath });

    console.log('Compare these deltas against the RDP/Enhanced Session run:');
    console.log('  RDP session:   (350,250) -> (358,258)  delta (+8,+8)');
    console.log('                 (700,500) -> (699,499)  delta (-1,-1)');
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exitCode = 1;
});
