// --- Backend URL ---
// Change this to your Railway backend URL after deploying
const BACKEND_URL = window.location.hostname === 'localhost'
  ? ''  // same origin for local dev
  : 'https://imposter-production.up.railway.app'; // <-- UPDATE THIS after Railway deploy

// --- State ---
const state = {
  socket: null,
  roomCode: null,
  playerId: null,
  playerName: null,
  isHost: false,
  players: [],
  myWord: null,
  wordRevealed: false,
  phase: 'home',
  myVote: null,
  roundNumber: 0
};

// --- Utility ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function $(id) {
  return document.getElementById(id);
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(viewId).classList.add('active');
  state.phase = viewId.replace('view-', '');
}

function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  $('toast-container').appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function getInitial(name) {
  return name.charAt(0).toUpperCase();
}

function getAvatarClass(index) {
  return `avatar-${index % 15}`;
}

function updateHostUI() {
  document.querySelectorAll('.host-only').forEach(el => {
    el.classList.toggle('hidden', !state.isHost);
  });
  document.querySelectorAll('.host-only-container').forEach(el => {
    el.classList.toggle('hidden', !state.isHost);
  });
  // Show waiting messages for non-hosts
  const lobbyWaiting = $('lobby-waiting');
  const resultsWaiting = $('results-waiting');
  if (lobbyWaiting) lobbyWaiting.classList.toggle('hidden', state.isHost);
  if (resultsWaiting) resultsWaiting.classList.toggle('hidden', state.isHost);
}

function updateRoomInfo() {
  const info = $('room-info');
  if (state.roomCode) {
    info.classList.remove('hidden');
    $('room-code-display').textContent = state.roomCode;
  } else {
    info.classList.add('hidden');
  }
}

// --- Player Rendering ---
function renderPlayerList(players, containerId, options = {}) {
  const container = $(containerId);
  if (!container) return;

  container.innerHTML = players.map((p, i) => {
    const isMe = p.socketId === state.socket.id;
    const classes = ['player-card'];
    if (!p.connected) classes.push('disconnected');
    if (options.ranks && i < 3) classes.push(`rank-${i + 1}`);
    if (p.isImposter && options.showImposter) classes.push('imposter-card');

    let badges = '';
    if (p.isHost) badges += '<span class="badge host">HOST</span>';
    if (isMe) badges += '<span class="badge you">YOU</span>';
    if (p.isImposter && options.showImposter) badges += '<span class="badge imposter-badge">IMPOSTER</span>';

    let scoreHtml = '';
    if (options.showScore) {
      scoreHtml = `<span class="player-score">${p.score} pts</span>`;
    }
    if (options.showDelta && p.delta !== undefined) {
      const deltaClass = p.delta > 0 ? 'positive' : 'zero';
      const deltaText = p.delta > 0 ? `+${p.delta}` : '0';
      scoreHtml += `<span class="score-delta ${deltaClass}">${deltaText}</span>`;
    }

    let kickHtml = '';
    if (options.showKick && state.isHost && !p.isHost && !isMe) {
      kickHtml = `<button class="btn-kick" data-sid="${p.socketId}">Kick</button>`;
    }

    return `
      <div class="${classes.join(' ')}">
        <div class="player-avatar ${getAvatarClass(i)}">${escapeHtml(getInitial(p.name))}</div>
        <span class="player-name">${escapeHtml(p.name)}</span>
        ${badges}
        ${scoreHtml}
        ${kickHtml}
      </div>
    `;
  }).join('');

  // Attach kick handlers
  if (options.showKick) {
    container.querySelectorAll('.btn-kick').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sid = e.target.dataset.sid;
        state.socket.emit('kick-player', { targetSocketId: sid });
      });
    });
  }
}

