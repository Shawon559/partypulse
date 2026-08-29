/**
 * PartyPulse — Single-Page Live Party Engagement Web App
 * Tech: Vanilla JS + BroadcastChannel + localStorage
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const STORAGE_KEYS = {
    ROOMS: 'partypulse_rooms',
    SONGS_PREFIX: 'partypulse_songs_',
    VIBES_PREFIX: 'partypulse_vibes_',
    RECENT_ROOMS: 'partypulse_recent_rooms',
  };

  const VIBE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes rolling window
  const VIBE_TICK_INTERVAL_MS = 3000; // 3 seconds decay timer

  // --- State ---
  let currentRoomCode = null;
  let broadcastChannel = null;
  let vibeDecayTimer = null;
  let previousSongOrder = [];

  // --- DOM Elements ---
  const views = {
    landing: document.getElementById('view-landing'),
    room: document.getElementById('view-room'),
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
    
    // Vibe
    countFire: document.getElementById('count-fire'),
    countSleepy: document.getElementById('count-sleepy'),
    statusText: document.getElementById('vibe-status-text'),
    barFill: document.getElementById('vibe-bar-fill'),
    btnVibeFire: document.getElementById('btn-vibe-fire'),
    btnVibeSleepy: document.getElementById('btn-vibe-sleepy'),

    // Songs
    songCountBadge: document.getElementById('song-count-badge'),
    formAddSong: document.getElementById('form-add-song'),
    inputSongTitle: document.getElementById('input-song-title'),
    songErrorMsg: document.getElementById('song-error-msg'),
    emptyState: document.getElementById('queue-empty-state'),
    songList: document.getElementById('song-list'),
  };

  const toastContainer = document.getElementById('toast-container');

  // --- Storage Helper Functions ---
  const Storage = {
    getRooms() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.ROOMS);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        console.error('Failed to read rooms from localStorage:', e);
        return [];
      }
    },

    saveRooms(rooms) {
      try {
        localStorage.setItem(STORAGE_KEYS.ROOMS, JSON.stringify(rooms));
      } catch (e) {
        console.error('Failed to save rooms to localStorage:', e);
      }
    },

    roomExists(code) {
      if (!code) return false;
      const rooms = Storage.getRooms();
      return rooms.some((r) => r.code === code.toUpperCase());
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
      return newRoom;
    },

    getSongs(roomCode) {
      if (!roomCode) return [];
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.SONGS_PREFIX + roomCode);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        console.error('Failed to read songs for room:', roomCode, e);
        return [];
      }
    },

    saveSongs(roomCode, songs) {
      if (!roomCode) return;
      try {
        localStorage.setItem(STORAGE_KEYS.SONGS_PREFIX + roomCode, JSON.stringify(songs));
      } catch (e) {
        console.error('Failed to save songs for room:', roomCode, e);
      }
    },

    getVibes(roomCode) {
      if (!roomCode) return [];
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.VIBES_PREFIX + roomCode);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        console.error('Failed to read vibes for room:', roomCode, e);
        return [];
      }
    },

    saveVibes(roomCode, vibes) {
      if (!roomCode) return;
      try {
        localStorage.setItem(STORAGE_KEYS.VIBES_PREFIX + roomCode, JSON.stringify(vibes));
      } catch (e) {
        console.error('Failed to save vibes for room:', roomCode, e);
      }
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
        if (recents.length > 5) recents = recents.slice(0, 5);
        localStorage.setItem(STORAGE_KEYS.RECENT_ROOMS, JSON.stringify(recents));
      } catch (e) {}
    },
  };

  // --- Broadcast & Cross-Tab Sync Engine ---
  const SyncEngine = {
    init() {
      if (typeof window.BroadcastChannel !== 'undefined') {
        broadcastChannel = new BroadcastChannel('partypulse_sync_channel');
        broadcastChannel.onmessage = (event) => {
          SyncEngine.handleMessage(event.data);
        };
      } else {
        // Fallback for browsers without BroadcastChannel
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

      if (data.roomCode && data.roomCode !== currentRoomCode) {
        return; // Message is for another room
      }

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

        default:
          break;
      }
    },
  };

  // --- UI Toast Helper ---
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
    }, 2200);
  }

  // --- Helper: Generate 4-Letter Uppercase Code ---
  function generateRandomRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude I and O to prevent confusion
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // --- Landing View Controller ---
  const LandingController = {
    init() {
      // Auto-uppercase input
      landing.inputCode.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        LandingController.hideError();
      });

      // Create Room Click
      landing.btnCreate.addEventListener('click', () => {
        LandingController.handleCreateRoom();
      });

      // Join Room Form Submit
      landing.formJoin.addEventListener('submit', (e) => {
        e.preventDefault();
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
        landing.btnCreateText.textContent = 'Create Room';
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
        AppRouter.navigateToRoom(roomObj.code);
        showToast(`Party Room ${roomObj.code} created! 🚀`, 'success');
      }, 200);
    },

    handleJoinRoom() {
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

      if (!Storage.roomExists(code)) {
        LandingController.showError(`Room "${code}" not found. Check the code or create a new room.`);
        return;
      }

      Storage.addRecentRoom(code);
      LandingController.hideError();
      landing.inputCode.value = '';
      AppRouter.navigateToRoom(code);
      showToast(`Joined party ${code}! 🎉`, 'success');
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
        chip.textContent = code;
        chip.addEventListener('click', () => {
          AppRouter.navigateToRoom(code);
        });
        landing.recentList.appendChild(chip);
      });

      landing.recentSection.classList.remove('hidden');
    },
  };

  // --- Room View Controller ---
  const RoomController = {
    init() {
      // Copy Room Code
      room.btnCopyCode.addEventListener('click', () => {
        if (!currentRoomCode) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(currentRoomCode).then(() => {
            showToast(`Room code ${currentRoomCode} copied to clipboard! 📋`, 'success');
          }).catch(() => {
            RoomController.fallbackCopy(currentRoomCode);
          });
        } else {
          RoomController.fallbackCopy(currentRoomCode);
        }
      });

      // Leave Room
      room.btnLeave.addEventListener('click', () => {
        AppRouter.navigateToLanding();
      });

      // Vibe Buttons
      room.btnVibeFire.addEventListener('click', (e) => {
        RoomController.handleVibeTap('fire', e);
      });

      room.btnVibeSleepy.addEventListener('click', (e) => {
        RoomController.handleVibeTap('sleepy', e);
      });

      // Add Song Form
      room.formAddSong.addEventListener('submit', (e) => {
        e.preventDefault();
        RoomController.handleAddSong();
      });

      // Clear song input error on typing
      room.inputSongTitle.addEventListener('input', () => {
        RoomController.hideSongError();
      });
    },

    fallbackCopy(text) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        showToast(`Room code ${text} copied! 📋`, 'success');
      } catch (err) {
        showToast(`Room code is: ${text}`, 'info');
      }
      document.body.removeChild(textarea);
    },

    enterRoom(code) {
      currentRoomCode = code.toUpperCase();
      room.displayCode.textContent = currentRoomCode;
      RoomController.hideSongError();
      room.inputSongTitle.value = '';

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

      const newVibe = {
        id: 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        roomCode: currentRoomCode,
        value: vibeType, // 'fire' | 'sleepy'
        timestamp: Date.now(),
      };

      const vibes = Storage.getVibes(currentRoomCode);
      vibes.push(newVibe);

      // Clean up vibes older than 10 minutes from storage to prevent bloat
      const cutoff = Date.now() - 10 * 60 * 1000;
      const prunedVibes = vibes.filter((v) => v.timestamp >= cutoff);
      Storage.saveVibes(currentRoomCode, prunedVibes);

      // Broadcast to other tabs
      SyncEngine.broadcast({
        type: 'VIBE_TAPPED',
        roomCode: currentRoomCode,
        vibe: newVibe,
      });

      // Spawn floating particle animation
      RoomController.spawnParticle(vibeType === 'fire' ? '🔥' : '😴', event.currentTarget);

      RoomController.renderVibes();
    },

    spawnParticle(emoji, targetBtn) {
      if (!targetBtn) return;
      const rect = targetBtn.getBoundingClientRect();
      const particle = document.createElement('span');
      particle.className = 'vibe-particle';
      particle.textContent = emoji;

      // Center above button
      particle.style.left = `${rect.left + rect.width / 2}px`;
      particle.style.top = `${rect.top + 10}px`;

      document.body.appendChild(particle);

      setTimeout(() => {
        if (particle.parentNode) {
          particle.parentNode.removeChild(particle);
        }
      }, 950);
    },

    renderVibes() {
      if (!currentRoomCode) return;

      const vibes = Storage.getVibes(currentRoomCode);
      const now = Date.now();
      const windowStart = now - VIBE_WINDOW_MS;

      // Filter to rolling 5-minute window
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

      // Status text
      if (total === 0) {
        room.statusText.textContent = 'Party warming up...';
      } else if (firePercentage >= 65) {
        room.statusText.textContent = 'Party is ON FIRE! 🔥🔥🔥';
      } else if (firePercentage <= 35) {
        room.statusText.textContent = 'Vibe is sleepy, cue the bangers! 😴';
      } else {
        room.statusText.textContent = 'Great balance in the room! ✨';
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
        RoomController.showSongError('Please enter a song name or artist.');
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

      // Broadcast to other tabs
      SyncEngine.broadcast({
        type: 'SONG_ADDED',
        roomCode: currentRoomCode,
        song: newSong,
      });

      RoomController.renderSongs();
      showToast(`Added "${title}" to queue! 🎶`, 'success');
    },

    handleVote(songId, buttonEl) {
      if (!currentRoomCode || !songId) return;

      const songs = Storage.getSongs(currentRoomCode);
      const song = songs.find((s) => s.id === songId);
      if (!song) return;

      song.votes = (song.votes || 0) + 1;
      Storage.saveSongs(currentRoomCode, songs);

      // Micro-animation on button
      if (buttonEl) {
        buttonEl.classList.add('voted');
        const countSpan = buttonEl.querySelector('.vote-count');
        if (countSpan) {
          countSpan.classList.add('vote-pop');
          setTimeout(() => countSpan.classList.remove('vote-pop'), 300);
        }
      }

      // Broadcast to other tabs
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

      // Sort by votes descending, then createdAt ascending
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

      // Clear & render
      room.songList.innerHTML = '';

      songs.forEach((song, index) => {
        const li = document.createElement('li');
        li.className = 'song-item';
        li.dataset.id = song.id;

        // Info container
        const infoDiv = document.createElement('div');
        infoDiv.className = 'song-info';

        const rankSpan = document.createElement('span');
        rankSpan.className = 'song-rank';
        rankSpan.textContent = `#${index + 1}`;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'song-title';
        titleSpan.textContent = song.title;
        titleSpan.title = song.title;

        infoDiv.appendChild(rankSpan);
        infoDiv.appendChild(titleSpan);

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

  // --- Router & View Management ---
  const AppRouter = {
    init() {
      window.addEventListener('hashchange', () => {
        AppRouter.handleRoute();
      });

      // Handle initial route on page load
      AppRouter.handleRoute();
    },

    handleRoute() {
      const hash = window.location.hash.replace('#', '').trim().toUpperCase();
      if (hash && hash.length === 4) {
        if (Storage.roomExists(hash)) {
          AppRouter.showView('room');
          RoomController.enterRoom(hash);
        } else {
          AppRouter.showView('landing');
          LandingController.showError(`Room "${hash}" does not exist. Check code or create a new room.`);
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

  // --- Initialization ---
  document.addEventListener('DOMContentLoaded', () => {
    SyncEngine.init();
    LandingController.init();
    RoomController.init();
    AppRouter.init();
  });
})();
