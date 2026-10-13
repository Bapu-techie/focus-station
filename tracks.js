'use strict';
/**
 * FocusStation — Audio Catalog
 * Exposed on window.FOCUS_CATALOG for file:// CORS safety.
 * Embed-friendly, tested YouTube audio tracks across 4 categories.
 */
window.FOCUS_CATALOG = {

  categories: [
    {
      id: 'deep-focus',
      label: 'Deep Focus',
      icon: '◉',
      accentColor: '#0284c7',
      description: 'Indian Classical · Bansuri · Alpha Waves'
    },
    {
      id: 'code-flow',
      label: 'Code Flow',
      icon: '⌗',
      accentColor: '#7c3aed',
      description: 'Lo-Fi · Downtempo Synthwave · Binaural Beats'
    },
    {
      id: 'desk-flow',
      label: 'Desk Flow',
      icon: '◈',
      accentColor: '#059669',
      description: 'Warm Acoustic · Calm Fingerstyle Guitar'
    },
    {
      id: 'energy-reset',
      label: 'Energy Reset',
      icon: '◐',
      accentColor: '#d97706',
      description: 'Upbeat Instrumental · Post-Study Walk'
    }
  ],

  tracks: [

    // ── Deep Focus ────────────────────────────────────────────
    {
      id: 'trk_001',
      youtube_id: 'j7dPe9q-wP8',
      title: 'Raag Yaman — Meditative Bansuri Flute Flow',
      artist: 'Indian Classical Flute',
      category_id: 'deep-focus',
      duration: '1:14:20'
    },
    {
      id: 'trk_002',
      youtube_id: 'WPni755-Krg',
      title: 'Study Music — Alpha Waves for Memory & Focus',
      artist: 'Greenred Productions',
      category_id: 'deep-focus',
      duration: '3:05:47'
    },
    {
      id: 'trk_003',
      youtube_id: 'hHW1oY26kxQ',
      title: 'Relaxing Music for Study & Concentration',
      artist: 'Soothing Relaxation',
      category_id: 'deep-focus',
      duration: '1:01:41'
    },
    {
      id: 'trk_004',
      youtube_id: '4xDzrJKXOOY',
      title: 'Study Music for Brain Power & Concentration',
      artist: 'Greenred Productions',
      category_id: 'deep-focus',
      duration: '3:01:16'
    },
    {
      id: 'trk_005',
      youtube_id: 'SxNcqFl9hMM',
      title: 'Alpha Waves — Concentration & Positive Thinking',
      artist: 'Greenred Productions',
      category_id: 'deep-focus',
      duration: '3:00:07'
    },
    {
      id: 'trk_006',
      youtube_id: 'lTRiuFIWV54',
      title: 'Morning Raag — Bansuri Meditation Flow',
      artist: 'Indian Classical Music',
      category_id: 'deep-focus',
      duration: '57:22'
    },

    // ── Code Flow ─────────────────────────────────────────────
    {
      id: 'trk_007',
      youtube_id: 'jfKfPfyJRdk',
      title: 'Lofi Hip Hop Mix — Study Session Beats',
      artist: 'Lofi Girl',
      category_id: 'code-flow',
      duration: '1:00:00'
    },
    {
      id: 'trk_008',
      youtube_id: '5qap5aO4i9A',
      title: 'Lofi Hip Hop Radio — Beats to Relax/Study To',
      artist: 'Lofi Girl',
      category_id: 'code-flow',
      duration: 'LIVE'
    },
    {
      id: 'trk_009',
      youtube_id: 'n61ULEU7CO0',
      title: 'Midnight Coding — Chillhop Synthwave Mix',
      artist: 'Chillhop Music',
      category_id: 'code-flow',
      duration: '1:05:28'
    },
    {
      id: 'trk_010',
      youtube_id: 'aXItOY0sry8',
      title: 'Binaural Beats — Beta Waves 14 Hz Focus',
      artist: 'Greenred Productions',
      category_id: 'code-flow',
      duration: '3:00:00'
    },
    {
      id: 'trk_011',
      youtube_id: 'bt1us58fBQw',
      title: 'Focus Music — Deep Concentration Beats',
      artist: 'Relaxing Records',
      category_id: 'code-flow',
      duration: '1:04:15'
    },
    {
      id: 'trk_012',
      youtube_id: 'Dx5qFachd3A',
      title: 'Late Night Lo-Fi — Programming Session',
      artist: 'Chillhop Music',
      category_id: 'code-flow',
      duration: '55:30'
    },

    // ── Desk Flow ─────────────────────────────────────────────
    {
      id: 'trk_013',
      youtube_id: '77ZozI0rw7w',
      title: 'Peaceful Piano — Relaxing Background Music',
      artist: 'Soothing Relaxation',
      category_id: 'desk-flow',
      duration: '1:10:05'
    },
    {
      id: 'trk_014',
      youtube_id: 'YQZ3MFrSiWk',
      title: 'Classical Guitar — Calm Afternoon Session',
      artist: 'Relaxing Guitar Music',
      category_id: 'desk-flow',
      duration: '1:03:27'
    },
    {
      id: 'trk_015',
      youtube_id: 'iNzrwh1OGOA',
      title: 'Fingerstyle Guitar Ambient — Work From Home',
      artist: 'Guitar Relaxing',
      category_id: 'desk-flow',
      duration: '59:48'
    },
    {
      id: 'trk_016',
      youtube_id: 's_XXQrBGFyU',
      title: 'Rain Sounds + Soft Piano — Deep Work Session',
      artist: 'Yellow Brick Cinema',
      category_id: 'desk-flow',
      duration: '2:14:58'
    },
    {
      id: 'trk_017',
      youtube_id: 'Rwqq0LRYMhM',
      title: 'Solo Piano — Gentle Background for Focus',
      artist: 'Peder B. Helland',
      category_id: 'desk-flow',
      duration: '1:00:00'
    },
    {
      id: 'trk_018',
      youtube_id: 'lFEFIVf9Htg',
      title: 'Soft Acoustic Session — Desk Ambience',
      artist: 'Guitar Relaxing',
      category_id: 'desk-flow',
      duration: '45:10'
    },

    // ── Energy Reset ──────────────────────────────────────────
    {
      id: 'trk_019',
      youtube_id: '9Q634rbsypE',
      title: 'Upbeat Instrumental — Morning Walk Mix',
      artist: 'Chillhop Music',
      category_id: 'energy-reset',
      duration: '50:22'
    },
    {
      id: 'trk_020',
      youtube_id: '7NOSDKb0HlU',
      title: 'Forest Birdsong — Nature Walk Ambience',
      artist: 'Nature Relaxation Films',
      category_id: 'energy-reset',
      duration: '3:00:00'
    },
    {
      id: 'trk_021',
      youtube_id: 'xTQeVX3DLKI',
      title: 'Energizing Ambient — Post-Study Reset',
      artist: 'Relaxing Records',
      category_id: 'energy-reset',
      duration: '1:02:15'
    },
    {
      id: 'trk_022',
      youtube_id: 'NJuSStkIZBg',
      title: 'Upbeat Focus Mix — Walk & Reset',
      artist: 'Study Music Project',
      category_id: 'energy-reset',
      duration: '58:40'
    },
    {
      id: 'trk_023',
      youtube_id: 'P9PgCPHWKwk',
      title: 'Energetic Acoustic — Movement Session',
      artist: 'Guitar Upbeat',
      category_id: 'energy-reset',
      duration: '43:11'
    },
    {
      id: 'trk_024',
      youtube_id: 'xNN7iTA57jM',
      title: 'Indian Classical Energy — Raag Bhairavi',
      artist: 'Pandit Ravi Shankar',
      category_id: 'energy-reset',
      duration: '35:00'
    }

  ]
};
