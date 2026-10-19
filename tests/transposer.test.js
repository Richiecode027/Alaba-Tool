const { test } = require('node:test');
const assert = require('node:assert/strict');
const t = require('../public/transposer.js');

test('transpone acordes mayores', () => {
  assert.equal(t.transposeSong('[G]Te [C]loamos [D]oh', 'G', 'A'), '[A]Te [D]loamos [E]oh');
});

test('tono menor: calcula semitonos con la raíz (Em -> Fm)', () => {
  assert.equal(t.getSemitonesBetween('Em', 'Fm'), 1);
  assert.equal(t.transposeSong('[Em]Oh [Bm]paz [G]gloria', 'Em', 'Fm'), '[Fm]Oh [Cm]paz [G#]gloria');
});

test('tono con bemol (Bb -> C)', () => {
  assert.equal(t.transposeSong('[Bb]uno [F]dos [Gm]tres', 'Bb', 'C'), '[C]uno [G]dos [Am]tres');
});

test('conserva sufijos y transpone el bajo en slash chords', () => {
  assert.equal(t.transposeChord('Cmaj7', 2), 'Dmaj7');
  assert.equal(t.transposeChord('G/B', 2), 'A/C#');
  assert.equal(t.transposeChord('D/F#', -2), 'C/E');
});

test('deja intacto lo que no es acorde', () => {
  assert.equal(t.transposeChord('x', 2), 'x');
  assert.equal(t.transposeChord('N.C.', 2), 'N.C.');
});
