'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'castVolumeControl.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function createContext() {
  const removed = [];
  const desktopIcon = { hidden: false, setAttribute() {} };
  const desktopSlider = { hidden: false, value: '0', previousElementSibling: desktopIcon, setAttribute() {} };
  const mobileWrap = { hidden: false, setAttribute() {} };
  const mobileSlider = { value: '0', closest: () => mobileWrap };
  const elements = new Map([
    ['pb-volume', desktopSlider],
    ['pb-mobile-volume', mobileSlider],
  ]);
  let originalVolumeCalls = 0;
  let stateListener = null;

  const player = {
    mode: 'local',
    volume: 0.35,
    _localVolume: 0.35,
    audio: { volume: 0.35 },
    setVolume(level) { originalVolumeCalls += 1; this.volume = level; },
    applyCastState(status) { if (status.volume != null) this.volume = status.volume; },
    async switchToLocal() { this.mode = 'local'; },
    _notifyStateChange() {},
    onStateChange(handler) { stateListener = handler; },
  };
  const playerBar = { render() {}, update() {} };

  const context = {
    console,
    localStorage: { removeItem(key) { removed.push(key); } },
    document: {
      activeElement: null,
      getElementById(id) { return elements.get(id) || null; },
    },
    window: { player, playerBar },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    player,
    playerBar,
    desktopIcon,
    desktopSlider,
    mobileWrap,
    mobileSlider,
    removed,
    getOriginalVolumeCalls: () => originalVolumeCalls,
    emitState: (state) => stateListener?.(state),
  };
}

test('local playback uses full media volume and hides both sliders', () => {
  const fixture = createContext();
  assert.equal(fixture.player.volume, 1);
  assert.equal(fixture.player.audio.volume, 1);
  assert.ok(fixture.removed.includes('podwaffle_volume'));

  fixture.playerBar.update({ mode: 'local', volume: 1 });
  assert.equal(fixture.desktopIcon.hidden, true);
  assert.equal(fixture.desktopSlider.hidden, true);
  assert.equal(fixture.mobileWrap.hidden, true);

  fixture.player.setVolume(0.2);
  assert.equal(fixture.player.volume, 1);
  assert.equal(fixture.getOriginalVolumeCalls(), 0);
});

test('cast playback shows and synchronizes volume controls', () => {
  const fixture = createContext();
  fixture.player.mode = 'cast';
  fixture.player.setVolume(0.42);
  assert.equal(fixture.getOriginalVolumeCalls(), 1);

  fixture.playerBar.update({ mode: 'cast', volume: 0.42 });
  assert.equal(fixture.desktopIcon.hidden, false);
  assert.equal(fixture.desktopSlider.hidden, false);
  assert.equal(fixture.mobileWrap.hidden, false);
  assert.equal(fixture.desktopSlider.value, '42');
  assert.equal(fixture.mobileSlider.value, '42');

  fixture.player.applyCastState({ volume: 1.5 });
  assert.equal(fixture.player.volume, 1);
  fixture.emitState({ mode: 'cast', volume: 0.18 });
  assert.equal(fixture.desktopSlider.value, '18');
});

test('client shell loads the cast volume controller', () => {
  assert.match(indexSource, /js\/castVolumeControl\.js/);
});
