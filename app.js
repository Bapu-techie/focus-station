'use strict';

/**
 * FocusStation — Distraction-Free Audio Workstation
 * Application Controller & Audio Engine Architecture
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
// 2. WebAudioEngine — Brown Noise Generator
// ════════════════════════════════════════════════════════════════
const WebAudioEngine = {
  ctx: null,
  gainNode: null,
  bufferSource: null,
  isPlaying: false,

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

  start(volume) {
    if (!this.ctx) {
      const ready = this.init();
      if (!ready) return;
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.stop();

    this.bufferSource = this.ctx.createBufferSource();
    this.bufferSource.buffer = this._generateBrownNoiseBuffer();
    this.bufferSource.loop = true;
    this.bufferSource.connect(this.gainNode);

    const targetGain = (volume / 100) * 0.3;
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
    if (this.gainNode && this.ctx) {
      const targetGain = (vol / 100) * 0.3;
      this.gainNode.gain.setValueAtTime(targetGain, this.ctx.currentTime);
    }
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
    PlayerEngine.fadeOutAndPause(FADE_DURATION_MS, () => {});
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
      case 3:
        break;
      default:
        break;
    }
  },

  _onError(event) {
    console.error('FocusStation: YouTube Player Error Code', event.data);
    if (event.data === 100 || event.data === 150) {
      UIController.showToast('Track unavailable. Skipping to next...');
      this.playNext();
    } else {
      UIController.showToast('Playback issue (code ' + event.data + ')');
    }
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

  loadTrack(trackId) {
    if (!window.FOCUS_CATALOG || !Array.isArray(window.FOCUS_CATALOG.tracks)) return;
    const track = window.FOCUS_CATALOG.tracks.find(t => t.id === trackId);
    if (!track) return;

    const currentCat = this.queue.length > 0 ? this.queue[0].category_id : null;
    if (this.queue.length === 0 || track.category_id !== currentCat) {
      this.buildQueue(track.category_id);
    }

    const index = this.queue.findIndex(t => t.id === track.id);
    this.queueIndex = index >= 0 ? index : 0;
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
    return (this.player && typeof this.player.getCurrentTime === 'function')
      ? this.player.getCurrentTime()
      : 0;
  },

  getDuration() {
    return (this.player && typeof this.player.getDuration === 'function')
      ? this.player.getDuration()
      : 0;
  },

  setLoop(state) {
    this.loopState = state;
    StorageController.setPref('loopState', state);
    UIController.updateLoopBtn(state);
  },

  cycleLoop() {
    const states = ['category', 'single', 'off'];
    const nextIdx = (states.indexOf(this.loopState) + 1) % states.length;
    this.setLoop(states[nextIdx]);
  },

  toggleShuffle() {
    this.shuffleOn = !this.shuffleOn;
    if (this.shuffleOn) {
      this._fisherYates(this.queue);
      if (this.currentTrack) {
        const idx = this.queue.findIndex(t => t.id === this.currentTrack.id);
        this.queueIndex = idx >= 0 ? idx : 0;
      }
    } else {
      this.queue = [...this.originalQueue];
      if (this.currentTrack) {
        const idx = this.queue.findIndex(t => t.id === this.currentTrack.id);
        this.queueIndex = idx >= 0 ? idx : 0;
      }
    }
    StorageController.setPref('shuffleOn', this.shuffleOn);
    UIController.updateShuffleBtn(this.shuffleOn);
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
    const startVol = (this.player && typeof this.player.getVolume === 'function')
      ? this.player.getVolume()
      : (StorageController.getPrefs().volume || 80);

    this.volumeBeforeFade = startVol;
    const steps = FADE_STEPS;
    const intervalTime = Math.max(10, Math.floor(durationMs / steps));
    let step = 0;

    const fadeInterval = setInterval(() => {
      step++;
      const fraction = 1 - (step / steps);
      const newVol = Math.max(0, Math.round(startVol * fraction));

      if (this.player && typeof this.player.setVolume === 'function') {
        this.player.setVolume(newVol);
      }

      if (step >= steps) {
        clearInterval(fadeInterval);
        this.pause();
        if (this.player && typeof this.player.setVolume === 'function') {
          this.player.setVolume(startVol);
        }
        if (typeof callback === 'function') {
          callback();
        }
      }
    }, intervalTime);
  }
};


// ════════════════════════════════════════════════════════════════
// 5. UIController — DOM Rendering + Event Handling
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
    searchDebounce: null
  },
  _unlocked: false,
  _toastTimeout: null,
  _toastFadeTimeout: null,

  init() {
    this.els = {
      app: document.getElementById('app'),
      unlockOverlay: document.getElementById('unlock-overlay'),
      unlockBtn: document.getElementById('unlock-btn'),
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
      workspace: document.getElementById('workspace')
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
    if (this.els.noiseSlider) {
      this.els.noiseSlider.value = prefs.noiseVolume;
      this.updateDockSliderFill(this.els.noiseSlider, prefs.noiseVolume, 100);
    }
    PlayerEngine.setLoop(prefs.loopState || 'category');
    PlayerEngine.shuffleOn = !!prefs.shuffleOn;
    this.updateShuffleBtn(PlayerEngine.shuffleOn);

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

    if (this.els.seekbar) {
      this.els.seekbar.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        const pct = (val / 1000) * 100;
        this.els.seekbar.style.setProperty('--fill-pct', pct + '%');
        const dur = PlayerEngine.getDuration();
        if (dur > 0) {
          this.els.timeCurrent.textContent = this.formatTime((val / 1000) * dur);
        }
      });
      this.els.seekbar.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        PlayerEngine.seekByFraction(val / 1000);
      });
    }

    if (this.els.volumeSlider) {
      this.els.volumeSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        PlayerEngine.setVolume(val);
        this.updateDockSliderFill(this.els.volumeSlider, val, 100);
        StorageController.setPref('volume', val);
        if (val === 0) {
          this.state.muted = true;
          if (this.els.volIconOn && this.els.volIconOff) {
            this.els.volIconOn.style.display = 'none';
            this.els.volIconOff.style.display = 'block';
          }
          if (this.els.muteBtn) this.els.muteBtn.setAttribute('aria-pressed', 'true');
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
        }
      });
    }

    if (this.els.muteBtn) {
      this.els.muteBtn.addEventListener('click', () => this.toggleMute());
    }

    if (this.els.noiseToggleBtn) {
      this.els.noiseToggleBtn.addEventListener('click', () => {
        const val = this.els.noiseSlider ? parseInt(this.els.noiseSlider.value, 10) : 30;
        WebAudioEngine.toggle(val);
        const active = WebAudioEngine.isPlaying;
        this.els.noiseToggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        this.els.noiseToggleBtn.classList.toggle('is-active', active);
        this.showToast(active ? 'Brown noise started' : 'Brown noise stopped');
      });
    }

    if (this.els.noiseSlider) {
      this.els.noiseSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        WebAudioEngine.setVolume(val);
        this.updateDockSliderFill(this.els.noiseSlider, val, 100);
        StorageController.setPref('noiseVolume', val);
      });
    }

    if (this.els.timerPlayBtn) {
      this.els.timerPlayBtn.addEventListener('click', () => FocusTimer.togglePlayPause());
    }
    if (this.els.timerResetBtn) {
      this.els.timerResetBtn.addEventListener('click', () => FocusTimer.reset());
    }
    if (this.els.timerPreset) {
      this.els.timerPreset.addEventListener('change', (e) => FocusTimer.setPreset(parseInt(e.target.value, 10)));
    }

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

    if (this.els.pipToggleBtn) {
      this.els.pipToggleBtn.addEventListener('click', () => this.togglePip());
    }
    if (this.els.pipCollapseBtn) {
      this.els.pipCollapseBtn.addEventListener('click', () => this.togglePipCollapse());
    }
    if (this.els.pipCloseBtn) {
      this.els.pipCloseBtn.addEventListener('click', () => this.hidePip());
    }

    if (this.els.zenBtn) {
      this.els.zenBtn.addEventListener('click', () => this.toggleZenMode());
    }
    if (this.els.zenCloseBtn) {
      this.els.zenCloseBtn.addEventListener('click', () => this.toggleZenMode());
    }

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

    if (this.els.recentClearBtn) {
      this.els.recentClearBtn.addEventListener('click', () => {
        StorageController.clearRecent();
        this.renderShelves();
        this.showToast('Recent history cleared');
      });
    }

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
      }

      const isFav = StorageController.isFavorite(track.id);
      const cat = (window.FOCUS_CATALOG && Array.isArray(window.FOCUS_CATALOG.categories))
        ? window.FOCUS_CATALOG.categories.find(c => c.id === track.category_id)
        : null;
      const catColor = cat ? cat.accentColor : '#38bdf8';
      const catLabel = cat ? cat.label : track.category_id;

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'track-card__thumb-wrap';

      const img = document.createElement('img');
      img.className = 'track-card__thumb';
      img.src = `https://img.youtube.com/vi/${track.youtube_id}/mqdefault.jpg`;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function() {
        this.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='90'%3E%3Crect width='120' height='90' fill='%23171b26'/%3E%3C/svg%3E";
      };

      const overlay = document.createElement('div');
      overlay.className = 'track-card__overlay';
      const playCircle = document.createElement('div');
      playCircle.className = 'track-card__play-circle';
      playCircle.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21"/></svg>';
      overlay.appendChild(playCircle);

      const eq = document.createElement('div');
      eq.className = 'track-card__eq';
      eq.innerHTML = '<span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span>';

      const dur = document.createElement('span');
      dur.className = 'track-card__duration';
      dur.textContent = track.duration || '';

      thumbWrap.appendChild(img);
      thumbWrap.appendChild(overlay);
      thumbWrap.appendChild(eq);
      thumbWrap.appendChild(dur);

      const info = document.createElement('div');
      info.className = 'track-card__info';

      const top = document.createElement('div');
      top.className = 'track-card__top';

      const titleEl = document.createElement('h3');
      titleEl.className = 'track-card__title';
      titleEl.textContent = track.title;

      const favBtn = document.createElement('button');
      favBtn.className = 'track-card__fav-btn';
      favBtn.setAttribute('aria-label', 'Favorite');
      favBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
      favBtn.setAttribute('data-track-id', track.id);
      favBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const favorited = StorageController.toggleFavorite(track.id);
        favBtn.setAttribute('aria-pressed', favorited ? 'true' : 'false');
        if (PlayerEngine.currentTrack && PlayerEngine.currentTrack.id === track.id) {
          if (this.els.dockFavBtn) {
            this.els.dockFavBtn.setAttribute('aria-pressed', favorited ? 'true' : 'false');
          }
        }
        this.renderShelves();
        this.showToast(favorited ? 'Added to favorites' : 'Removed from favorites');
      });

      top.appendChild(titleEl);
      top.appendChild(favBtn);

      const artistEl = document.createElement('p');
      artistEl.className = 'track-card__artist';
      artistEl.textContent = track.artist;

      const meta = document.createElement('div');
      meta.className = 'track-card__meta';
      const dot = document.createElement('span');
      dot.className = 'track-card__cat-dot';
      dot.style.background = catColor;
      const catLabelEl = document.createElement('span');
      catLabelEl.className = 'track-card__cat-label';
      catLabelEl.textContent = catLabel;

      meta.appendChild(dot);
      meta.appendChild(catLabelEl);

      info.appendChild(top);
      info.appendChild(artistEl);
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

          const thumbWrap = document.createElement('div');
          thumbWrap.className = 'shelf-card__thumb-wrap';

          const img = document.createElement('img');
          img.className = 'shelf-card__thumb';
          img.src = `https://img.youtube.com/vi/${track.youtube_id}/mqdefault.jpg`;
          img.alt = '';
          img.loading = 'lazy';
          img.onerror = function() {
            this.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='90'%3E%3Crect width='120' height='90' fill='%23171b26'/%3E%3C/svg%3E";
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

          const thumbWrap = document.createElement('div');
          thumbWrap.className = 'shelf-card__thumb-wrap';

          const img = document.createElement('img');
          img.className = 'shelf-card__thumb';
          img.src = `https://img.youtube.com/vi/${track.youtube_id}/mqdefault.jpg`;
          img.alt = '';
          img.loading = 'lazy';
          img.onerror = function() {
            this.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='90'%3E%3Crect width='120' height='90' fill='%23171b26'/%3E%3C/svg%3E";
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
      prevPlaying.forEach(el => el.classList.remove('is-playing'));
      const currentCard = this.els.trackGrid.querySelector(`.track-card[data-track-id="${track.id}"]`);
      if (currentCard) {
        currentCard.classList.add('is-playing');
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
    if (isPlaying) {
      PlayerEngine.startSeekSync();
    } else {
      PlayerEngine.stopSeekSync();
    }
  },

  updateSeekbar(current, duration) {
    if (!this.els.seekbar) return;
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
    if (this.els.noiseSlider) {
      this.els.noiseSlider.value = prefs.noiseVolume;
      this.updateDockSliderFill(this.els.noiseSlider, prefs.noiseVolume, 100);
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
