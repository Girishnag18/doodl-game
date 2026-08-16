const assert = require('assert');
const { Room, PHASES, DEFAULT_SETTINGS } = require('../../game/Room');

function run() {
  console.log('Running Room unit tests...');

  // Test 1: custom mode requires enough custom words
  const r1 = new Room('T1', 'host', 'Host');
  r1.settings.wordMode = 'custom';
  r1.settings.wordChoiceCount = 5;
  r1.settings.customWords = ['apple', 'banana', 'cat'];
  let threw = false;
  try {
    r1.validateWordConfig();
  } catch (err) {
    threw = true;
    assert.ok(err.message.includes('You need at least 5 custom words'));
  }
  assert.strictEqual(threw, true, 'validateWordConfig should throw when not enough custom words');

  // Test 2: custom mode passes with enough words
  const r2 = new Room('T2', 'host', 'Host');
  r2.settings.wordMode = 'custom';
  r2.settings.wordChoiceCount = 4;
  r2.settings.customWords = ['Apple', 'Banana', 'Carrot', 'Dragon', 'Eagle'];
  assert.doesNotThrow(() => r2.validateWordConfig(), 'validateWordConfig should not throw with enough custom words');

  // Test 3: buildWordChoices returns exact required number in official mode
  const r3 = new Room('T3', 'host', 'Host');
  r3.settings.wordMode = 'official';
  r3.settings.wordChoiceCount = 4;
  const choices = r3.buildWordChoices();
  assert.strictEqual(choices.length, 4, 'buildWordChoices should select 4 choices when wordChoiceCount=4');

  // Test 4: selecting a word must be from the choices and switch phase
  const r4 = new Room('T4', 'host', 'Host');
  r4.settings.wordMode = 'official';
  r4.settings.wordChoiceCount = 4;
  r4.advanceToNextRound(); // prepares choices
  const first = r4.wordChoices[0].word;
  assert.doesNotThrow(() => r4.selectWord(r4.currentDrawerId || r4.drawerOrder[r4.currentDrawerIndex], first));
  assert.strictEqual(r4.phase, PHASES.DRAWING, 'After selectWord phase should be DRAWING');

  // Test 5: autoSelectWord sets a currentWord when choices exist
  const r5 = new Room('T5', 'host', 'Host');
  r5.settings.wordMode = 'official';
  r5.settings.wordChoiceCount = 4;
  r5.advanceToNextRound();
  r5.autoSelectWord();
  assert.ok(typeof r5.currentWord === 'string' && r5.currentWord.length > 0, 'autoSelectWord should pick a word');
  assert.strictEqual(r5.phase, PHASES.DRAWING, 'After autoSelectWord phase should be DRAWING');

  console.log('All Room unit tests passed.');
}

if (require.main === module) {
  try {
    run();
    process.exit(0);
  } catch (err) {
    console.error('Unit tests failed:', err);
    process.exit(2);
  }
}

module.exports = { run };
