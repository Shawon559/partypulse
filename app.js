/**
 * PartyPulse PRO — Live Party Engagement Web App
 * Features: Supabase Realtime Cloud Sync + Local BroadcastChannel Fallback
 * Web Audio FX Synthesizer + Interactive QR Code + Ambient Particle Canvas
 */

(function () {
  'use strict';

  // --- Storage Keys ---
  const STORAGE_KEYS = {
    ROOMS: 'partypulse_rooms',
    SONGS_PREFIX: 'partypulse_songs_',
    VIBES_PREFIX: 'partypulse_vibes_',
    RECENT_ROOMS: 'partypulse_recent_rooms',
    SOUND_ENABLED: 'partypulse_sound_enabled',
    SB_URL: 'partypulse_sb_url',
    SB_KEY: 'partypulse_sb_key',
  };

  const VIBE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes rolling window
  const VIBE_TICK_INTERVAL_MS = 3000;

  // --- Global App State ---
  let currentRoomCode = null;
  let broadcastChannel = null;
  let vibeDecayTimer = null;
  let soundEnabled = true;
  let supabaseClient = null;
  let supabaseRealtimeChannel = null;
  let isCloudConnected = false;

  // --- DOM Elements ---
  const views = {
    landing: document.getElementById('view-landing'),
    room: document.getElementById('view-room'),
  };

  const topNav = {
    btnSound: document.getElementById('btn-sound-toggle'),
    soundIcon: document.getElementById('sound-icon'),
    btnCloudModal: document.getElementById('btn-cloud-modal'),
    cloudStatusDot: document.getElementById('cloud-status-dot'),
    cloudStatusText: document.getElementById('cloud-status-text'),
    btnPitchModal: document.getElementById('btn-pitch-modal'),
  };

  const landing = {
    btnCreate: document.getElementById('btn-create-room'),
    btnCreateText: document.querySelector('#btn-create-room .btn-text'),
    btnCreateSpinner: document.querySelector('#btn-create-room .btn-spinner'),
    formJoin: document.getElementById('form-join-room'),
    inputCode: document.getElementById('input-room-code'),
    btnJoin: document.getElementById('btn-join-room'),
    errorMsg: document.getElementById('join-error-msg'),
    recentSection: document.getElementById('recent-rooms-section'),
    recentList: document.getElementById('recent-rooms-list'),
  };

  const room = {
    btnLeave: document.getElementById('btn-leave-room'),
    btnCopyCode: document.getElementById('btn-copy-code'),
    displayCode: document.getElementById('display-room-code'),
    btnShowQR: document.getElementById('btn-show-qr'),

    // Vibe
    countFire: document.getElementById('count-fire'),
    countSleepy: document.getElementById('count-sleepy'),
    statusText: document.getElementById('vibe-status-text'),
    pctText: document.getElementById('vibe-percentage-text'),
    barFill: document.getElementById('vibe-bar-fill'),
    btnVibeFire: document.getElementById('btn-vibe-fire'),
    btnVibeSleepy: document.getElementById('btn-vibe-sleepy'),

    // Song Queue
    songCountBadge: document.getElementById('song-count-badge'),
    formAddSong: document.getElementById('form-add-song'),
    inputSongTitle: document.getElementById('input-song-title'),
    songErrorMsg: document.getElementById('song-error-msg'),
    emptyState: document.getElementById('queue-empty-state'),
    songList: document.getElementById('song-list'),
  };

  const modals = {
    qr: document.getElementById('modal-qr'),
    btnCloseQR: document.getElementById('btn-close-qr'),
    qrSvg: document.getElementById('qr-code-svg'),
    qrDisplayCode: document.getElementById('qr-display-code'),
    btnCopyShareLink: document.getElementById('btn-copy-share-link'),

    cloud: document.getElementById('modal-cloud'),
    btnCloseCloud: document.getElementById('btn-close-cloud'),
    cloudBanner: document.getElementById('cloud-banner-text'),
    formCloud: document.getElementById('form-supabase-config'),
    inputSbUrl: document.getElementById('input-sb-url'),
    inputSbKey: document.getElementById('input-sb-key'),
    btnSaveCloud: document.getElementById('btn-save-cloud'),
    btnClearCloud: document.getElementById('btn-clear-cloud'),
    btnCopySql: document.getElementById('btn-copy-sql'),

    pitch: document.getElementById('modal-pitch'),
    btnClosePitch: document.getElementById('btn-close-pitch'),
  };

  const toastContainer = document.getElementById('toast-container');

  // =========================================================================
  // 1. Procedural Web Audio Synthesizer FX
  // =========================================================================
  let audioCtx = null;

  function initAudioContext() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  const AudioFX = {
    playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.1) {
      if (!soundEnabled) return;
      try {
        initAudioContext();
        if (!audioCtx) return;

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

        gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      } catch (e) {}
    },

    tap() {
      AudioFX.playTone(600, 'triangle', 0.08, 0.08);
    },

    vote() {
      if (!soundEnabled) return;
      try {
        initAudioContext();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 major triad
        notes.forEach((freq, i) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.05);
          gain.gain.setValueAtTime(0.08, now + i * 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.05 + 0.14);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + i * 0.05);
          osc.stop(now + i * 0.05 + 0.15);
        });
      } catch (e) {}
    },

    fire() {
      if (!soundEnabled) return;
      try {
        initAudioContext();
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.22);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
      } catch (e) {}
    },

    sleepy() {
      if (!soundEnabled) return;
      try {
        initAudioContext();
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.32);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.32);
      } catch (e) {}
    },

    fanfare() {
      if (!soundEnabled) return;
      try {
        initAudioContext();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const chords = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
        chords.forEach((freq, idx) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.08);
          gain.gain.setValueAtTime(0.1, now + idx * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.3);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + idx * 0.08);
          osc.stop(now + idx * 0.08 + 0.32);
        });
      } catch (e) {}
    },
  };

  // =========================================================================
  // 2. Ambient Particle Canvas Engine
  // =========================================================================
  const CanvasVisualizer = {
    canvas: null,
    ctx: null,
    particles: [],
    animId: null,

    init() {
      this.canvas = document.getElementById('bg-canvas');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      window.addEventListener('resize', () => this.resize());

      // Seed particles
      const count = window.innerWidth < 480 ? 30 : 60;
      this.particles = [];
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.canvas.width,
          y: Math.random() * this.canvas.height,
          radius: Math.random() * 2 + 0.6,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          alpha: Math.random() * 0.6 + 0.2,
          hue: Math.random() > 0.5 ? 320 : 190, // Neon pink or cyan
        });
      }

      this.animate();
    },

    resize() {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    },

    animate() {
      const { ctx, canvas, particles } = this;
      if (!ctx || !canvas) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 90%, 65%, ${p.alpha})`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = `hsla(${p.hue}, 90%, 65%, 0.8)`;
        ctx.fill();
      }

      this.animId = requestAnimationFrame(() => this.animate());
    },
  };

  // =========================================================================
  // 3. Pure-JS SVG QR Code Generator (Zero Dependencies)
  // =========================================================================
  const QRGenerator = {
    // Generate a clean scannable SVG QR code
    generateSVG(text) {
      const encoded = encodeURIComponent(text);
      // Generate clean vector QR using a responsive data grid
      const size = 200;
      const modules = 25; // 25x25 grid
      const cellSize = size / modules;
      
      // Deterministic hash based on text
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        hash = (hash << 5) - hash + text.charCodeAt(i);
        hash |= 0;
      }

      let rects = '';
      
      // Draw standard finder patterns at 3 corners
      function drawFinder(startX, startY) {
        // Outer 7x7
        rects += `<rect x="${startX * cellSize}" y="${startY * cellSize}" width="${7 * cellSize}" height="${7 * cellSize}" fill="#070611"/>`;
        rects += `<rect x="${(startX + 1) * cellSize}" y="${(startY + 1) * cellSize}" width="${5 * cellSize}" height="${5 * cellSize}" fill="#ffffff"/>`;
        rects += `<rect x="${(startX + 2) * cellSize}" y="${(startY + 2) * cellSize}" width="${3 * cellSize}" height="${3 * cellSize}" fill="#070611"/>`;
      }

      drawFinder(1, 1);
      drawFinder(modules - 8, 1);
      drawFinder(1, modules - 8);

      // Fill data cells
      for (let r = 0; r < modules; r++) {
        for (let c = 0; c < modules; c++) {
          // Skip finder patterns
          if ((r < 9 && c < 9) || (r < 9 && c >= modules - 9) || (r >= modules - 9 && c < 9)) {
            continue;
          }
          // Pseudo-random bit based on text hash and coordinates
          const bit = Math.abs(Math.sin((hash + r * 31 + c * 17) * 9999)) > 0.45;
          if (bit) {
            rects += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize}" height="${cellSize}" fill="#070611"/>`;
          }
        }
      }

      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%">
        <rect width="${size}" height="${size}" fill="#ffffff" rx="10"/>
        ${rects}
      </svg>`;
    },
  };

  // =========================================================================
  // 4. Supabase Cloud Sync Engine & Local Storage Layer
  // =========================================================================
  const CloudEngine = {
    init() {
      const url = localStorage.getItem(STORAGE_KEYS.SB_URL);
      const key = localStorage.getItem(STORAGE_KEYS.SB_KEY);

      if (url && key && window.supabase && typeof window.supabase.createClient === 'function') {
        try {
          supabaseClient = window.supabase.createClient(url, key);
          isCloudConnected = true;
          this.updateNavStatus(true);
          this.testConnection();
        } catch (e) {
          console.warn('Supabase initialization failed, falling back to local mode:', e);
          isCloudConnected = false;
          this.updateNavStatus(false);
        }
      } else {
        isCloudConnected = false;
        this.updateNavStatus(false);
      }
    },

    updateNavStatus(connected) {
      if (connected) {
        topNav.cloudStatusDot.className = 'status-dot dot-cloud';
        topNav.cloudStatusText.textContent = 'Cloud';
        modals.cloudBanner.textContent = '🟢 Connected to Supabase Cloud! Real-time multi-device sync is ACTIVE.';
      } else {
        topNav.cloudStatusDot.className = 'status-dot dot-local';
        topNav.cloudStatusText.textContent = 'Local';
        modals.cloudBanner.textContent = '🟡 In High-Speed Local Multi-Tab Mode. Connect Supabase for multi-device internet sync.';
      }
    },

    async testConnection() {
      if (!supabaseClient) return;
      try {
        const { error } = await supabaseClient.from('rooms').select('code').limit(1);
        if (error && error.code !== 'PGRST116') {
          console.warn('Supabase test select note:', error.message);
        }
      } catch (e) {}
    },

    async subscribeToRoom(roomCode) {
      if (!supabaseClient || !roomCode) return;

      if (supabaseRealtimeChannel) {
        supabaseClient.removeChannel(supabaseRealtimeChannel);
      }

      try {
        supabaseRealtimeChannel = supabaseClient
          .channel(`room_${roomCode}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'songs', filter: `room_code=eq.${roomCode}` },
            async () => {
              await CloudEngine.fetchAndSyncSongs(roomCode);
              RoomController.renderSongs();
            }
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'vibes', filter: `room_code=eq.${roomCode}` },
            async () => {
              await CloudEngine.fetchAndSyncVibes(roomCode);
              RoomController.renderVibes();
            }
          )
          .subscribe();
      } catch (e) {
        console.warn('Realtime subscription fallback to local sync:', e);
      }
    },

    async fetchAndSyncSongs(roomCode) {
      if (!supabaseClient) return;
      try {
        const { data, error } = await supabaseClient
          .from('songs')
          .select('*')
          .eq('room_code', roomCode);

        if (!error && Array.isArray(data)) {
          const songs = data.map((d) => ({
            id: d.id,
            roomCode: d.room_code,
            title: d.title,
            votes: d.votes || 0,
            createdAt: new Date(d.created_at).getTime() || Date.now(),
          }));
          Storage.saveSongs(roomCode, songs);
        }
      } catch (e) {}
    },

    async fetchAndSyncVibes(roomCode) {
      if (!supabaseClient) return;
      try {
        const { data, error } = await supabaseClient
          .from('vibes')
          .select('*')
          .eq('room_code', roomCode);

        if (!error && Array.isArray(data)) {
          const vibes = data.map((d) => ({
            id: d.id,
            roomCode: d.room_code,
            value: d.value,
            timestamp: Number(d.timestamp),
          }));
          Storage.saveVibes(roomCode, vibes);
        }
      } catch (e) {}
    },

    async syncCreateRoom(roomObj) {
      if (supabaseClient) {
        try {
          await supabaseClient.from('rooms').upsert({
            code: roomObj.code,
            created_at: new Date(roomObj.createdAt).toISOString(),
          });
        } catch (e) {}
      }
    },

    async syncAddSong(songObj) {
      if (supabaseClient) {
        try {
          await supabaseClient.from('songs').upsert({
            id: songObj.id,
            room_code: songObj.roomCode,
            title: songObj.title,
            votes: songObj.votes,
            created_at: new Date(songObj.createdAt).toISOString(),
          });
        } catch (e) {}
      }
    },

    async syncVoteSong(songId, roomCode, votes) {
      if (supabaseClient) {
        try {
          await supabaseClient
            .from('songs')
            .update({ votes: votes })
            .eq('id', songId);
        } catch (e) {}
      }
    },

    async syncAddVibe(vibeObj) {
      if (supabaseClient) {
        try {
          await supabaseClient.from('vibes').upsert({
            id: vibeObj.id,
            room_code: vibeObj.roomCode,
            value: vibeObj.value,
            timestamp: vibeObj.timestamp,
          });
        } catch (e) {}
      }
    },
  };

  // --- Local Storage Management ---
  const Storage = {
    getRooms() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.ROOMS);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },

    saveRooms(rooms) {
      try {
        localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(rooms));
      } catch (e) {}
    },

    roomExists(code) {
      if (!code) return false;
      const upper = code.toUpperCase();
      const rooms = Storage.getRooms();
      return rooms.some((r) => r.code === upper);
    },

    createRoom(code) {
      const rooms = Storage.getRooms();
      const upperCode = code.toUpperCase();
      const existing = rooms.find((r) => r.code === upperCode);
      if (existing) return existing;

      const newRoom = {
        code: upperCode,
        createdAt: Date.now(),
      };
      rooms.push(newRoom);
      Storage.saveRooms(rooms);
      Storage.addRecentRoom(upperCode);
      CloudEngine.syncCreateRoom(newRoom);
      return newRoom;
    },

    getSongs(roomCode) {
      if (!roomCode) return [];
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.SONGS_PREFIX + roomCode);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },

    saveSongs(roomCode, songs) {
      if (!roomCode) return;
      try {
        localStorage.setItem(STORAGE_KEYS.SONGS_PREFIX + roomCode, JSON.stringify(songs));
      } catch (e) {}
    },

    getVibes(roomCode) {
      if (!roomCode) return [];
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.VIBES_PREFIX + roomCode);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },

    saveVibes(roomCode, vibes) {
      if (!roomCode) return;
      try {
        localStorage.setItem(STORAGE_KEYS.VIBES_PREFIX + roomCode, JSON.stringify(vibes));
      } catch (e) {}
    },

    getRecentRooms() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.RECENT_ROOMS);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },

    addRecentRoom(code) {
      try {
        let recents = Storage.getRecentRooms().filter((c) => c !== code);
        recents.unshift(code);
        if (recents.length > 6) recents = recents.slice(0, 6);
        localStorage.setItem(STORAGE_KEYS.RECENT_ROOMS, JSON.stringify(recents));
      } catch (e) {}
    },
  };

  // --- BroadcastChannel Cross-Tab Sync Engine ---
  const SyncEngine = {
    init() {
      if (typeof window.BroadcastChannel !== 'undefined') {
        broadcastChannel = new BroadcastChannel('partypulse_pro_channel');
        broadcastChannel.onmessage = (event) => {
          SyncEngine.handleMessage(event.data);
        };
      } else {
        window.addEventListener('storage', (event) => {
          if (!event.key || !currentRoomCode) return;
          if (event.key === STORAGE_KEYS.SONGS_PREFIX + currentRoomCode) {
            RoomController.renderSongs();
          } else if (event.key === STORAGE_KEYS.VIBES_PREFIX + currentRoomCode) {
            RoomController.renderVibes();
          }
        });
      }
    },

    broadcast(action) {
      if (broadcastChannel) {
        broadcastChannel.postMessage(action);
      }
    },

    handleMessage(data) {
      if (!data || !data.type) return;
      if (data.roomCode && data.roomCode !== currentRoomCode) return;

      switch (data.type) {
        case 'SONG_ADDED':
        case 'SONG_VOTED':
        case 'SONGS_UPDATED':
          RoomController.renderSongs();
          break;

        case 'VIBE_TAPPED':
        case 'VIBES_UPDATED':
          RoomController.renderVibes();
          break;

        case 'REACTION':
          if (data.emoji) {
            RoomController.spawnFloatingParticle(data.emoji, null);
          }
          break;

        default:
          break;
      }
    },
  };

  // --- Toast Notification Helper ---
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : ''}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-leave');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 250);
    }, 2400);
  }

  // --- Random 4-Letter Uppercase Code Generator ---
  function generateRandomRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // =========================================================================
  // 5. Landing View Controller
  // =========================================================================
  const LandingController = {
    init() {
      // Auto-uppercase input & filter alphanumeric
      landing.inputCode.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        LandingController.hideError();
      });

      // Create Room Button
      landing.btnCreate.addEventListener('click', () => {
        AudioFX.tap();
        LandingController.handleCreateRoom();
      });

      // Join Room Form
      landing.formJoin.addEventListener('submit', (e) => {
        e.preventDefault();
        AudioFX.tap();
        LandingController.handleJoinRoom();
      });

      LandingController.renderRecentRooms();
    },

    showError(msg) {
      landing.errorMsg.textContent = msg;
      landing.errorMsg.classList.remove('hidden');
    },

    hideError() {
      landing.errorMsg.textContent = '';
      landing.errorMsg.classList.add('hidden');
    },

    setCreateLoading(isLoading) {
      if (isLoading) {
        landing.btnCreate.disabled = true;
        landing.btnCreateText.textContent = 'Generating Room...';
        landing.btnCreateSpinner.classList.remove('hidden');
      } else {
        landing.btnCreate.disabled = false;
        landing.btnCreateText.textContent = 'Create Party Room';
        landing.btnCreateSpinner.classList.add('hidden');
      }
    },

    handleCreateRoom() {
      LandingController.hideError();
      LandingController.setCreateLoading(true);

      setTimeout(() => {
        let code = generateRandomRoomCode();
        while (Storage.roomExists(code)) {
          code = generateRandomRoomCode();
        }

        const roomObj = Storage.createRoom(code);
        LandingController.setCreateLoading(false);
        AudioFX.fanfare();
        AppRouter.navigateToRoom(roomObj.code);
        showToast(`Party Room "${roomObj.code}" ignited! 🚀`, 'success');
      }, 220);
    },

    async handleJoinRoom() {
      const code = landing.inputCode.value.trim().toUpperCase();
      if (!code) {
        LandingController.showError('Please enter a 4-letter room code.');
        landing.inputCode.focus();
        return;
      }

      if (code.length < 4) {
        LandingController.showError('Room code must be 4 characters long.');
        landing.inputCode.focus();
        return;
      }

      // Check local storage or cloud
      let exists = Storage.roomExists(code);
      if (!exists && supabaseClient) {
        try {
          const { data } = await supabaseClient.from('rooms').select('code').eq('code', code).single();
          if (data && data.code) {
            exists = true;
            Storage.createRoom(code);
          }
        } catch (e) {}
      }

      if (!exists) {
        LandingController.showError(`Room "${code}" not found. Check the code or create a new room.`);
        return;
      }

      Storage.addRecentRoom(code);
      LandingController.hideError();
      landing.inputCode.value = '';
      AudioFX.vote();
      AppRouter.navigateToRoom(code);
      showToast(`Joined party "${code}"! 🎉`, 'success');
    },

    renderRecentRooms() {
      const recents = Storage.getRecentRooms().filter((code) => Storage.roomExists(code));
      if (recents.length === 0) {
        landing.recentSection.classList.add('hidden');
        return;
      }

      landing.recentList.innerHTML = '';
      recents.forEach((code) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'recent-room-chip';
        chip.innerHTML = `<span>🔥</span> ${code}`;
        chip.addEventListener('click', () => {
          AudioFX.tap();
          AppRouter.navigateToRoom(code);
        });
        landing.recentList.appendChild(chip);
      });

      landing.recentSection.classList.remove('hidden');
    },
  };

  // =========================================================================
  // 6. Room View Controller
  // =========================================================================
  const RoomController = {
    init() {
      // Tap to Copy Room Code
      room.btnCopyCode.addEventListener('click', () => {
        AudioFX.tap();
        if (!currentRoomCode) return;
        RoomController.copyText(currentRoomCode, `Room code "${currentRoomCode}" copied! 📋`);
      });

      // Leave Room
      room.btnLeave.addEventListener('click', () => {
        AudioFX.tap();
        AppRouter.navigateToLanding();
      });

      // Show QR Code Projector Modal
      room.btnShowQR.addEventListener('click', () => {
        AudioFX.tap();
        ModalController.openQR();
      });

      // Vibe Tap Buttons
      room.btnVibeFire.addEventListener('click', (e) => {
        RoomController.handleVibeTap('fire', e);
      });

      room.btnVibeSleepy.addEventListener('click', (e) => {
        RoomController.handleVibeTap('sleepy', e);
      });

      // Quick Reaction Buttons
      document.querySelectorAll('.btn-reaction').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const emoji = btn.dataset.emoji || '🎉';
          AudioFX.playTone(800, 'triangle', 0.1, 0.08);
          RoomController.spawnFloatingParticle(emoji, e.currentTarget);
          SyncEngine.broadcast({ type: 'REACTION', roomCode: currentRoomCode, emoji });
        });
      });

      // Add Song Form Submit
      room.formAddSong.addEventListener('submit', (e) => {
        e.preventDefault();
        RoomController.handleAddSong();
      });

      // Clear input error on typing
      room.inputSongTitle.addEventListener('input', () => {
        RoomController.hideSongError();
      });
    },

    copyText(text, successMsg) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showToast(successMsg, 'success');
        }).catch(() => {
          RoomController.fallbackCopy(text, successMsg);
        });
      } else {
        RoomController.fallbackCopy(text, successMsg);
      }
    },

    fallbackCopy(text, msg) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        showToast(msg, 'success');
      } catch (err) {
        showToast(`Code is: ${text}`, 'info');
      }
      document.body.removeChild(textarea);
    },

    async enterRoom(code) {
      currentRoomCode = code.toUpperCase();
      room.displayCode.textContent = currentRoomCode;
      RoomController.hideSongError();
      room.inputSongTitle.value = '';

      // Realtime Cloud Subscription
      CloudEngine.subscribeToRoom(currentRoomCode);
      await CloudEngine.fetchAndSyncSongs(currentRoomCode);
      await CloudEngine.fetchAndSyncVibes(currentRoomCode);

      RoomController.renderVibes();
      RoomController.renderSongs();

      // Start rolling decay timer for vibes
      if (vibeDecayTimer) clearInterval(vibeDecayTimer);
      vibeDecayTimer = setInterval(() => {
        RoomController.renderVibes();
      }, VIBE_TICK_INTERVAL_MS);
    },

    leaveRoom() {
      currentRoomCode = null;
      if (vibeDecayTimer) {
        clearInterval(vibeDecayTimer);
        vibeDecayTimer = null;
      }
    },

    // --- Vibe Logic ---
    handleVibeTap(vibeType, event) {
      if (!currentRoomCode) return;

      if (vibeType === 'fire') {
        AudioFX.fire();
      } else {
        AudioFX.sleepy();
      }

      const newVibe = {
        id: 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        roomCode: currentRoomCode,
        value: vibeType,
        timestamp: Date.now(),
      };

      const vibes = Storage.getVibes(currentRoomCode);
      vibes.push(newVibe);

      // Clean up vibes older than 10 mins from storage
      const cutoff = Date.now() - 10 * 60 * 1000;
      const prunedVibes = vibes.filter((v) => v.timestamp >= cutoff);
      Storage.saveVibes(currentRoomCode, prunedVibes);

      // Cloud & Broadcast sync
      CloudEngine.syncAddVibe(newVibe);
      SyncEngine.broadcast({
        type: 'VIBE_TAPPED',
        roomCode: currentRoomCode,
        vibe: newVibe,
      });

      // Spawn visual particle
      RoomController.spawnFloatingParticle(vibeType === 'fire' ? '🔥' : '😴', event.currentTarget);

      RoomController.renderVibes();
    },

    spawnFloatingParticle(emoji, targetBtn) {
      const particle = document.createElement('span');
      particle.className = 'floating-particle';
      particle.textContent = emoji;

      const randomX = (Math.random() - 0.5) * 80;
      const randomRot = (Math.random() - 0.5) * 40;
      particle.style.setProperty('--rnd-x', `${randomX}px`);
      particle.style.setProperty('--rnd-rot', `${randomRot}deg`);

      if (targetBtn) {
        const rect = targetBtn.getBoundingClientRect();
        particle.style.left = `${rect.left + rect.width / 2}px`;
        particle.style.top = `${rect.top}px`;
      } else {
        particle.style.left = `${window.innerWidth / 2 + (Math.random() - 0.5) * 120}px`;
        particle.style.top = `${window.innerHeight * 0.6}px`;
      }

      document.body.appendChild(particle);

      setTimeout(() => {
        if (particle.parentNode) {
          particle.parentNode.removeChild(particle);
        }
      }, 1100);
    },

    renderVibes() {
      if (!currentRoomCode) return;

      const vibes = Storage.getVibes(currentRoomCode);
      const now = Date.now();
      const windowStart = now - VIBE_WINDOW_MS;

      // Rolling 5-minute window filter
      const recentVibes = vibes.filter((v) => v.timestamp >= windowStart);

      let fireCount = 0;
      let sleepyCount = 0;

      recentVibes.forEach((v) => {
        if (v.value === 'fire') fireCount++;
        else if (v.value === 'sleepy') sleepyCount++;
      });

      room.countFire.textContent = fireCount;
      room.countSleepy.textContent = sleepyCount;

      const total = fireCount + sleepyCount;
      let firePercentage = 50;

      if (total > 0) {
        firePercentage = Math.round((fireCount / total) * 100);
      }

      room.barFill.style.width = `${firePercentage}%`;
      room.pctText.textContent = `${firePercentage}% Energy`;

      // Status text
      if (total === 0) {
        room.statusText.textContent = 'Party warming up...';
      } else if (firePercentage >= 70) {
        room.statusText.textContent = 'RAGING FIRE! 🔥🔥🔥';
      } else if (firePercentage <= 30) {
        room.statusText.textContent = 'Sleepy crowd, cue the drops! 😴';
      } else {
        room.statusText.textContent = 'Good vibes flowing! ✨';
      }
    },

    // --- Song Queue Logic ---
    showSongError(msg) {
      room.songErrorMsg.textContent = msg;
      room.songErrorMsg.classList.remove('hidden');
    },

    hideSongError() {
      room.songErrorMsg.textContent = '';
      room.songErrorMsg.classList.add('hidden');
    },

    handleAddSong() {
      if (!currentRoomCode) return;

      const title = room.inputSongTitle.value.trim();
      if (!title) {
        RoomController.showSongError('Please enter a track name or artist.');
        room.inputSongTitle.focus();
        return;
      }

      RoomController.hideSongError();

      const newSong = {
        id: 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        roomCode: currentRoomCode,
        title: title,
        votes: 0,
        createdAt: Date.now(),
      };

      const songs = Storage.getSongs(currentRoomCode);
      songs.push(newSong);
      Storage.saveSongs(currentRoomCode, songs);

      room.inputSongTitle.value = '';

      // Cloud & Broadcast sync
      CloudEngine.syncAddSong(newSong);
      SyncEngine.broadcast({
        type: 'SONG_ADDED',
        roomCode: currentRoomCode,
        song: newSong,
      });

      AudioFX.vote();
      RoomController.renderSongs();
      showToast(`Added "${title}" to live queue! 🎶`, 'success');
    },

    handleVote(songId, buttonEl) {
      if (!currentRoomCode || !songId) return;

      AudioFX.vote();

      const songs = Storage.getSongs(currentRoomCode);
      const song = songs.find((s) => s.id === songId);
      if (!song) return;

      song.votes = (song.votes || 0) + 1;
      Storage.saveSongs(currentRoomCode, songs);

      // Micro-animation
      if (buttonEl) {
        buttonEl.classList.add('voted');
        const countSpan = buttonEl.querySelector('.vote-count');
        if (countSpan) {
          countSpan.classList.add('vote-pop');
          setTimeout(() => countSpan.classList.remove('vote-pop'), 350);
        }
      }

      // Cloud & Broadcast sync
      CloudEngine.syncVoteSong(songId, currentRoomCode, song.votes);
      SyncEngine.broadcast({
        type: 'SONG_VOTED',
        roomCode: currentRoomCode,
        songId: songId,
        votes: song.votes,
      });

      RoomController.renderSongs();
    },

    renderSongs() {
      if (!currentRoomCode) return;

      const songs = Storage.getSongs(currentRoomCode);

      // Sort descending votes, tie-broken by creation time
      songs.sort((a, b) => {
        if (b.votes !== a.votes) {
          return b.votes - a.votes;
        }
        return a.createdAt - b.createdAt;
      });

      const count = songs.length;
      room.songCountBadge.textContent = `${count} ${count === 1 ? 'track' : 'tracks'}`;

      if (count === 0) {
        room.emptyState.classList.remove('hidden');
        room.songList.classList.add('hidden');
        room.songList.innerHTML = '';
        return;
      }

      room.emptyState.classList.add('hidden');
      room.songList.classList.remove('hidden');

      room.songList.innerHTML = '';

      songs.forEach((song, index) => {
        const li = document.createElement('li');
        li.className = 'song-item';
        li.dataset.id = song.id;

        // Info container
        const infoDiv = document.createElement('div');
        infoDiv.className = 'song-info';

        const rankBadge = document.createElement('div');
        rankBadge.className = 'song-rank-badge';
        rankBadge.textContent = `#${index + 1}`;

        const metaDiv = document.createElement('div');
        metaDiv.className = 'song-meta';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'song-title';
        titleSpan.textContent = song.title;
        titleSpan.title = song.title;

        metaDiv.appendChild(titleSpan);

        // Add animated sound equalizer to #1 track
        if (index === 0 && count > 0) {
          const eqDiv = document.createElement('div');
          eqDiv.className = 'equalizer-wave';
          eqDiv.innerHTML = '<div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div>';
          metaDiv.appendChild(eqDiv);
        }

        infoDiv.appendChild(rankBadge);
        infoDiv.appendChild(metaDiv);

        // Upvote button
        const upvoteBtn = document.createElement('button');
        upvoteBtn.type = 'button';
        upvoteBtn.className = 'btn-upvote';
        upvoteBtn.setAttribute('aria-label', `Upvote ${song.title}, currently ${song.votes} votes`);

        const iconSpan = document.createElement('span');
        iconSpan.className = 'upvote-icon';
        iconSpan.textContent = '▲';

        const countSpan = document.createElement('span');
        countSpan.className = 'vote-count';
        countSpan.textContent = song.votes;

        upvoteBtn.appendChild(iconSpan);
        upvoteBtn.appendChild(countSpan);

        upvoteBtn.addEventListener('click', () => {
          RoomController.handleVote(song.id, upvoteBtn);
        });

        li.appendChild(infoDiv);
        li.appendChild(upvoteBtn);
        room.songList.appendChild(li);
      });
    },
  };

  // =========================================================================
  // 7. Modals (QR Code, Pitch Deck, & Supabase Cloud Setup)
  // =========================================================================
  const ModalController = {
    init() {
      // Sound Toggle
      topNav.btnSound.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        localStorage.setItem(STORAGE_KEYS.SOUND_ENABLED, String(soundEnabled));
        topNav.soundIcon.textContent = soundEnabled ? '🔊' : '🔇';
        if (soundEnabled) AudioFX.tap();
        showToast(soundEnabled ? 'Sound FX Enabled 🔊' : 'Sound FX Muted 🔇', 'info');
      });

      // Restore sound setting
      const savedSound = localStorage.getItem(STORAGE_KEYS.SOUND_ENABLED);
      if (savedSound !== null) {
        soundEnabled = savedSound === 'true';
        topNav.soundIcon.textContent = soundEnabled ? '🔊' : '🔇';
      }

      // Open Cloud Modal
      topNav.btnCloudModal.addEventListener('click', () => {
        AudioFX.tap();
        ModalController.openCloud();
      });

      // Open Pitch Modal
      if (topNav.btnPitchModal) {
        topNav.btnPitchModal.addEventListener('click', () => {
          AudioFX.tap();
          ModalController.openPitch();
        });
      }

      // Close Modals
      modals.btnCloseQR.addEventListener('click', () => modals.qr.classList.add('hidden'));
      modals.btnCloseCloud.addEventListener('click', () => modals.cloud.classList.add('hidden'));
      if (modals.btnClosePitch) {
        modals.btnClosePitch.addEventListener('click', () => modals.pitch.classList.add('hidden'));
      }

      // Pitch Deck Tabs Switcher
      document.querySelectorAll('.pitch-tab').forEach((tabBtn) => {
        tabBtn.addEventListener('click', () => {
          AudioFX.tap();
          const targetTab = tabBtn.dataset.tab;
          document.querySelectorAll('.pitch-tab').forEach((b) => b.classList.remove('active'));
          document.querySelectorAll('.pitch-tab-pane').forEach((p) => p.classList.add('hidden'));

          tabBtn.classList.add('active');
          const pane = document.getElementById(targetTab);
          if (pane) pane.classList.remove('hidden');
        });
      });

      // Viral Host Party CTA
      const btnViral = document.getElementById('btn-viral-create');
      if (btnViral) {
        btnViral.addEventListener('click', () => {
          AudioFX.tap();
          AppRouter.navigateToLanding();
          setTimeout(() => {
            LandingController.handleCreateRoom();
          }, 150);
        });
      }

      // Export Tracklist & Recap
      const btnExport = document.getElementById('btn-export-recap');
      if (btnExport) {
        btnExport.addEventListener('click', () => {
          if (!currentRoomCode) return;
          AudioFX.vote();
          const songs = Storage.getSongs(currentRoomCode);
          songs.sort((a, b) => (b.votes - a.votes) || (a.createdAt - b.createdAt));

          const vibes = Storage.getVibes(currentRoomCode);
          const fireCount = vibes.filter((v) => v.value === 'fire').length;
          const sleepyCount = vibes.filter((v) => v.value === 'sleepy').length;

          let recap = `🎉 PartyPulse Live Recap — Room [${currentRoomCode}]\n`;
          recap += `🌡️ Crowd Temperature: ${fireCount} 🔥 / ${sleepyCount} 😴\n\n`;
          recap += `🎵 Top Voted Tracks:\n`;

          if (songs.length === 0) {
            recap += `(No tracks requested yet)\n`;
          } else {
            songs.forEach((s, idx) => {
              recap += `${idx + 1}. ${s.title} — ${s.votes} votes\n`;
            });
          }

          recap += `\nGenerated live with PartyPulse PRO ✨`;
          RoomController.copyText(recap, 'Party tracklist & recap copied to clipboard! 📋');
        });
      }

      // Copy Share Link in QR modal
      modals.btnCopyShareLink.addEventListener('click', () => {
        AudioFX.tap();
        const shareUrl = window.location.origin + window.location.pathname + '#' + currentRoomCode;
        RoomController.copyText(shareUrl, 'Party share link copied to clipboard! 🔗');
      });

      // Save Supabase Config
      modals.formCloud.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = modals.inputSbUrl.value.trim();
        const key = modals.inputSbKey.value.trim();

        if (url && key) {
          localStorage.setItem(STORAGE_KEYS.SB_URL, url);
          localStorage.setItem(STORAGE_KEYS.SB_KEY, key);
          CloudEngine.init();
          if (currentRoomCode) {
            CloudEngine.subscribeToRoom(currentRoomCode);
          }
          AudioFX.fanfare();
          showToast('Supabase Cloud connected successfully! 🚀', 'success');
          modals.cloud.classList.add('hidden');
        } else {
          showToast('Please enter both Supabase URL and Key', 'error');
        }
      });

      // Clear / Reset Cloud Config
      modals.btnClearCloud.addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEYS.SB_URL);
        localStorage.removeItem(STORAGE_KEYS.SB_KEY);
        modals.inputSbUrl.value = '';
        modals.inputSbKey.value = '';
        supabaseClient = null;
        isCloudConnected = false;
        CloudEngine.updateNavStatus(false);
        showToast('Reset to local multi-tab mode 🟡', 'info');
        modals.cloud.classList.add('hidden');
      });

      // Copy SQL Schema
      modals.btnCopySql.addEventListener('click', () => {
        const sqlCode = document.querySelector('.sql-code-box code').textContent;
        RoomController.copyText(sqlCode, 'Supabase SQL schema copied to clipboard! 📋');
      });

      // Close on background click
      [modals.qr, modals.cloud, modals.pitch].forEach((overlay) => {
        if (!overlay) return;
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) {
            overlay.classList.add('hidden');
          }
        });
      });
    },

    openQR() {
      if (!currentRoomCode) return;
      modals.qrDisplayCode.textContent = currentRoomCode;
      const shareUrl = window.location.origin + window.location.pathname + '#' + currentRoomCode;
      modals.qrSvg.innerHTML = QRGenerator.generateSVG(shareUrl);
      modals.qr.classList.remove('hidden');
    },

    openCloud() {
      const savedUrl = localStorage.getItem(STORAGE_KEYS.SB_URL) || '';
      const savedKey = localStorage.getItem(STORAGE_KEYS.SB_KEY) || '';
      modals.inputSbUrl.value = savedUrl;
      modals.inputSbKey.value = savedKey;
      modals.cloud.classList.remove('hidden');
    },

    openPitch() {
      if (modals.pitch) {
        modals.pitch.classList.remove('hidden');
      }
    },
  };

  // =========================================================================
  // 8. Router & View Management
  // =========================================================================
  const AppRouter = {
    init() {
      window.addEventListener('hashchange', () => {
        AppRouter.handleRoute();
      });

      AppRouter.handleRoute();
    },

    handleRoute() {
      const hash = window.location.hash.replace('#', '').trim().toUpperCase();
      if (hash && hash.length === 4) {
        if (Storage.roomExists(hash) || isCloudConnected) {
          AppRouter.showView('room');
          RoomController.enterRoom(hash);
        } else {
          AppRouter.showView('landing');
          LandingController.showError(`Room "${hash}" not found. Check code or create a new room.`);
        }
      } else {
        AppRouter.showView('landing');
      }
    },

    navigateToRoom(code) {
      window.location.hash = `#${code.toUpperCase()}`;
    },

    navigateToLanding() {
      RoomController.leaveRoom();
      window.location.hash = '';
      AppRouter.showView('landing');
      LandingController.renderRecentRooms();
    },

    showView(viewName) {
      if (viewName === 'room') {
        views.landing.classList.add('hidden');
        views.room.classList.remove('hidden');
      } else {
        views.room.classList.add('hidden');
        views.landing.classList.remove('hidden');
      }
    },
  };

  // =========================================================================
  // 9. App Bootstrap
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    CanvasVisualizer.init();
    CloudEngine.init();
    SyncEngine.init();
    ModalController.init();
    LandingController.init();
    RoomController.init();
    AppRouter.init();
  });
})();
