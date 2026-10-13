'use strict';

/**
 * FocusStation — Distraction-Free Audio Workstation
 * Application Controller & Audio Engine Architecture
 * Light Studio Theme Edition
 */

// ════════════════════════════════════════════════════════════════
// GLOBAL CONSTANTS
// ════════════════════════════════════════════════════════════════
const STORE = {
  FAV: 'fs_favorites',
  RECENT: 'fs_recent',
  PREFS: 'fs_prefs'
};
const RECENT_LIMIT = 12;
const FADE_STEPS = 60;
const FADE_DURATION_MS = 5000;


// ════════════════════════════════════════════════════════════════
// 1. StorageController — Safe LocalStorage Wrapper
// ════════════════════════════════════════════════════════════════
const StorageController = {
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) {
        if (key === STORE.FAV || key === STORE.RECENT) return [];
        if (key === STORE.PREFS) return {};
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      if (key === STORE.FAV || key === STORE.RECENT) return [];
      if (key === STORE.PREFS) return {};
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('FocusStation storage write error for key:', key, err);
    }
  },

  getFavorites() {
    const favs = this.get(STORE.FAV);
    return Array.isArray(favs) ? favs : [];
  },

  isFavorite(id) {
    return this.getFavorites().includes(id);
  },

  addFavorite(id) {
    const favs = this.getFavorites();
    if (!favs.includes(id)) {
      favs.unshift(id);
      this.set(STORE.FAV, favs);
    }
  },

  removeFavorite(id) {
    const favs = this.getFavorites().filter(item => item !== id);
    this.set(STORE.FAV, favs);
  },

  toggleFavorite(id) {
    if (this.isFavorite(id)) {
      this.removeFavorite(id);
      return false;
    } else {
      this.addFavorite(id);
      return true;
    }
  },

  getRecent() {
    const recents = this.get(STORE.RECENT);
    return Array.isArray(recents) ? recents : [];
  },

  addToRecent(track) {
    if (!track || !track.id) return;
    const recents = this.getRecent().filter(t => t.id !== track.id);
    recents.unshift({
      id: track.id,
      youtube_id: track.youtube_id,
      title: track.title,
      artist: track.artist,
      category_id: track.category_id,
      duration: track.duration
    });
    this.set(STORE.RECENT, recents.slice(0, RECENT_LIMIT));
  },

  clearRecent() {
    this.set(STORE.RECENT, []);
  },

  getPrefs() {
    const defaults = {
      volume: 80,
      noiseVolume: 30,
      noiseType: 'brown',
      loopState: 'category',
      shuffleOn: false
    };
    const saved = this.get(STORE.PREFS);
    return Object.assign({}, defaults, saved && typeof saved === 'object' ? saved : {});
  },

  setPref(key, val) {
    const prefs = this.getPrefs();
    prefs[key] = val;
    this.set(STORE.PREFS, prefs);
  }
};


// ════════════════════════════════════════════════════════════════
// 2. WebAudioEngine — Procedural Noise & Chime Generator
// ════════════════════════════════════════════════════════════════
const WebAudioEngine = {
  ctx: null,
  gainNode: null,
  bufferSource: null,
  isPlaying: false,
  noiseType: 'brown', // 'brown' | 'pink'
  currentVolume: 30,

  init() {
    if (this.ctx) return true;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.ctx.destination);
      return true;
    } catch (e) {
      console.error('WebAudioEngine: AudioContext initialization failed', e);
      return false;
    }
  },

  _generateBrownNoiseBuffer() {
    const sampleRate = this.ctx.sampleRate;
    const bufferSize = sampleRate * 4;
    const buffer = this.ctx.createBuffer(2, bufferSize, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02;
        data[i] = lastOut * 3.5;
      }
    }
    return buffer;
  },

  /**
   * Paul Kellet's filtered white noise algorithm for pink noise synthesis
   */
  _generatePinkNoiseBuffer() {
    const sampleRate = this.ctx.sampleRate;
    const bufferSize = sampleRate * 4;
    const buffer = this.ctx.createBuffer(2, bufferSize, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let b0 = 0.0, b1 = 0.0, b2 = 0.0, b3 = 0.0, b4 = 0.0, b5 = 0.0, b6 = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data[i] = pink * 0.11;
      }
    }
    return buffer;
  },

  start(volume) {
    if (!this.ctx) {
      const ready = this.init();
      if (!ready) return;
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.stop();

    this.currentVolume = typeof volume === 'number' ? volume : this.currentVolume;
    this.bufferSource = this.ctx.createBufferSource();
    this.bufferSource.buffer = this.noiseType === 'pink'
      ? this._generatePinkNoiseBuffer()
      : this._generateBrownNoiseBuffer();
    this.bufferSource.loop = true;
    this.bufferSource.connect(this.gainNode);

    const targetGain = (this.currentVolume / 100) * 0.3;
    this.gainNode.gain.setValueAtTime(targetGain, this.ctx.currentTime);

    this.bufferSource.start(0);
    this.isPlaying = true;
  },

  stop() {
    if (this.bufferSource) {
      try {
        this.bufferSource.stop();
      } catch (err) {}
      try {
        this.bufferSource.disconnect();
      } catch (err) {}
      this.bufferSource = null;
    }
    this.isPlaying = false;
  },

  setVolume(vol) {
    this.currentVolume = vol;
    if (this.gainNode && this.ctx) {
      const targetGain = (vol / 100) * 0.3;
      this.gainNode.gain.setValueAtTime(targetGain, this.ctx.currentTime);
    }
  },

  setNoiseType(type) {
    this.noiseType = type === 'pink' ? 'pink' : 'brown';
    StorageController.setPref('noiseType', this.noiseType);
    if (this.isPlaying) {
      this.start(this.currentVolume);
    }
  },

  toggleNoiseType() {
    const nextType = this.noiseType === 'brown' ? 'pink' : 'brown';
    this.setNoiseType(nextType);
    return nextType;
  },

  toggle(volume) {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.start(volume);
    }
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  /**
   * Gentle 2-tone Solfeggio bell chime (528 Hz fading to 396 Hz over 1.8s)
   */
  playCompletionChime() {
    if (!this.ctx) {
      const ready = this.init();
      if (!ready) return;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const now = this.ctx.currentTime;

    // Tone 1: 528 Hz (Miracle / Transformation sine chime)
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(528, now);
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.24, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start(now);
    osc1.stop(now + 1.25);

    // Tone 2: 396 Hz (Harmonic grounding tone, begins at +0.35s)
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(396, now + 0.35);
    gain2.gain.setValueAtTime(0.0001, now + 0.35);
    gain2.gain.exponentialRampToValueAtTime(0.20, now + 0.39);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start(now + 0.35);
    osc2.stop(now + 1.85);
  }
};


// ════════════════════════════════════════════════════════════════
// 3. FocusTimer — Ultradian Timer
// ════════════════════════════════════════════════════════════════
const FocusTimer = {
  totalSeconds: 5400,
  remainingSeconds: 5400,
  intervalId: null,
  isRunning: false,
  preset: 90,
  onCompleteCb: null,

  init() {
    this.preset = 90;
    this.totalSeconds = 90 * 60;
    this.remainingSeconds = this.totalSeconds;
    this.updateDisplay();
  },

  setPreset(minutes) {
    this.preset = minutes;
    this.totalSeconds = minutes * 60;
    this.reset();
  },

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const tPlayIcon = document.getElementById('t-play-icon');
    const tPauseIcon = document.getElementById('t-pause-icon');
    const timerPlayBtn = document.getElementById('timer-play-btn');

    if (tPlayIcon) tPlayIcon.style.display = 'none';
    if (tPauseIcon) tPauseIcon.style.display = 'block';
    if (timerPlayBtn) timerPlayBtn.setAttribute('aria-label', 'Pause timer');

    const mtPlay = document.getElementById('m-t-play-icon');
    const mtPause = document.getElementById('m-t-pause-icon');
    if (mtPlay) mtPlay.style.display = 'none';
    if (mtPause) mtPause.style.display = 'block';

    this.updateDisplay();

    this.intervalId = setInterval(() => {
      this.remainingSeconds--;
      this.updateDisplay();
      if (this.remainingSeconds <= 0) {
        this._complete();
      }
    }, 1000);
  },

  pause() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;

    const tPlayIcon = document.getElementById('t-play-icon');
    const tPauseIcon = document.getElementById('t-pause-icon');
    const timerPlayBtn = document.getElementById('timer-play-btn');

    if (tPlayIcon) tPlayIcon.style.display = 'block';
    if (tPauseIcon) tPauseIcon.style.display = 'none';
    if (timerPlayBtn) timerPlayBtn.setAttribute('aria-label', 'Start timer');

    const mtPlay = document.getElementById('m-t-play-icon');
    const mtPause = document.getElementById('m-t-pause-icon');
    if (mtPlay) mtPlay.style.display = 'block';
    if (mtPause) mtPause.style.display = 'none';

    this.updateDisplay();
  },

  togglePlayPause() {
    if (this.isRunning) {
      this.pause();
    } else {
      this.start();
    }
  },

  reset() {
    this.pause();
    this.remainingSeconds = this.totalSeconds;
    this.updateDisplay();
  },

  _complete() {
    this.pause();
    PlayerEngine.fadeOutAndPause(FADE_DURATION_MS, () => {
      WebAudioEngine.playCompletionChime();
    });
    UIController.showTimerDone();
    this.updateDisplay();
    if (typeof this.onCompleteCb === 'function') {
      this.onCompleteCb();
    }
  },

  updateDisplay() {
    const m = Math.floor(Math.max(0, this.remainingSeconds) / 60);
    const s = Math.max(0, this.remainingSeconds) % 60;
    const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    const badgeTime = document.getElementById('timer-badge-time');
    const zenTime = document.getElementById('zen-timer-display');
    const badgeStatus = document.getElementById('timer-badge-status');
    const badge = document.getElementById('timer-badge');

    if (badgeTime) badgeTime.textContent = timeStr;
    if (zenTime) zenTime.textContent = timeStr;
    if (badgeStatus) badgeStatus.textContent = this.isRunning ? 'Running' : 'Ready';
    if (badge) badge.classList.toggle('is-running', this.isRunning);

    // Sync mobile preset selector
    const mPreset = document.getElementById('m-timer-preset');
    if (mPreset && String(mPreset.value) !== String(this.preset)) {
      mPreset.value = String(this.preset);
    }
    const dPreset = document.getElementById('timer-preset');
    if (dPreset && String(dPreset.value) !== String(this.preset)) {
      dPreset.value = String(this.preset);
    }

    const timerDoneOverlay = document.getElementById('timer-done-overlay');
    if (timerDoneOverlay && timerDoneOverlay.getAttribute('aria-hidden') === 'false' && this.remainingSeconds > 0) {
      UIController.hideTimerDone();
    }
  },

  onComplete(cb) {
    this.onCompleteCb = cb;
  }
};


