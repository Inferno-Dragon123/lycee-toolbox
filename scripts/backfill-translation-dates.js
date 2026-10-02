// One-time provenance backfill from committed translation changes. No API calls.
// Run with a full Git history; unchanged initial translations keep no timestamp.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const file = 'lycee-chinese-database-final.json';
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') throw new Error('Full Git history required');
const commits = git(['log', '--reverse', '--format=%H %cI', '--', file]).trim().split('\n');
let previous = new Map();
const revisions = new Map();
for (const [position, line] of commits.entries()) {
    const [commit, date] = line.split(' ');
    const cards = JSON.parse(git(['show', `${commit}:${file}`])).cards;
    const next = new Map(cards.map(c => [c.code, c.japaneseText]));
    for (const [code, text] of next) {
        if (position && previous.get(code) !== text) revisions.set(code, { text, date });
    }
    previous = next;
}
const original = fs.readFileSync(file, 'utf8'), db = JSON.parse(original);
let count = 0;
for (const card of db.cards) {
    const revision = revisions.get(card.code);
    if (!card.translatedAt && revision?.text === card.japaneseText) {
        card.translatedAt = new Date(revision.date).toISOString(); count++;
    }
}
if (count) {
    const indent = original.match(/\n([ \t]+)"/)[1];
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    fs.writeFileSync(file, JSON.stringify(db, null, indent).replace(/\n/g, newline) + (original.endsWith('\n') ? newline : ''));
}
console.log(`Backfilled ${count} translation dates from Git; translation text unchanged`);