function renderVoteGrid(players) {
  const container = $('vote-players');
  container.innerHTML = players.map((p, i) => {
    const isMe = p.socketId === state.socket.id;
    return `
      <div class="vote-card" data-sid="${p.socketId}">
        <div class="player-avatar ${getAvatarClass(i)}">${escapeHtml(getInitial(p.name))}</div>
        <span class="vote-name">${escapeHtml(p.name)}${isMe ? ' (You)' : ''}</span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.vote-card').forEach(card => {
    card.addEventListener('click', () => {
      if (state.myVote) return; // already voted
      const sid = card.dataset.sid;
      state.myVote = sid;

      // Visual feedback
      container.querySelectorAll('.vote-card').forEach(c => c.classList.add('disabled'));
      card.classList.remove('disabled');
      card.classList.add('selected');

      // Show who we voted for
      const votedPlayer = state.players.find(p => p.socketId === sid);
      if (votedPlayer) {
        $('my-vote-name').textContent = votedPlayer.name;
        $('my-vote-display').classList.remove('hidden');
      }

      state.socket.emit('cast-vote', { targetSocketId: sid });
    });
  });
}

// --- Socket Setup ---
function initSocket() {
  const socket = io(BACKEND_URL, {
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  state.socket = socket;

  socket.on('connect', () => {
    // Try to rejoin if we have session data
    const savedRoom = sessionStorage.getItem('roomCode');
    const savedPlayerId = sessionStorage.getItem('playerId');
    if (savedRoom && savedPlayerId && state.phase === 'home') {
      socket.emit('rejoin-room', { roomCode: savedRoom, playerId: savedPlayerId });
    }
  });

  socket.on('room-created', ({ roomCode, playerId, players }) => {
    state.roomCode = roomCode;
    state.playerId = playerId;
    state.isHost = true;
    state.players = players;

    sessionStorage.setItem('roomCode', roomCode);
    sessionStorage.setItem('playerId', playerId);

    $('lobby-room-code').textContent = roomCode;
    $('lobby-player-count').textContent = players.length;
    renderPlayerList(players, 'lobby-players', { showKick: true, showScore: true });

    updateRoomInfo();
    updateHostUI();
    showView('view-lobby');
    showToast('Room created!', 'success');
  });

  socket.on('room-joined', ({ roomCode, playerId, players, isHost }) => {
    state.roomCode = roomCode;
    state.playerId = playerId;
    state.isHost = isHost;
    state.players = players;

    sessionStorage.setItem('roomCode', roomCode);
    sessionStorage.setItem('playerId', playerId);

    $('lobby-room-code').textContent = roomCode;
    $('lobby-player-count').textContent = players.length;
    renderPlayerList(players, 'lobby-players', { showKick: false, showScore: true });

    updateRoomInfo();
    updateHostUI();
    showView('view-lobby');
    showToast('Joined room!', 'success');
  });

  socket.on('player-joined', ({ playerName, playerCount, players }) => {
    state.players = players;
    $('lobby-player-count').textContent = playerCount;
    renderPlayerList(players, 'lobby-players', { showKick: true, showScore: true });
    showToast(`${playerName} joined`, 'info');
  });

  socket.on('player-left', ({ playerName, playerCount, players }) => {
    state.players = players;
    if (state.phase === 'lobby') {
      $('lobby-player-count').textContent = playerCount;
      renderPlayerList(players, 'lobby-players', { showKick: true, showScore: true });
    } else if (state.phase === 'playing') {
      renderPlayerList(players, 'playing-players', { showScore: false });
    }
    showToast(`${playerName} left`, 'info');
  });

  socket.on('player-rejoined', ({ playerName, players }) => {
    state.players = players;
    showToast(`${playerName} reconnected`, 'success');
    // Re-render current view's player list
    if (state.phase === 'lobby') {
      renderPlayerList(players, 'lobby-players', { showKick: true, showScore: true });
    } else if (state.phase === 'playing') {
      renderPlayerList(players, 'playing-players', { showScore: false });
    }
  });

  socket.on('round-started', ({ roundNumber, category, players }) => {
    state.roundNumber = roundNumber;
    state.players = players;
    state.myWord = null;
    state.wordRevealed = false;
    state.myVote = null;

    $('round-number').textContent = roundNumber;
    $('category-hint').textContent = category;

    // Reset word display
    $('btn-reveal').classList.remove('hidden');
    $('word-display').classList.add('hidden');
    $('my-word').textContent = '';
    $('my-word').className = '';

    renderPlayerList(players, 'playing-players', { showScore: false });
    updateHostUI();
    showView('view-playing');
  });

  socket.on('word-revealed', ({ word }) => {
    state.myWord = word;
    state.wordRevealed = true;

    $('btn-reveal').classList.add('hidden');
    $('word-display').classList.remove('hidden');

    const wordEl = $('my-word');
    wordEl.textContent = word;
    wordEl.className = word === 'IMPOSTER' ? 'imposter' : 'regular';
  });

  socket.on('voting-started', ({ players }) => {
    state.myVote = null;
    state.players = players;

    $('my-vote-display').classList.add('hidden');
    $('vote-progress-fill').style.width = '0%';
    $('vote-count-text').textContent = `0 / ${players.length} votes`;

    renderVoteGrid(players);
    updateHostUI();
    showView('view-voting');
  });

  socket.on('vote-cast', ({ voterName, voteCount, totalExpected }) => {
    const pct = Math.round((voteCount / totalExpected) * 100);
    $('vote-progress-fill').style.width = `${pct}%`;
    $('vote-count-text').textContent = `${voteCount} / ${totalExpected} votes`;
  });

  socket.on('results', (data) => {
    state.players = data.scores;

    // Announcement
    const announcement = $('result-announcement');
    if (data.imposterCaught) {
      announcement.className = 'result-announcement caught';
      announcement.innerHTML = `
        <h2>Imposter Caught!</h2>
        <p>${escapeHtml(data.imposterName)} was the imposter</p>
      `;
    } else if (data.isTie) {
      announcement.className = 'result-announcement escaped';
      announcement.innerHTML = `
        <h2>It's a Tie!</h2>
        <p>The imposter ${escapeHtml(data.imposterName)} escapes!</p>
      `;
    } else {
      announcement.className = 'result-announcement escaped';
      announcement.innerHTML = `
        <h2>Imposter Escaped!</h2>
        <p>${escapeHtml(data.imposterName)} fooled everyone</p>
      `;
    }

    // Word reveal
    $('result-word').textContent = data.word;
    $('result-category').textContent = data.category;

    // Vote breakdown
    const breakdown = $('vote-breakdown');
    if (data.votes.length > 0) {
      breakdown.innerHTML = `
        <p class="vote-breakdown-title">Vote Breakdown</p>
        ${data.votes.map(v => `
          <div class="vote-row">
            <span>${escapeHtml(v.voter)}</span>
            <span class="arrow">&rarr;</span>
            <span>${escapeHtml(v.votedFor)}</span>
          </div>
        `).join('')}
      `;
    } else {
      breakdown.innerHTML = '';
    }

    // Scoreboard
    renderPlayerList(data.scores, 'scoreboard', {
      ranks: true,
      showScore: true,
      showDelta: true,
      showImposter: true
    });

    updateHostUI();
    showView('view-results');
  });

  socket.on('game-ended', ({ finalScores, players }) => {
    state.players = players;
    state.isHost = players.some(p => p.socketId === socket.id && p.isHost);

    // Reset to lobby
    $('lobby-room-code').textContent = state.roomCode;
    $('lobby-player-count').textContent = players.length;
    renderPlayerList(players, 'lobby-players', { showKick: true, showScore: true });

    updateHostUI();
    showView('view-lobby');
    showToast('Game ended! Scores reset.', 'info');
  });

  socket.on('host-changed', ({ newHostName, newHostSocketId, players }) => {
    state.players = players;
    state.isHost = newHostSocketId === socket.id;

    updateHostUI();
    showToast(`${newHostName} is now the host`, 'info');

    // Re-render current view's player list
    if (state.phase === 'lobby') {
      renderPlayerList(players, 'lobby-players', { showKick: true, showScore: true });
    }
  });

  socket.on('reconnected', (data) => {
    state.roomCode = data.roomCode;
    state.playerId = data.playerId;
    state.isHost = data.isHost;
    state.players = data.players;
    state.roundNumber = data.roundNumber;

    updateRoomInfo();
    updateHostUI();

    switch (data.phase) {
      case 'lobby':
        $('lobby-room-code').textContent = data.roomCode;
        $('lobby-player-count').textContent = data.players.length;
        renderPlayerList(data.players, 'lobby-players', { showKick: true, showScore: true });
        showView('view-lobby');
        break;
      case 'playing':
        $('round-number').textContent = data.roundNumber;
        $('category-hint').textContent = data.category;
        $('btn-reveal').classList.remove('hidden');
        $('word-display').classList.add('hidden');
        renderPlayerList(data.players, 'playing-players', { showScore: false });
        showView('view-playing');
        break;
      case 'voting':
        renderVoteGrid(data.players.map(p => ({
          socketId: p.socketId,
          name: p.name
        })));
        showView('view-voting');
        break;
      case 'results':
        showView('view-results');
        break;
      default:
        showView('view-lobby');
    }

    showToast('Reconnected!', 'success');
  });

  socket.on('error', ({ message }) => {
    showToast(message, 'error');
  });

  socket.on('disconnect', () => {
    showToast('Disconnected. Reconnecting...', 'error');
  });

  return socket;
}

// --- Event Listeners ---
function setupEventListeners() {
  // Home - Create
  $('btn-create').addEventListener('click', () => {
    const name = $('input-name').value.trim();
    if (!name) {
      showToast('Please enter your name', 'error');
      $('input-name').focus();
      return;
    }
    state.playerName = name;
    state.socket.emit('create-room', { playerName: name });
  });

  // Home - Join
  $('btn-join').addEventListener('click', () => {
    const name = $('input-name').value.trim();
    const code = $('input-room-code').value.trim().toUpperCase();
    if (!name) {
      showToast('Please enter your name', 'error');
      $('input-name').focus();
      return;
    }
    if (!code || code.length !== 4) {
      showToast('Enter a 4-character room code', 'error');
      $('input-room-code').focus();
      return;
    }
    state.playerName = name;
    state.socket.emit('join-room', { roomCode: code, playerName: name });
  });

  // Allow Enter to submit
  $('input-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-create').click();
  });
  $('input-room-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-join').click();
  });

  // Lobby - Start Round
  $('btn-start').addEventListener('click', () => {
    state.socket.emit('start-round');
  });

  // Playing - Reveal Word
  $('btn-reveal').addEventListener('click', () => {
    state.socket.emit('reveal-word');
  });

  // Playing - Hide Word
  $('btn-hide-word').addEventListener('click', () => {
    $('word-display').classList.add('hidden');
    $('btn-reveal').classList.remove('hidden');
    $('btn-reveal').querySelector('span:last-child').textContent = 'Tap to Reveal Again';
  });

  // Playing - Start Vote
  $('btn-start-vote').addEventListener('click', () => {
    state.socket.emit('start-vote');
  });

  // Voting - Force Results
  $('btn-force-results').addEventListener('click', () => {
    state.socket.emit('force-results');
  });

  // Results - Next Round
  $('btn-next-round').addEventListener('click', () => {
    state.socket.emit('next-round');
  });

  // Results - End Game
  $('btn-end-game').addEventListener('click', () => {
    state.socket.emit('end-game');
  });
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  setupEventListeners();
});