// ════════════════════════════════════════════════════════════════
// 4. PlayerEngine — YouTube IFrame API Wrapper
// ════════════════════════════════════════════════════════════════
const PlayerEngine = {
  player: null,
  currentTrack: null,
  pendingTrackId: null,
  queue: [],
  queueIndex: 0,
  originalQueue: [],
  shuffleOn: false,
  loopState: 'category',
  isPlaying: false,
  seekSyncInterval: null,
  volumeBeforeFade: 80,

  init() {
    if (!window.YT || !window.YT.Player) return;

    this.player = new window.YT.Player('youtube-player', {
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0,
        controls: 0,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        fs: 0,
        disablekb: 1,
        enablejsapi: 1,
        origin: window.location.origin || '*'
      },
      events: {
        onReady: (e) => this._onReady(e),
        onStateChange: (e) => this._onStateChange(e),
        onError: (e) => this._onError(e)
      }
    });
  },

  _onReady(event) {
    this.player = event.target;
    const prefs = StorageController.getPrefs();

    if (typeof prefs.volume === 'number') {
      this.player.setVolume(prefs.volume);
    }
    if (prefs.loopState) {
      this.setLoop(prefs.loopState);
    }
    if (typeof prefs.shuffleOn === 'boolean') {
      this.shuffleOn = prefs.shuffleOn;
      UIController.updateShuffleBtn(this.shuffleOn);
    }

    // Startup Race Condition Resolution:
    if (this.pendingTrackId) {
      const trackId = this.pendingTrackId;
      this.pendingTrackId = null;
      this.loadTrack(trackId);
      if (UIController._unlocked) {
        this.play();
      }
    }

    UIController.onPlayerReady();
  },

  _onStateChange(event) {
    // YouTube PlayerState: UNSTARTED=-1, ENDED=0, PLAYING=1, PAUSED=2, BUFFERING=3, CUED=5
    switch (event.data) {
      case 1:
        this._onPlaying();
        break;
      case 2:
        this._onPaused();
        break;
      case 0:
        this._onEnded();
        break;
      default:
        break;
    }
  },

  /**
   * Card-Click Auto-Skip Bug Fix:
   * Do NOT automatically call this.playNext() on error.
   * Pause cleanly and notify user.
   */
  _onError(event) {
    console.warn('FocusStation: YouTube Player Error Code', event.data);
    this.isPlaying = false;
    UIController.setPlayState(false);
    this.stopSeekSync();
    UIController.showToast('This track cannot be embedded. Please choose another.');
  },

  _onPlaying() {
    this.isPlaying = true;
    UIController.setPlayState(true);
    this.startSeekSync();
  },

  _onPaused() {
    this.isPlaying = false;
    UIController.setPlayState(false);
    this.stopSeekSync();
  },

  _onEnded() {
    switch (this.loopState) {
      case 'single':
        if (this.player && typeof this.player.seekTo === 'function') {
          this.player.seekTo(0, true);
          this.player.playVideo();
        }
        break;
      case 'category':
        this.playNext();
        break;
      case 'off':
        this.isPlaying = false;
        UIController.setPlayState(false);
        break;
      default:
        this.playNext();
        break;
    }
  },

  buildQueue(categoryId) {
    if (!window.FOCUS_CATALOG || !Array.isArray(window.FOCUS_CATALOG.tracks)) {
      this.originalQueue = [];
      this.queue = [];
      this.queueIndex = 0;
      return;
    }

    this.originalQueue = window.FOCUS_CATALOG.tracks.filter(t => t.category_id === categoryId);
    this.queue = [...this.originalQueue];

    if (this.shuffleOn) {
      this._fisherYates(this.queue);
    }
    this.queueIndex = 0;
  },

  _fisherYates(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
    return arr;
  },

  /**
   * Direct, robust track loading with queue preservation
   */
  loadTrack(trackId) {
    if (!window.FOCUS_CATALOG || !Array.isArray(window.FOCUS_CATALOG.tracks)) return;
    const track = window.FOCUS_CATALOG.tracks.find(t => t.id === trackId);
    if (!track) return;

    // Guard if player is not yet instantiated
    if (!this.player || typeof this.player.loadVideoById !== 'function') {
      this.pendingTrackId = trackId;
      this.currentTrack = track;
      UIController.updateDockTrack(track);
      StorageController.addToRecent(track);
      UIController.renderShelves();
      return;
    }

    const currentCat = this.queue.length > 0 ? this.queue[0].category_id : null;
    if (this.queue.length === 0 || track.category_id !== currentCat) {
      this.buildQueue(track.category_id);
    }

    // Direct index mapping — no inadvertent reshuffling
    let index = this.queue.findIndex(t => t.id === track.id);
    if (index === -1) {
      this.queue.unshift(track);
      index = 0;
    }
    this.queueIndex = index;
    this._playTrack(track);
  },

  _playTrack(track) {
    this.currentTrack = track;
    if (this.player && typeof this.player.loadVideoById === 'function') {
      this.player.loadVideoById(track.youtube_id);
    }
    UIController.updateDockTrack(track);
    StorageController.addToRecent(track);
    UIController.renderShelves();
  },

  play() {
    if (this.player && typeof this.player.playVideo === 'function') {
      this.player.playVideo();
    }
  },

  pause() {
    if (this.player && typeof this.player.pauseVideo === 'function') {
      this.player.pauseVideo();
    }
  },

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  },

  playNext() {
    if (this.queue.length === 0) return;

    if (this.queueIndex + 1 < this.queue.length) {
      this.queueIndex++;
    } else {
      if (this.loopState === 'off') {
        this.pause();
        return;
      }
      this.queueIndex = 0;
    }

    const nextTrack = this.queue[this.queueIndex];
    if (nextTrack) {
      this._playTrack(nextTrack);
    }
  },

  playPrev() {
    if (this.getCurrentTime() > 3) {
      this.seekTo(0);
      return;
    }

    if (this.queue.length === 0) return;

    if (this.queueIndex > 0) {
      this.queueIndex--;
    } else {
      this.queueIndex = this.queue.length - 1;
    }

    const prevTrack = this.queue[this.queueIndex];
    if (prevTrack) {
      this._playTrack(prevTrack);
    }
  },

  seekTo(seconds) {
    if (this.player && typeof this.player.seekTo === 'function') {
      this.player.seekTo(seconds, true);
    }
  },

  seekByFraction(frac) {
    const dur = this.getDuration();
    this.seekTo(frac * dur);
  },

  setVolume(vol) {
    if (this.player && typeof this.player.setVolume === 'function') {
      this.player.setVolume(vol);
    }
    StorageController.setPref('volume', vol);
  },

  mute(state) {
    if (this.player) {
      if (state && typeof this.player.mute === 'function') {
        this.player.mute();
      } else if (!state && typeof this.player.unMute === 'function') {
        this.player.unMute();
      }
    }
  },

  getCurrentTime() {
    if (this.player && typeof this.player.getCurrentTime === 'function') {
      return this.player.getCurrentTime() || 0;
    }
    return 0;
  },

  getDuration() {
    if (this.player && typeof this.player.getDuration === 'function') {
      return this.player.getDuration() || 0;
    }
    return 0;
  },

  setLoop(state) {
    this.loopState = state;
    UIController.updateLoopBtn(state);
    StorageController.setPref('loopState', state);
  },

  cycleLoop() {
    const states = ['category', 'single', 'off'];
    const idx = states.indexOf(this.loopState);
    const nextState = states[(idx + 1) % states.length];
    this.setLoop(nextState);
    const names = { category: 'Loop: Category', single: 'Loop: Single', off: 'Loop: Off' };
    UIController.showToast(names[nextState]);
  },

  toggleShuffle() {
    this.shuffleOn = !this.shuffleOn;
    if (this.shuffleOn) {
      this._fisherYates(this.queue);
      if (this.currentTrack) {
        const curIdx = this.queue.findIndex(t => t.id === this.currentTrack.id);
        if (curIdx >= 0) {
          this.queueIndex = curIdx;
        }
      }
    } else {
      this.queue = [...this.originalQueue];
      if (this.currentTrack) {
        const curIdx = this.queue.findIndex(t => t.id === this.currentTrack.id);
        if (curIdx >= 0) {
          this.queueIndex = curIdx;
        }
      }
    }
    StorageController.setPref('shuffleOn', this.shuffleOn);
    UIController.updateShuffleBtn(this.shuffleOn);
    UIController.showToast(this.shuffleOn ? 'Shuffle enabled' : 'Shuffle disabled');
  },

  startSeekSync() {
    this.stopSeekSync();
    this.seekSyncInterval = setInterval(() => {
      UIController.updateSeekbar(this.getCurrentTime(), this.getDuration());
    }, 500);
  },

  stopSeekSync() {
    if (this.seekSyncInterval) {
      clearInterval(this.seekSyncInterval);
      this.seekSyncInterval = null;
    }
  },

  fadeOutAndPause(durationMs, callback) {
    if (!this.player || !this.isPlaying) {
      if (typeof callback === 'function') callback();
      return;
    }

    const initialVol = typeof this.player.getVolume === 'function' ? this.player.getVolume() : 80;
    this.volumeBeforeFade = initialVol;

    const stepInterval = durationMs / FADE_STEPS;
    let currentStep = 0;

    const fadeTimer = setInterval(() => {
      currentStep++;
      const currentVol = Math.max(0, initialVol * (1 - currentStep / FADE_STEPS));
      if (this.player && typeof this.player.setVolume === 'function') {
        this.player.setVolume(currentVol);
      }

      if (currentStep >= FADE_STEPS) {
        clearInterval(fadeTimer);
        this.pause();
        if (this.player && typeof this.player.setVolume === 'function') {
          this.player.setVolume(this.volumeBeforeFade);
        }
        if (typeof callback === 'function') {
          callback();
        }
      }
    }, stepInterval);
  }
};


// ════════════════════════════════════════════════════════════════
// 5. UIController — DOM Rendering & User Interaction Matrix
// ════════════════════════════════════════════════════════════════
const UIController = {
  els: {},
  state: {
    activeCategory: 'all',
    searchQuery: '',
    zenActive: false,
    pipVisible: false,
    pipCollapsed: true,
    muted: false,
    searchDebounce: null,
    mobileToolsOpen: false
  },
  isScrubbing: false,
  _unlocked: false,

  /**
   * Generates a clean, aesthetic SVG gradient thumbnail
   * Ensures ZERO gray error boxes if YouTube's CDN is slow, blocked, or missing
   */
  generateThumbnailSvg(title, artist, accentColor) {
    const safeTitle = (title || 'Focus Audio').replace(/[<>&"']/g, '');
    const safeArtist = (artist || 'FocusStation').replace(/[<>&"']/g, '');
    const color = accentColor || '#0284c7';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f8fafc"/>
          <stop offset="100%" stop-color="#e2e8f0"/>
        </linearGradient>
        <radialGradient id="r" cx="50%" cy="38%" r="65%">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="320" height="180" fill="url(#g)"/>
      <rect width="320" height="180" fill="url(#r)"/>
      <circle cx="160" cy="70" r="28" fill="#ffffff" stroke="${color}" stroke-width="2" opacity="0.95"/>
      <polygon points="155,60 171,70 155,80" fill="${color}"/>
      <text x="160" y="124" font-family="-apple-system,BlinkMacSystemFont,'Inter',sans-serif" font-size="12" font-weight="600" fill="#0f172a" text-anchor="middle">${safeTitle.slice(0, 32)}</text>
      <text x="160" y="144" font-family="-apple-system,BlinkMacSystemFont,'Inter',sans-serif" font-size="10" font-weight="500" fill="#64748b" text-anchor="middle">${safeArtist.slice(0, 28)}</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  },

  init() {
    this.els = {
      app: document.getElementById('app'),
      unlockOverlay: document.getElementById('unlock-overlay'),
      unlockBtn: document.getElementById('unlock-btn'),
      header: document.getElementById('header'),
      dock: document.getElementById('dock'),
      dockThumb: document.getElementById('dock-thumb'),
      dockTitle: document.getElementById('dock-title'),
      dockArtist: document.getElementById('dock-artist'),
      dockFavBtn: document.getElementById('dock-fav-btn'),
      pipToggleBtn: document.getElementById('pip-toggle-btn'),
      shuffleBtn: document.getElementById('shuffle-btn'),
      prevBtn: document.getElementById('prev-btn'),
      playPauseBtn: document.getElementById('play-pause-btn'),
      nextBtn: document.getElementById('next-btn'),
      loopBtn: document.getElementById('loop-btn'),
      playIcon: document.getElementById('play-icon'),
      pauseIcon: document.getElementById('pause-icon'),
      seekbar: document.getElementById('seekbar'),
      timeCurrent: document.getElementById('time-current'),
      timeTotal: document.getElementById('time-total'),
      timerBadge: document.getElementById('timer-badge'),
      timerBadgeTime: document.getElementById('timer-badge-time'),
      timerBadgeStatus: document.getElementById('timer-badge-status'),
      timerPreset: document.getElementById('timer-preset'),
      timerPlayBtn: document.getElementById('timer-play-btn'),
      timerResetBtn: document.getElementById('timer-reset-btn'),
      tPlayIcon: document.getElementById('t-play-icon'),
      tPauseIcon: document.getElementById('t-pause-icon'),
      noiseToggleBtn: document.getElementById('noise-toggle-btn'),
      noiseTypeBtn: document.getElementById('noise-type-btn'),
      noiseTypeLabel: document.getElementById('noise-type-label'),
      noiseSlider: document.getElementById('noise-slider'),
      muteBtn: document.getElementById('mute-btn'),
      volumeSlider: document.getElementById('volume-slider'),
      volIconOn: document.getElementById('vol-icon-on'),
      volIconOff: document.getElementById('vol-icon-off'),
      categoryNav: document.getElementById('category-nav'),
      searchInput: document.getElementById('search-input'),
      searchClear: document.getElementById('search-clear'),
      trackGrid: document.getElementById('track-grid'),
      emptyState: document.getElementById('empty-state'),
      recentShelf: document.getElementById('recent-shelf-section'),
      recentList: document.getElementById('recent-list'),
      recentClearBtn: document.getElementById('recent-clear-btn'),
      favoritesShelf: document.getElementById('favorites-shelf-section'),
      favoritesList: document.getElementById('favorites-list'),
      favoritesCount: document.getElementById('favorites-count'),
      gridTitle: document.getElementById('grid-title'),
      gridCount: document.getElementById('grid-count'),
      zenOverlay: document.getElementById('zen-overlay'),
      zenBtn: document.getElementById('zen-btn'),
      zenCloseBtn: document.getElementById('zen-close-btn'),
      zenTitle: document.getElementById('zen-title'),
      zenArtist: document.getElementById('zen-artist'),
      zenCategory: document.getElementById('zen-category'),
      zenTimerDisplay: document.getElementById('zen-timer-display'),
      pipFrame: document.getElementById('pip-frame'),
      pipCollapseBtn: document.getElementById('pip-collapse-btn'),
      pipCloseBtn: document.getElementById('pip-close-btn'),
      pipChevron: document.getElementById('pip-chevron'),
      shortcutsOverlay: document.getElementById('shortcuts-overlay'),
      shortcutsBtn: document.getElementById('shortcuts-btn'),
      shortcutsCloseBtn: document.getElementById('shortcuts-close-btn'),
      timerDoneOverlay: document.getElementById('timer-done-overlay'),
      timerDoneRestart: document.getElementById('timer-done-restart'),
      timerDoneDismiss: document.getElementById('timer-done-dismiss'),
      toast: document.getElementById('toast'),
      workspace: document.getElementById('workspace'),
      // Mobile Drawer Elements
      mobileToolsBtn: document.getElementById('mobile-tools-btn'),
      mobileToolsSheet: document.getElementById('mobile-tools-sheet'),
      mobileToolsBackdrop: document.getElementById('mobile-tools-backdrop'),
      mobileToolsClose: document.getElementById('mobile-tools-close'),
      mTimerPreset: document.getElementById('m-timer-preset'),
      mTimerPlayBtn: document.getElementById('m-timer-play-btn'),
      mTimerResetBtn: document.getElementById('m-timer-reset-btn'),
      mNoiseToggleBtn: document.getElementById('m-noise-toggle-btn'),
      mNoiseTypeBtn: document.getElementById('m-noise-type-btn'),
      mNoiseTypeLabel: document.getElementById('m-noise-type-label'),
      mNoiseSlider: document.getElementById('m-noise-slider'),
      mMuteBtn: document.getElementById('m-mute-btn'),
      mVolumeSlider: document.getElementById('m-volume-slider')
    };

    this.renderCategories();
    const allTracks = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.tracks))
      ? window.FOCUS_CATALOG.tracks
      : [];
    this.renderGrid(allTracks);
    this.renderShelves();

    const prefs = StorageController.getPrefs();
    if (this.els.volumeSlider) {
      this.els.volumeSlider.value = prefs.volume;
      this.updateDockSliderFill(this.els.volumeSlider, prefs.volume, 100);
    }
    if (this.els.mVolumeSlider) {
      this.els.mVolumeSlider.value = prefs.volume;
      this.updateDockSliderFill(this.els.mVolumeSlider, prefs.volume, 100);
    }
    if (this.els.noiseSlider) {
      this.els.noiseSlider.value = prefs.noiseVolume;
      this.updateDockSliderFill(this.els.noiseSlider, prefs.noiseVolume, 100);
    }
    if (this.els.mNoiseSlider) {
      this.els.mNoiseSlider.value = prefs.noiseVolume;
      this.updateDockSliderFill(this.els.mNoiseSlider, prefs.noiseVolume, 100);
    }

    // Initialize noise type
    if (prefs.noiseType) {
      WebAudioEngine.setNoiseType(prefs.noiseType);
      this.updateNoiseTypeLabels(prefs.noiseType);
    }

    PlayerEngine.setLoop(prefs.loopState || 'category');
    PlayerEngine.shuffleOn = !!prefs.shuffleOn;
    this.updateShuffleBtn(PlayerEngine.shuffleOn);

    // Audio Unlock Barrier
    if (this.els.unlockBtn) {
      this.els.unlockBtn.addEventListener('click', () => {
        this.hideUnlockOverlay();
        WebAudioEngine.resume();
        this._unlocked = true;
        const deepFocusTracks = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.tracks))
          ? window.FOCUS_CATALOG.tracks.filter(t => t.category_id === 'deep-focus')
          : [];
        if (deepFocusTracks.length > 0) {
          PlayerEngine.loadTrack(deepFocusTracks[0].id);
        }
      });
    }

    // Interactive Timer Badge Toggle
    if (this.els.timerBadge) {
      this.els.timerBadge.addEventListener('click', () => FocusTimer.togglePlayPause());
      this.els.timerBadge.addEventListener('keydown', (e) => {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          FocusTimer.togglePlayPause();
        }
      });
    }

    // Transport buttons
    if (this.els.playPauseBtn) {
      this.els.playPauseBtn.addEventListener('click', () => PlayerEngine.togglePlayPause());
    }
    if (this.els.prevBtn) {
      this.els.prevBtn.addEventListener('click', () => PlayerEngine.playPrev());
    }
    if (this.els.nextBtn) {
      this.els.nextBtn.addEventListener('click', () => PlayerEngine.playNext());
    }
    if (this.els.loopBtn) {
      this.els.loopBtn.addEventListener('click', () => PlayerEngine.cycleLoop());
    }
    if (this.els.shuffleBtn) {
      this.els.shuffleBtn.addEventListener('click', () => PlayerEngine.toggleShuffle());
    }

    // Jitter-Free Tactile Seekbar Handlers
    if (this.els.seekbar) {
      const startScrub = () => {
        this.isScrubbing = true;
      };

      const handleScrub = (e) => {
        this.isScrubbing = true;
        const val = parseInt(e.target.value, 10);
        const pct = (val / 1000) * 100;
        this.els.seekbar.style.setProperty('--fill-pct', pct + '%');
        const dur = PlayerEngine.getDuration();
        if (dur > 0 && this.els.timeCurrent) {
          this.els.timeCurrent.textContent = this.formatTime((val / 1000) * dur);
        }
      };

      const finishScrub = (e) => {
        if (this.isScrubbing) {
          const val = parseInt(this.els.seekbar.value, 10);
          PlayerEngine.seekByFraction(val / 1000);
          this.isScrubbing = false;
        }
      };

      this.els.seekbar.addEventListener('pointerdown', startScrub);
      this.els.seekbar.addEventListener('touchstart', startScrub, { passive: true });
      this.els.seekbar.addEventListener('input', handleScrub);
      this.els.seekbar.addEventListener('change', finishScrub);
      this.els.seekbar.addEventListener('pointerup', finishScrub);
      this.els.seekbar.addEventListener('touchend', finishScrub);

      window.addEventListener('pointerup', () => {
        if (this.isScrubbing) {
          const val = parseInt(this.els.seekbar.value, 10);
          PlayerEngine.seekByFraction(val / 1000);
          this.isScrubbing = false;
        }
      });
    }

    // Volume Sliders
    const handleVolumeChange = (val) => {
      PlayerEngine.setVolume(val);
      if (this.els.volumeSlider) {
        this.els.volumeSlider.value = val;
        this.updateDockSliderFill(this.els.volumeSlider, val, 100);
      }
      if (this.els.mVolumeSlider) {
        this.els.mVolumeSlider.value = val;
        this.updateDockSliderFill(this.els.mVolumeSlider, val, 100);
      }
      StorageController.setPref('volume', val);

      if (val === 0) {
        this.state.muted = true;
        if (this.els.volIconOn && this.els.volIconOff) {
          this.els.volIconOn.style.display = 'none';
          this.els.volIconOff.style.display = 'block';
        }
        if (this.els.muteBtn) this.els.muteBtn.setAttribute('aria-pressed', 'true');
        if (this.els.mMuteBtn) this.els.mMuteBtn.setAttribute('aria-pressed', 'true');
      } else {
        if (this.state.muted) {
          this.state.muted = false;
          PlayerEngine.mute(false);
        }
        if (this.els.volIconOn && this.els.volIconOff) {
          this.els.volIconOn.style.display = 'block';
          this.els.volIconOff.style.display = 'none';
        }
        if (this.els.muteBtn) this.els.muteBtn.setAttribute('aria-pressed', 'false');
        if (this.els.mMuteBtn) this.els.mMuteBtn.setAttribute('aria-pressed', 'false');
      }
    };

    if (this.els.volumeSlider) {
      this.els.volumeSlider.addEventListener('input', (e) => handleVolumeChange(parseInt(e.target.value, 10)));
    }
    if (this.els.mVolumeSlider) {
      this.els.mVolumeSlider.addEventListener('input', (e) => handleVolumeChange(parseInt(e.target.value, 10)));
    }

    if (this.els.muteBtn) {
      this.els.muteBtn.addEventListener('click', () => this.toggleMute());
    }
    if (this.els.mMuteBtn) {
      this.els.mMuteBtn.addEventListener('click', () => this.toggleMute());
    }

    // Dual Ambient Noise Controls (Brown / Pink)
    const handleNoiseToggle = () => {
      const val = this.els.noiseSlider ? parseInt(this.els.noiseSlider.value, 10) : 30;
      WebAudioEngine.toggle(val);
      const active = WebAudioEngine.isPlaying;
      const typeLabel = WebAudioEngine.noiseType === 'pink' ? 'Pink' : 'Brown';

      if (this.els.noiseToggleBtn) {
        this.els.noiseToggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        this.els.noiseToggleBtn.classList.toggle('is-active', active);
      }
      if (this.els.mNoiseToggleBtn) {
        this.els.mNoiseToggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        this.els.mNoiseToggleBtn.classList.toggle('is-active', active);
      }

      this.showToast(active ? `${typeLabel} noise started` : 'Ambient noise stopped');
    };

    if (this.els.noiseToggleBtn) {
      this.els.noiseToggleBtn.addEventListener('click', handleNoiseToggle);
    }
    if (this.els.mNoiseToggleBtn) {
      this.els.mNoiseToggleBtn.addEventListener('click', handleNoiseToggle);
    }

    const handleNoiseTypeToggle = () => {
      const nextType = WebAudioEngine.toggleNoiseType();
      this.updateNoiseTypeLabels(nextType);
      const cap = nextType === 'pink' ? 'Pink' : 'Brown';
      this.showToast(`Switched to ${cap} noise`);
    };

    if (this.els.noiseTypeBtn) {
      this.els.noiseTypeBtn.addEventListener('click', handleNoiseTypeToggle);
    }
    if (this.els.mNoiseTypeBtn) {
      this.els.mNoiseTypeBtn.addEventListener('click', handleNoiseTypeToggle);
    }

    const handleNoiseSliderChange = (val) => {
      WebAudioEngine.setVolume(val);
      if (this.els.noiseSlider) {
        this.els.noiseSlider.value = val;
        this.updateDockSliderFill(this.els.noiseSlider, val, 100);
      }
      if (this.els.mNoiseSlider) {
        this.els.mNoiseSlider.value = val;
        this.updateDockSliderFill(this.els.mNoiseSlider, val, 100);
      }
      StorageController.setPref('noiseVolume', val);
    };

    if (this.els.noiseSlider) {
      this.els.noiseSlider.addEventListener('input', (e) => handleNoiseSliderChange(parseInt(e.target.value, 10)));
    }
    if (this.els.mNoiseSlider) {
      this.els.mNoiseSlider.addEventListener('input', (e) => handleNoiseSliderChange(parseInt(e.target.value, 10)));
    }

    // Timer Preset & Play Buttons
    if (this.els.timerPlayBtn) {
      this.els.timerPlayBtn.addEventListener('click', () => FocusTimer.togglePlayPause());
    }
    if (this.els.timerResetBtn) {
      this.els.timerResetBtn.addEventListener('click', () => FocusTimer.reset());
    }
    if (this.els.timerPreset) {
      this.els.timerPreset.addEventListener('change', (e) => FocusTimer.setPreset(parseInt(e.target.value, 10)));
    }

    if (this.els.mTimerPlayBtn) {
      this.els.mTimerPlayBtn.addEventListener('click', () => FocusTimer.togglePlayPause());
    }
    if (this.els.mTimerResetBtn) {
      this.els.mTimerResetBtn.addEventListener('click', () => FocusTimer.reset());
    }
    if (this.els.mTimerPreset) {
      this.els.mTimerPreset.addEventListener('change', (e) => FocusTimer.setPreset(parseInt(e.target.value, 10)));
    }

    // Mobile Tools Sheet Drawer
    if (this.els.mobileToolsBtn) {
      this.els.mobileToolsBtn.addEventListener('click', () => this.toggleMobileToolsSheet());
    }
    if (this.els.mobileToolsClose) {
      this.els.mobileToolsClose.addEventListener('click', () => this.hideMobileToolsSheet());
    }
    if (this.els.mobileToolsBackdrop) {
      this.els.mobileToolsBackdrop.addEventListener('click', () => this.hideMobileToolsSheet());
    }

    // Dock Favorite button
    if (this.els.dockFavBtn) {
      this.els.dockFavBtn.addEventListener('click', () => {
        if (PlayerEngine.currentTrack) {
          const isFav = StorageController.toggleFavorite(PlayerEngine.currentTrack.id);
          this.els.dockFavBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
          const gridFavBtn = this.els.trackGrid
            ? this.els.trackGrid.querySelector(`.track-card__fav-btn[data-track-id="${PlayerEngine.currentTrack.id}"]`)
            : null;
          if (gridFavBtn) {
            gridFavBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
          }
          this.renderShelves();
          this.showToast(isFav ? 'Added to favorites' : 'Removed from favorites');
        }
      });
    }

    // PiP controls & Dragging
    if (this.els.pipToggleBtn) {
      this.els.pipToggleBtn.addEventListener('click', () => this.togglePip());
    }
    if (this.els.pipCollapseBtn) {
      this.els.pipCollapseBtn.addEventListener('click', () => this.togglePipCollapse());
    }
    if (this.els.pipCloseBtn) {
      this.els.pipCloseBtn.addEventListener('click', () => this.hidePip());
    }
    this.initPipDrag();

    // Zen Mode
    if (this.els.zenBtn) {
      this.els.zenBtn.addEventListener('click', () => this.toggleZenMode());
    }
    if (this.els.zenCloseBtn) {
      this.els.zenCloseBtn.addEventListener('click', () => this.toggleZenMode());
    }

    // Shortcuts Panel
    if (this.els.shortcutsBtn) {
      this.els.shortcutsBtn.addEventListener('click', () => this.showShortcuts());
    }
    if (this.els.shortcutsCloseBtn) {
      this.els.shortcutsCloseBtn.addEventListener('click', () => this.hideShortcuts());
    }
    if (this.els.shortcutsOverlay) {
      this.els.shortcutsOverlay.addEventListener('click', (e) => {
        if (e.target === this.els.shortcutsOverlay) {
          this.hideShortcuts();
        }
      });
    }

    // Search input
    if (this.els.searchInput) {
      this.els.searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        if (this.els.searchClear) {
          if (q.length > 0) {
            this.els.searchClear.removeAttribute('hidden');
          } else {
            this.els.searchClear.setAttribute('hidden', '');
          }
        }
        this.searchTracks(q);
      });
    }

    if (this.els.searchClear) {
      this.els.searchClear.addEventListener('click', () => {
        if (this.els.searchInput) {
          this.els.searchInput.value = '';
          this.els.searchInput.focus();
        }
        this.els.searchClear.setAttribute('hidden', '');
        this.searchTracks('');
      });
    }

    // Shelves clear
    if (this.els.recentClearBtn) {
      this.els.recentClearBtn.addEventListener('click', () => {
        StorageController.clearRecent();
        this.renderShelves();
        this.showToast('Recent history cleared');
      });
    }

    // Timer completion dialog
    if (this.els.timerDoneRestart) {
      this.els.timerDoneRestart.addEventListener('click', () => {
        FocusTimer.setPreset(FocusTimer.preset || 90);
        FocusTimer.start();
        this.hideTimerDone();
      });
    }

    if (this.els.timerDoneDismiss) {
      this.els.timerDoneDismiss.addEventListener('click', () => {
        this.hideTimerDone();
      });
    }

    if (this.els.timerDoneOverlay) {
      this.els.timerDoneOverlay.addEventListener('click', (e) => {
        if (e.target === this.els.timerDoneOverlay) {
          this.hideTimerDone();
        }
      });
    }

    this.setupKeyboardShortcuts();
  },

  updateNoiseTypeLabels(type) {
    const isPink = type === 'pink';
    const label = isPink ? 'Pink' : 'Brown';
    if (this.els.noiseTypeLabel) this.els.noiseTypeLabel.textContent = label;
    if (this.els.mNoiseTypeLabel) this.els.mNoiseTypeLabel.textContent = label;
    if (this.els.noiseTypeBtn) {
      this.els.noiseTypeBtn.classList.toggle('is-pink', isPink);
      this.els.noiseTypeBtn.setAttribute('aria-label', `Noise type: ${label}. Click to toggle`);
    }
    if (this.els.mNoiseTypeBtn) {
      this.els.mNoiseTypeBtn.classList.toggle('is-pink', isPink);
      this.els.mNoiseTypeBtn.setAttribute('aria-label', `Noise type: ${label}. Click to toggle`);
    }
  },

  toggleMobileToolsSheet() {
    this.state.mobileToolsOpen = !this.state.mobileToolsOpen;
    if (this.els.mobileToolsSheet) {
      this.els.mobileToolsSheet.setAttribute('aria-hidden', this.state.mobileToolsOpen ? 'false' : 'true');
    }
    if (this.els.mobileToolsBtn) {
      this.els.mobileToolsBtn.setAttribute('aria-expanded', this.state.mobileToolsOpen ? 'true' : 'false');
    }
  },

  hideMobileToolsSheet() {
    this.state.mobileToolsOpen = false;
    if (this.els.mobileToolsSheet) {
      this.els.mobileToolsSheet.setAttribute('aria-hidden', 'true');
    }
    if (this.els.mobileToolsBtn) {
      this.els.mobileToolsBtn.setAttribute('aria-expanded', 'false');
    }
  },

  /**
   * Lightweight pointer dragging for the Picture-in-Picture window
   */
  initPipDrag() {
    const frame = this.els.pipFrame;
    if (!frame) return;
    const header = frame.querySelector('.pip-frame__header');
    if (!header) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initLeft = 0;
    let initTop = 0;

    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      header.setPointerCapture(e.pointerId);

      const rect = frame.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initLeft = rect.left;
      initTop = rect.top;

      frame.style.bottom = 'auto';
      frame.style.right = 'auto';
      frame.style.left = `${initLeft}px`;
      frame.style.top = `${initTop}px`;
      frame.classList.add('is-dragging');
    });

    header.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const rect = frame.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - 8;
      const maxY = window.innerHeight - rect.height - 8;

      const newLeft = Math.max(8, Math.min(initLeft + dx, maxX));
      const newTop = Math.max(8, Math.min(initTop + dy, maxY));

      frame.style.left = `${newLeft}px`;
      frame.style.top = `${newTop}px`;
    });

    const stopDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      frame.classList.remove('is-dragging');
      try {
        header.releasePointerCapture(e.pointerId);
      } catch (err) {}
    };

    header.addEventListener('pointerup', stopDrag);
    header.addEventListener('pointercancel', stopDrag);
  },

  renderCategories() {
    if (!this.els.categoryNav) return;
    this.els.categoryNav.innerHTML = '';

    const totalTracks = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.tracks))
      ? window.FOCUS_CATALOG.tracks.length
      : 0;

    const allBtn = document.createElement('button');
    allBtn.className = 'category-pill is-active';
    allBtn.setAttribute('role', 'tab');
    allBtn.setAttribute('data-cat', 'all');
    allBtn.setAttribute('aria-selected', 'true');
    allBtn.innerHTML = `
      <span class="pill-icon">∞</span>
      All
      <span class="pill-count">${totalTracks}</span>
    `;
    allBtn.addEventListener('click', () => this.filterByCategory('all'));
    this.els.categoryNav.appendChild(allBtn);

    if (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.categories)) {
      window.FOCUS_CATALOG.categories.forEach(cat => {
        const count = window.FOCUS_CATALOG.tracks.filter(t => t.category_id === cat.id).length;
        const btn = document.createElement('button');
        btn.className = 'category-pill';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('data-cat', cat.id);
        btn.setAttribute('data-accent', cat.accentColor);
        btn.setAttribute('aria-selected', 'false');

        const iconSpan = document.createElement('span');
        iconSpan.className = 'pill-icon';
        iconSpan.textContent = cat.icon;

        const labelText = document.createTextNode(` ${cat.label} `);

        const countSpan = document.createElement('span');
        countSpan.className = 'pill-count';
        countSpan.textContent = String(count);

        btn.appendChild(iconSpan);
        btn.appendChild(labelText);
        btn.appendChild(countSpan);

        btn.addEventListener('click', () => this.filterByCategory(cat.id));
        this.els.categoryNav.appendChild(btn);
      });
    }
  },

  renderGrid(tracks) {
    if (!this.els.trackGrid) return;
    this.els.trackGrid.innerHTML = '';

    if (!tracks || tracks.length === 0) {
      if (this.els.emptyState) this.els.emptyState.removeAttribute('hidden');
      if (this.els.gridCount) this.els.gridCount.textContent = '0 tracks';
      return;
    }

    if (this.els.emptyState) this.els.emptyState.setAttribute('hidden', '');
    if (this.els.gridCount) {
      this.els.gridCount.textContent = `${tracks.length} track${tracks.length === 1 ? '' : 's'}`;
    }

    const fragment = document.createDocumentFragment();

    tracks.forEach(track => {
      const card = document.createElement('article');
      card.className = 'track-card';
      card.setAttribute('role', 'listitem');
      card.setAttribute('tabindex', '0');
      card.setAttribute('data-track-id', track.id);
      card.setAttribute('data-category', track.category_id);
      card.setAttribute('aria-label', `Play ${track.title}`);

      if (PlayerEngine.currentTrack && PlayerEngine.currentTrack.id === track.id) {
        card.classList.add('is-playing');
        if (PlayerEngine.isPlaying) {
          card.classList.add('is-audio-playing');
        }
      }

      const isFav = StorageController.isFavorite(track.id);
      const cat = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.categories))
        ? window.FOCUS_CATALOG.categories.find(c => c.id === track.category_id)
        : null;
      const catColor = cat ? cat.accentColor : '#0284c7';
      const catLabel = cat ? cat.label : track.category_id;

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'track-card__thumb-wrap';

      const img = document.createElement('img');
      img.className = 'track-card__thumb';
      img.src = `https://img.youtube.com/vi/${track.youtube_id}/mqdefault.jpg`;
      img.alt = '';
      img.loading = 'lazy';

      // Fallback handlers to guarantee zero gray boxes
      img.onerror = () => {
        img.onerror = null;
        img.src = this.generateThumbnailSvg(track.title, track.artist, catColor);
      };
      img.onload = () => {
        if (img.naturalWidth === 120 && img.naturalHeight === 90) {
          img.src = this.generateThumbnailSvg(track.title, track.artist, catColor);
        }
      };

      const overlay = document.createElement('div');
      overlay.className = 'track-card__overlay';

      const playCircle = document.createElement('div');
      playCircle.className = 'track-card__play-circle';
      playCircle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>';
      overlay.appendChild(playCircle);

      const eq = document.createElement('div');
      eq.className = 'track-card__eq';
      eq.innerHTML = '<span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span>';

      const durBadge = document.createElement('span');
      durBadge.className = 'track-card__duration';
      durBadge.textContent = track.duration;

      thumbWrap.appendChild(img);
      thumbWrap.appendChild(overlay);
      thumbWrap.appendChild(eq);
      thumbWrap.appendChild(durBadge);

      const info = document.createElement('div');
      info.className = 'track-card__info';

      const top = document.createElement('div');
      top.className = 'track-card__top';

      const title = document.createElement('h3');
      title.className = 'track-card__title';
      title.textContent = track.title;

      const favBtn = document.createElement('button');
      favBtn.className = 'track-card__fav-btn';
      favBtn.setAttribute('aria-label', isFav ? 'Remove from favorites' : 'Add to favorites');
      favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
      favBtn.setAttribute('data-track-id', track.id);
      favBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nowFav = StorageController.toggleFavorite(track.id);
        favBtn.setAttribute('aria-pressed', nowFav ? 'true' : 'false');
        favBtn.setAttribute('aria-label', nowFav ? 'Remove from favorites' : 'Add to favorites');
        if (PlayerEngine.currentTrack && PlayerEngine.currentTrack.id === track.id) {
          if (this.els.dockFavBtn) {
            this.els.dockFavBtn.setAttribute('aria-pressed', nowFav ? 'true' : 'false');
          }
        }
        this.renderShelves();
        this.showToast(nowFav ? 'Added to favorites' : 'Removed from favorites');
      });

      top.appendChild(title);
      top.appendChild(favBtn);

      const artist = document.createElement('p');
      artist.className = 'track-card__artist';
      artist.textContent = track.artist;

      const meta = document.createElement('div');
      meta.className = 'track-card__meta';

      const dot = document.createElement('span');
      dot.className = 'track-card__cat-dot';
      dot.style.background = catColor;

      const catText = document.createElement('span');
      catText.className = 'track-card__cat-label';
      catText.textContent = catLabel;

      meta.appendChild(dot);
      meta.appendChild(catText);

      info.appendChild(top);
      info.appendChild(artist);
      info.appendChild(meta);

      card.appendChild(thumbWrap);
      card.appendChild(info);

      card.addEventListener('click', () => {
        PlayerEngine.loadTrack(track.id);
      });

      card.addEventListener('keydown', (e) => {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          PlayerEngine.loadTrack(track.id);
        }
      });

      fragment.appendChild(card);
    });

    this.els.trackGrid.appendChild(fragment);
  },

  filterByCategory(catId) {
    this.state.activeCategory = catId;

    if (this.els.categoryNav) {
      const pills = this.els.categoryNav.querySelectorAll('.category-pill');
      pills.forEach(pill => {
        const isActive = pill.getAttribute('data-cat') === catId;
        pill.classList.toggle('is-active', isActive);
        pill.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }

    if (this.els.gridTitle) {
      if (catId === 'all') {
        this.els.gridTitle.textContent = 'All Tracks';
      } else {
        const cat = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.categories))
          ? window.FOCUS_CATALOG.categories.find(c => c.id === catId)
          : null;
        this.els.gridTitle.textContent = cat ? cat.label : catId;
      }
    }

    if (catId !== 'all') {
      PlayerEngine.buildQueue(catId);
    }

    const filtered = this.getFilteredTracks();
    this.renderGrid(filtered);
  },

  searchTracks(query) {
    if (this.state.searchDebounce) {
      clearTimeout(this.state.searchDebounce);
    }
    this.state.searchDebounce = setTimeout(() => {
      this.state.searchQuery = (query || '').toLowerCase();
      const filtered = this.getFilteredTracks();
      this.renderGrid(filtered);
    }, 200);
  },

  getFilteredTracks() {
    if (!window.FOCUS_CATALOG || !Array.isArray(window.FOCUS_CATALOG.tracks)) {
      return [];
    }
    let tracks = window.FOCUS_CATALOG.tracks;
    if (this.state.activeCategory !== 'all') {
      tracks = tracks.filter(t => t.category_id === this.state.activeCategory);
    }
    if (this.state.searchQuery) {
      tracks = tracks.filter(t =>
        (t.title && t.title.toLowerCase().includes(this.state.searchQuery)) ||
        (t.artist && t.artist.toLowerCase().includes(this.state.searchQuery))
      );
    }
    return tracks;
  },

  renderShelves() {
    const recents = StorageController.getRecent();
    if (this.els.recentShelf && this.els.recentList) {
      if (recents.length === 0) {
        this.els.recentShelf.setAttribute('hidden', '');
        this.els.recentList.innerHTML = '';
      } else {
        this.els.recentShelf.removeAttribute('hidden');
        this.els.recentList.innerHTML = '';
        const frag = document.createDocumentFragment();

        recents.forEach(track => {
          const card = document.createElement('article');
          card.className = 'shelf-card';
          card.setAttribute('role', 'listitem');
          card.setAttribute('tabindex', '0');
          card.setAttribute('data-track-id', track.id);
          card.setAttribute('aria-label', `Play ${track.title}`);

          const cat = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.categories))
            ? window.FOCUS_CATALOG.categories.find(c => c.id === track.category_id)
            : null;
          const catColor = cat ? cat.accentColor : '#0284c7';

          const thumbWrap = document.createElement('div');
          thumbWrap.className = 'shelf-card__thumb-wrap';

          const img = document.createElement('img');
          img.className = 'shelf-card__thumb';
          img.src = `https://img.youtube.com/vi/${track.youtube_id}/mqdefault.jpg`;
          img.alt = '';
          img.loading = 'lazy';

          img.onerror = () => {
            img.onerror = null;
            img.src = this.generateThumbnailSvg(track.title, track.artist, catColor);
          };
          img.onload = () => {
            if (img.naturalWidth === 120 && img.naturalHeight === 90) {
              img.src = this.generateThumbnailSvg(track.title, track.artist, catColor);
            }
          };

          const overlay = document.createElement('div');
          overlay.className = 'shelf-card__overlay';
          const playIcon = document.createElement('div');
          playIcon.className = 'shelf-card__play-icon';
          playIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>';
          overlay.appendChild(playIcon);

          thumbWrap.appendChild(img);
          thumbWrap.appendChild(overlay);

          const info = document.createElement('div');
          info.className = 'shelf-card__info';

          const title = document.createElement('p');
          title.className = 'shelf-card__title';
          title.textContent = track.title;

          const artist = document.createElement('p');
          artist.className = 'shelf-card__artist';
          artist.textContent = track.artist;

          info.appendChild(title);
          info.appendChild(artist);

          card.appendChild(thumbWrap);
          card.appendChild(info);

          card.addEventListener('click', () => {
            PlayerEngine.loadTrack(track.id);
          });

          card.addEventListener('keydown', (e) => {
            if (e.code === 'Enter' || e.code === 'Space') {
              e.preventDefault();
              PlayerEngine.loadTrack(track.id);
            }
          });

          frag.appendChild(card);
        });

        this.els.recentList.appendChild(frag);
      }
    }

    const favIds = StorageController.getFavorites();
    const allTracks = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.tracks))
      ? window.FOCUS_CATALOG.tracks
      : [];
    const favTracks = favIds.map(id => allTracks.find(t => t.id === id)).filter(Boolean);

    if (this.els.favoritesShelf && this.els.favoritesList) {
      if (favTracks.length === 0) {
        this.els.favoritesShelf.setAttribute('hidden', '');
        this.els.favoritesList.innerHTML = '';
        if (this.els.favoritesCount) this.els.favoritesCount.textContent = '0';
      } else {
        this.els.favoritesShelf.removeAttribute('hidden');
        if (this.els.favoritesCount) this.els.favoritesCount.textContent = String(favTracks.length);
        this.els.favoritesList.innerHTML = '';
        const frag = document.createDocumentFragment();

        favTracks.forEach(track => {
          const card = document.createElement('article');
          card.className = 'shelf-card';
          card.setAttribute('role', 'listitem');
          card.setAttribute('tabindex', '0');
          card.setAttribute('data-track-id', track.id);
          card.setAttribute('aria-label', `Play ${track.title}`);

          const cat = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.categories))
            ? window.FOCUS_CATALOG.categories.find(c => c.id === track.category_id)
            : null;
          const catColor = cat ? cat.accentColor : '#0284c7';

          const thumbWrap = document.createElement('div');
          thumbWrap.className = 'shelf-card__thumb-wrap';

          const img = document.createElement('img');
          img.className = 'shelf-card__thumb';
          img.src = `https://img.youtube.com/vi/${track.youtube_id}/mqdefault.jpg`;
          img.alt = '';
          img.loading = 'lazy';

          img.onerror = () => {
            img.onerror = null;
            img.src = this.generateThumbnailSvg(track.title, track.artist, catColor);
          };
          img.onload = () => {
            if (img.naturalWidth === 120 && img.naturalHeight === 90) {
              img.src = this.generateThumbnailSvg(track.title, track.artist, catColor);
            }
          };

          const overlay = document.createElement('div');
          overlay.className = 'shelf-card__overlay';
          const playIcon = document.createElement('div');
          playIcon.className = 'shelf-card__play-icon';
          playIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>';
          overlay.appendChild(playIcon);

          thumbWrap.appendChild(img);
          thumbWrap.appendChild(overlay);

          const info = document.createElement('div');
          info.className = 'shelf-card__info';

          const title = document.createElement('p');
          title.className = 'shelf-card__title';
          title.textContent = track.title;

          const artist = document.createElement('p');
          artist.className = 'shelf-card__artist';
          artist.textContent = track.artist;

          info.appendChild(title);
          info.appendChild(artist);

          card.appendChild(thumbWrap);
          card.appendChild(info);

          card.addEventListener('click', () => {
            PlayerEngine.loadTrack(track.id);
          });

          card.addEventListener('keydown', (e) => {
            if (e.code === 'Enter' || e.code === 'Space') {
              e.preventDefault();
              PlayerEngine.loadTrack(track.id);
            }
          });

          frag.appendChild(card);
        });

        this.els.favoritesList.appendChild(frag);
      }
    }
  },

  updateDockTrack(track) {
    if (!track) return;
    if (this.els.dockTitle) this.els.dockTitle.textContent = track.title;
    if (this.els.dockArtist) this.els.dockArtist.textContent = track.artist;
    if (this.els.dockThumb) {
      this.els.dockThumb.src = `https://img.youtube.com/vi/${track.youtube_id}/mqdefault.jpg`;
      this.els.dockThumb.alt = track.title;
      this.els.dockThumb.onerror = () => {
        this.els.dockThumb.onerror = null;
        this.els.dockThumb.src = this.generateThumbnailSvg(track.title, track.artist, '#0284c7');
      };
      this.els.dockThumb.onload = () => {
        if (this.els.dockThumb.naturalWidth === 120 && this.els.dockThumb.naturalHeight === 90) {
          this.els.dockThumb.src = this.generateThumbnailSvg(track.title, track.artist, '#0284c7');
        }
      };
    }
    if (this.els.dockFavBtn) {
      const isFav = StorageController.isFavorite(track.id);
      this.els.dockFavBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    }

    if (this.els.zenTitle) this.els.zenTitle.textContent = track.title;
    if (this.els.zenArtist) this.els.zenArtist.textContent = track.artist;
    if (this.els.zenCategory) {
      const cat = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.categories))
        ? window.FOCUS_CATALOG.categories.find(c => c.id === track.category_id)
        : null;
      this.els.zenCategory.textContent = cat ? cat.label : track.category_id;
    }

    if (this.els.trackGrid) {
      const prevPlaying = this.els.trackGrid.querySelectorAll('.track-card.is-playing');
      prevPlaying.forEach(el => {
        el.classList.remove('is-playing');
        el.classList.remove('is-audio-playing');
      });
      const currentCard = this.els.trackGrid.querySelector(`.track-card[data-track-id="${track.id}"]`);
      if (currentCard) {
        currentCard.classList.add('is-playing');
        if (PlayerEngine.isPlaying) {
          currentCard.classList.add('is-audio-playing');
        }
        currentCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  },

  setPlayState(isPlaying) {
    if (this.els.playIcon && this.els.pauseIcon) {
      this.els.playIcon.style.display = isPlaying ? 'none' : 'block';
      this.els.pauseIcon.style.display = isPlaying ? 'block' : 'none';
    }
    if (this.els.playPauseBtn) {
      this.els.playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    }

    // Dynamic Equalizer Pause State
    document.body.classList.toggle('is-audio-playing', isPlaying);
    if (this.els.trackGrid) {
      const activeCard = this.els.trackGrid.querySelector('.track-card.is-playing');
      if (activeCard) {
        activeCard.classList.toggle('is-audio-playing', isPlaying);
      }
    }

    if (isPlaying) {
      PlayerEngine.startSeekSync();
    } else {
      PlayerEngine.stopSeekSync();
    }
  },

  updateSeekbar(current, duration) {
    if (!this.els.seekbar || this.isScrubbing) return;
    if (duration > 0) {
      const pct = (current / duration) * 100;
      this.els.seekbar.value = Math.min(1000, Math.round(pct * 10));
      this.els.seekbar.style.setProperty('--fill-pct', pct + '%');
      if (this.els.timeCurrent) this.els.timeCurrent.textContent = this.formatTime(current);
      if (this.els.timeTotal) this.els.timeTotal.textContent = this.formatTime(duration);
      this.els.seekbar.setAttribute('aria-valuetext', this.formatTime(current));
    } else {
      if (this.els.timeCurrent) this.els.timeCurrent.textContent = this.formatTime(current);
      if (this.els.timeTotal) this.els.timeTotal.textContent = '—:——';
    }
  },

  updateLoopBtn(state) {
    if (!this.els.loopBtn) return;
    this.els.loopBtn.setAttribute('data-loop', state);
    let label = 'Loop: Category';
    if (state === 'single') label = 'Loop: Single';
    else if (state === 'off') label = 'Loop: Off';
    this.els.loopBtn.setAttribute('aria-label', label);
    this.els.loopBtn.setAttribute('title', label);
  },

  updateShuffleBtn(on) {
    if (!this.els.shuffleBtn) return;
    this.els.shuffleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.els.shuffleBtn.classList.toggle('is-active', !!on);
  },

  toggleZenMode() {
    this.state.zenActive = !this.state.zenActive;
    if (this.els.zenOverlay) {
      this.els.zenOverlay.setAttribute('aria-hidden', this.state.zenActive ? 'false' : 'true');
    }
    document.body.classList.toggle('zen-active', this.state.zenActive);
  },

  togglePip() {
    if (!this.state.pipVisible) {
      this.state.pipVisible = true;
      this.state.pipCollapsed = false;
      if (this.els.pipFrame) {
        this.els.pipFrame.classList.add('is-visible');
        this.els.pipFrame.classList.remove('pip-frame--collapsed');
      }
      if (this.els.pipChevron) {
        const poly = this.els.pipChevron.querySelector('polyline');
        if (poly) poly.setAttribute('points', '6 9 12 15 18 9');
      }
      if (this.els.pipToggleBtn) {
        this.els.pipToggleBtn.setAttribute('aria-pressed', 'true');
      }
    } else {
      this.hidePip();
    }
  },

  togglePipCollapse() {
    if (!this.els.pipFrame) return;
    this.state.pipCollapsed = !this.state.pipCollapsed;
    this.els.pipFrame.classList.toggle('pip-frame--collapsed', this.state.pipCollapsed);
    if (this.els.pipChevron) {
      const poly = this.els.pipChevron.querySelector('polyline');
      if (poly) {
        poly.setAttribute('points', this.state.pipCollapsed ? '18 15 12 9 6 15' : '6 9 12 15 18 9');
      }
    }
  },

  hidePip() {
    this.state.pipVisible = false;
    if (this.els.pipFrame) {
      this.els.pipFrame.classList.remove('is-visible');
    }
    if (this.els.pipToggleBtn) {
      this.els.pipToggleBtn.setAttribute('aria-pressed', 'false');
    }
  },

  showToast(message, duration = 2500) {
    if (!this.els.toast) return;
    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    if (this._toastFadeTimeout) clearTimeout(this._toastFadeTimeout);

    this.els.toast.textContent = message;
    this.els.toast.removeAttribute('hidden');
    void this.els.toast.offsetWidth;
    this.els.toast.classList.add('is-visible');

    this._toastTimeout = setTimeout(() => {
      this.els.toast.classList.remove('is-visible');
      this._toastFadeTimeout = setTimeout(() => {
        this.els.toast.setAttribute('hidden', '');
      }, 300);
    }, duration);
  },

  setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable]')) {
        return;
      }
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          PlayerEngine.togglePlayPause();
          break;
        case 'ArrowRight':
          e.preventDefault();
          PlayerEngine.playNext();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          PlayerEngine.playPrev();
          break;
        case 'ArrowUp':
          e.preventDefault();
          PlayerEngine.seekTo(PlayerEngine.getCurrentTime() + 5);
          break;
        case 'ArrowDown':
          e.preventDefault();
          PlayerEngine.seekTo(Math.max(0, PlayerEngine.getCurrentTime() - 5));
          break;
        case 'KeyM':
          e.preventDefault();
          this.toggleMute();
          break;
        case 'KeyF':
          e.preventDefault();
          this.toggleZenMode();
          break;
        case 'Escape':
          if (this.state.zenActive) this.toggleZenMode();
          if (this.state.mobileToolsOpen) this.hideMobileToolsSheet();
          this.hideShortcuts();
          this.hideTimerDone();
          break;
        default:
          break;
      }
    });
  },

  formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '—:——';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  hideUnlockOverlay() {
    if (!this.els.unlockOverlay) return;
    this.els.unlockOverlay.classList.add('is-hidden');
    setTimeout(() => {
      this.els.unlockOverlay.style.display = 'none';
    }, 400);
    if (this.els.app) {
      this.els.app.removeAttribute('aria-hidden');
    }
    if (this.els.workspace) {
      this.els.workspace.focus();
    }
  },

  toggleMute() {
    this.state.muted = !this.state.muted;
    PlayerEngine.mute(this.state.muted);
    if (this.els.volIconOn && this.els.volIconOff) {
      this.els.volIconOn.style.display = this.state.muted ? 'none' : 'block';
      this.els.volIconOff.style.display = this.state.muted ? 'block' : 'none';
    }
    if (this.els.muteBtn) {
      this.els.muteBtn.setAttribute('aria-pressed', this.state.muted ? 'true' : 'false');
    }
    if (this.els.mMuteBtn) {
      this.els.mMuteBtn.setAttribute('aria-pressed', this.state.muted ? 'true' : 'false');
    }
    this.showToast(this.state.muted ? 'Muted' : 'Unmuted');
  },

  updateDockSliderFill(el, val, max) {
    if (el) {
      el.style.setProperty('--fill-pct', (val / max * 100) + '%');
    }
  },

  showTimerDone() {
    if (this.els.timerDoneOverlay) {
      this.els.timerDoneOverlay.setAttribute('aria-hidden', 'false');
    }
  },

  hideTimerDone() {
    if (this.els.timerDoneOverlay) {
      this.els.timerDoneOverlay.setAttribute('aria-hidden', 'true');
    }
  },

  showShortcuts() {
    if (this.els.shortcutsOverlay) {
      this.els.shortcutsOverlay.setAttribute('aria-hidden', 'false');
    }
  },

  hideShortcuts() {
    if (this.els.shortcutsOverlay) {
      this.els.shortcutsOverlay.setAttribute('aria-hidden', 'true');
    }
  },

  onPlayerReady() {
    const prefs = StorageController.getPrefs();
    if (this.els.volumeSlider) {
      this.els.volumeSlider.value = prefs.volume;
      this.updateDockSliderFill(this.els.volumeSlider, prefs.volume, 100);
    }
    if (this.els.mVolumeSlider) {
      this.els.mVolumeSlider.value = prefs.volume;
      this.updateDockSliderFill(this.els.mVolumeSlider, prefs.volume, 100);
    }
    if (this.els.noiseSlider) {
      this.els.noiseSlider.value = prefs.noiseVolume;
      this.updateDockSliderFill(this.els.noiseSlider, prefs.noiseVolume, 100);
    }
    if (this.els.mNoiseSlider) {
      this.els.mNoiseSlider.value = prefs.noiseVolume;
      this.updateDockSliderFill(this.els.mNoiseSlider, prefs.noiseVolume, 100);
    }

    this.updateLoopBtn(prefs.loopState || 'category');
    this.updateShuffleBtn(prefs.shuffleOn || false);

    if (!PlayerEngine.currentTrack) {
      const deepFocusTracks = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.tracks))
        ? window.FOCUS_CATALOG.tracks.filter(t => t.category_id === 'deep-focus')
        : [];
      if (deepFocusTracks.length > 0) {
        PlayerEngine.buildQueue('deep-focus');
        const track = deepFocusTracks[0];
        PlayerEngine.currentTrack = track;
        if (PlayerEngine.player && typeof PlayerEngine.player.cueVideoById === 'function') {
          PlayerEngine.player.cueVideoById(track.youtube_id);
        }
        this.updateDockTrack(track);

        if (this._unlocked) {
          PlayerEngine.loadTrack(track.id);
        }
      }
    }
  }
};


// ════════════════════════════════════════════════════════════════
// 6. Bootstrapping & YouTube API Lifecycle
// ════════════════════════════════════════════════════════════════
window.onYouTubeIframeAPIReady = function () {
  PlayerEngine.init();
};

function boot() {
  UIController.init();
  FocusTimer.init();

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.async = true;
  const firstScript = document.getElementsByTagName('script')[0];
  if (firstScript && firstScript.parentNode) {
    firstScript.parentNode.insertBefore(tag, firstScript);
  } else {
    document.head.appendChild(tag);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
