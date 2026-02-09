const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const WORD_LIST = require('./public/words.js');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  pingTimeout: 10000,
  pingInterval: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GRACE_PERIOD_MS = 60000;
const MAX_PLAYERS = 15;
const MIN_PLAYERS = 3;

// --- Utility Functions ---

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function pickRandomWord(room) {
  const categories = Object.keys(WORD_LIST);
  let attempts = 0;
  let category, word;
  do {
    category = categories[Math.floor(Math.random() * categories.length)];
    const words = WORD_LIST[category];
    word = words[Math.floor(Math.random() * words.length)];
    attempts++;
    if (attempts > 100) {
      room.usedWords.clear();
      break;
    }
  } while (room.usedWords.has(word));
  room.usedWords.add(word);
  return { category, word };
}

function getPlayerList(room) {
  return Array.from(room.players.values()).map(p => ({
    socketId: p.socketId,
    name: p.name,
    isHost: p.isHost,
    score: p.score,
    connected: p.connected
  }));
}

function getConnectedPlayers(room) {
  return Array.from(room.players.values()).filter(p => p.connected);
}

function migrateHost(room) {
  const connected = getConnectedPlayers(room);
  if (connected.length === 0) {
    rooms.delete(room.code);
    return;
  }
  const newHost = connected[0];
  newHost.isHost = true;
  room.hostSocketId = newHost.socketId;
  io.to(room.code).emit('host-changed', {
    newHostName: newHost.name,
    newHostSocketId: newHost.socketId,
    players: getPlayerList(room)
  });
}

function tallyVotes(room) {
  const voteCounts = new Map();
  for (const player of room.players.values()) {
    if (player.vote) {
      voteCounts.set(player.vote, (voteCounts.get(player.vote) || 0) + 1);
    }
  }

  let maxVotes = 0;
  let accused = null;
  let isTie = false;
  for (const [socketId, count] of voteCounts) {
    if (count > maxVotes) {
      maxVotes = count;
      accused = socketId;
      isTie = false;
    } else if (count === maxVotes) {
      isTie = true;
    }
  }

  const imposterCaught = !isTie && accused === room.imposterId;
  return { accused, imposterCaught, isTie, voteCounts };
}

function calculateScores(room, imposterCaught) {
  const changes = [];
  for (const player of room.players.values()) {
    let delta = 0;
    if (imposterCaught && !player.isImposter) {
      delta = 1;
    } else if (!imposterCaught && player.isImposter) {
      delta = 3;
    }
    player.score += delta;
    changes.push({
      socketId: player.socketId,
      name: player.name,
      score: player.score,
      delta,
      isImposter: player.isImposter
    });
  }
  changes.sort((a, b) => b.score - a.score);
  return changes;
}

function buildResultsPayload(room) {
  const { accused, imposterCaught, isTie } = tallyVotes(room);
  const scores = calculateScores(room, imposterCaught);

  const imposter = Array.from(room.players.values()).find(p => p.isImposter);
  const accusedPlayer = accused ? room.players.get(accused) : null;

  const votes = [];
  for (const player of room.players.values()) {
    if (player.vote) {
      const target = room.players.get(player.vote);
      votes.push({
        voter: player.name,
        votedFor: target ? target.name : 'Unknown'
      });
    }
  }

  room.phase = 'results';

  return {
    imposterName: imposter ? imposter.name : 'Unknown',
    imposterSocketId: room.imposterId,
    imposterCaught,
    isTie,
    accusedName: accusedPlayer ? accusedPlayer.name : null,
    word: room.currentWord,
    category: room.currentCategory,
    votes,
    scores
  };
}

// --- Socket.IO Event Handlers ---

io.on('connection', (socket) => {

  socket.on('create-room', ({ playerName }) => {
    const name = (playerName || '').trim().slice(0, 20);
    if (!name) {
      socket.emit('error', { message: 'Please enter a name.' });
      return;
    }

    const code = generateRoomCode();
    const playerId = uuidv4();
    const player = {
      id: playerId,
      name,
      socketId: socket.id,
      isHost: true,
      word: null,
      isImposter: false,
      hasRevealed: false,
      vote: null,
      score: 0,
      connected: true,
      disconnectTimer: null
    };

    const room = {
      code,
      hostSocketId: socket.id,
      phase: 'lobby',
      players: new Map(),
      currentWord: null,
      currentCategory: null,
      imposterId: null,
      roundNumber: 0,
      usedWords: new Set(),
      maxPlayers: MAX_PLAYERS
    };

    room.players.set(socket.id, player);
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.playerId = playerId;

    socket.emit('room-created', {
      roomCode: code,
      playerId,
      players: getPlayerList(room)
    });
  });

  socket.on('join-room', ({ roomCode, playerName }) => {
    const name = (playerName || '').trim().slice(0, 20);
    if (!name) {
      socket.emit('error', { message: 'Please enter a name.' });
      return;
    }

    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', { message: 'Room not found.' });
      return;
    }
    if (room.phase !== 'lobby' && room.phase !== 'results') {
      socket.emit('error', { message: 'Game in progress. Wait for the next round.' });
      return;
    }
    if (room.players.size >= room.maxPlayers) {
      socket.emit('error', { message: 'Room is full (max 15 players).' });
      return;
    }

    const playerId = uuidv4();
    const player = {
      id: playerId,
      name,
      socketId: socket.id,
      isHost: false,
      word: null,
      isImposter: false,
      hasRevealed: false,
      vote: null,
      score: 0,
      connected: true,
      disconnectTimer: null
    };

    room.players.set(socket.id, player);
    socket.join(code);
    socket.roomCode = code;
    socket.playerId = playerId;

    socket.emit('room-joined', {
      roomCode: code,
      playerId,
      players: getPlayerList(room),
      isHost: false
    });

    socket.to(code).emit('player-joined', {
      playerName: name,
      playerCount: room.players.size,
      players: getPlayerList(room)
    });
  });

  socket.on('start-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    if (room.hostSocketId !== socket.id) {
      socket.emit('error', { message: 'Only the host can start the round.' });
      return;
    }
    if (room.phase !== 'lobby' && room.phase !== 'results') {
      socket.emit('error', { message: 'Cannot start round in current phase.' });
      return;
    }

    const connected = getConnectedPlayers(room);
    if (connected.length < MIN_PLAYERS) {
      socket.emit('error', { message: `Need at least ${MIN_PLAYERS} players to start.` });
      return;
    }

    room.roundNumber++;
    room.phase = 'playing';

    const { category, word } = pickRandomWord(room);
    room.currentWord = word;
    room.currentCategory = category;

    const playerArray = connected;
    const imposterIndex = Math.floor(Math.random() * playerArray.length);

    // Reset all players for this round
    for (const player of room.players.values()) {
      player.word = null;
      player.isImposter = false;
      player.hasRevealed = false;
      player.vote = null;
    }

    // Assign words to connected players
    playerArray.forEach((player, i) => {
      player.word = (i === imposterIndex) ? 'IMPOSTER' : word;
      player.isImposter = (i === imposterIndex);
    });

    room.imposterId = playerArray[imposterIndex].socketId;

    io.to(room.code).emit('round-started', {
      roundNumber: room.roundNumber,
      category,
      players: getPlayerList(room)
    });
  });

  socket.on('reveal-word', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'playing') return;

    const player = room.players.get(socket.id);
    if (!player || !player.word) return;

    player.hasRevealed = true;
    socket.emit('word-revealed', { word: player.word });
  });

  socket.on('start-vote', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    if (room.hostSocketId !== socket.id) {
      socket.emit('error', { message: 'Only the host can start the vote.' });
      return;
    }
    if (room.phase !== 'playing') {
      socket.emit('error', { message: 'Cannot start vote in current phase.' });
      return;
    }

    room.phase = 'voting';

    // Reset votes
    for (const player of room.players.values()) {
      player.vote = null;
    }

    const votablePlayers = getConnectedPlayers(room).map(p => ({
      socketId: p.socketId,
      name: p.name
    }));

    io.to(room.code).emit('voting-started', { players: votablePlayers });
  });

  socket.on('cast-vote', ({ targetSocketId }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'voting') return;

    const player = room.players.get(socket.id);
    if (!player || player.vote) return; // already voted

    const target = room.players.get(targetSocketId);
    if (!target) return;

    player.vote = targetSocketId;

    const connected = getConnectedPlayers(room);
    const votesCast = connected.filter(p => p.vote).length;
    const totalExpected = connected.length;

    io.to(room.code).emit('vote-cast', {
      voterName: player.name,
      voteCount: votesCast,
      totalExpected
    });

    // Auto-resolve when all votes are in
    if (votesCast >= totalExpected) {
      const results = buildResultsPayload(room);
      io.to(room.code).emit('results', results);
    }
  });

  socket.on('force-results', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    if (room.hostSocketId !== socket.id) return;
    if (room.phase !== 'voting') return;

    const results = buildResultsPayload(room);
    io.to(room.code).emit('results', results);
  });

  socket.on('next-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    if (room.hostSocketId !== socket.id) return;
    if (room.phase !== 'results') return;

    // Trigger start-round logic
    socket.emit('phase-update', { phase: 'lobby' });
    room.phase = 'results'; // keep in results so start-round validates correctly
    // Directly start the next round
    const connected = getConnectedPlayers(room);
    if (connected.length < MIN_PLAYERS) {
      socket.emit('error', { message: `Need at least ${MIN_PLAYERS} players to continue.` });
      return;
    }

    room.roundNumber++;
    room.phase = 'playing';

    const { category, word } = pickRandomWord(room);
    room.currentWord = word;
    room.currentCategory = category;

    const playerArray = connected;
    const imposterIndex = Math.floor(Math.random() * playerArray.length);

    for (const player of room.players.values()) {
      player.word = null;
      player.isImposter = false;
      player.hasRevealed = false;
      player.vote = null;
    }

    playerArray.forEach((player, i) => {
      player.word = (i === imposterIndex) ? 'IMPOSTER' : word;
      player.isImposter = (i === imposterIndex);
    });

    room.imposterId = playerArray[imposterIndex].socketId;

    io.to(room.code).emit('round-started', {
      roundNumber: room.roundNumber,
      category,
      players: getPlayerList(room)
    });
  });

  socket.on('end-game', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    if (room.hostSocketId !== socket.id) return;

    const finalScores = Array.from(room.players.values())
      .map(p => ({ name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score);

    // Reset scores
    for (const player of room.players.values()) {
      player.score = 0;
      player.word = null;
      player.isImposter = false;
      player.hasRevealed = false;
      player.vote = null;
    }

    room.phase = 'lobby';
    room.roundNumber = 0;
    room.currentWord = null;
    room.currentCategory = null;
    room.imposterId = null;
    room.usedWords.clear();

    io.to(room.code).emit('game-ended', {
      finalScores,
      players: getPlayerList(room)
    });
  });

  socket.on('kick-player', ({ targetSocketId }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    if (room.hostSocketId !== socket.id) return;
    if (room.phase !== 'lobby') return;

    const target = room.players.get(targetSocketId);
    if (!target || target.isHost) return;

    room.players.delete(targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('error', { message: 'You were kicked from the room.' });
      targetSocket.leave(room.code);
      targetSocket.roomCode = null;
    }

    io.to(room.code).emit('player-left', {
      playerName: target.name,
      playerCount: room.players.size,
      players: getPlayerList(room)
    });
  });

  socket.on('rejoin-room', ({ roomCode, playerId }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', { message: 'Room no longer exists.' });
      return;
    }

    // Find the player by their UUID
    let existingPlayer = null;
    let oldSocketId = null;
    for (const [sid, player] of room.players) {
      if (player.id === playerId) {
        existingPlayer = player;
        oldSocketId = sid;
        break;
      }
    }

    if (!existingPlayer) {
      socket.emit('error', { message: 'Session expired. Please rejoin.' });
      return;
    }

    // Clear disconnect timer
    if (existingPlayer.disconnectTimer) {
      clearTimeout(existingPlayer.disconnectTimer);
      existingPlayer.disconnectTimer = null;
    }

    // Move player to new socket
    room.players.delete(oldSocketId);
    existingPlayer.socketId = socket.id;
    existingPlayer.connected = true;
    room.players.set(socket.id, existingPlayer);

    if (existingPlayer.isHost) {
      room.hostSocketId = socket.id;
    }

    // Update imposter reference if needed
    if (room.imposterId === oldSocketId) {
      room.imposterId = socket.id;
    }

    // Update vote references
    for (const player of room.players.values()) {
      if (player.vote === oldSocketId) {
        player.vote = socket.id;
      }
    }

    socket.join(code);
    socket.roomCode = code;
    socket.playerId = playerId;

    socket.emit('reconnected', {
      roomCode: code,
      playerId,
      phase: room.phase,
      isHost: existingPlayer.isHost,
      players: getPlayerList(room),
      roundNumber: room.roundNumber,
      category: room.currentCategory,
      hasWord: !!existingPlayer.word,
      myVote: existingPlayer.vote
    });

    socket.to(code).emit('player-rejoined', {
      playerName: existingPlayer.name,
      players: getPlayerList(room)
    });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    player.connected = false;

    io.to(room.code).emit('player-left', {
      playerName: player.name,
      playerCount: getConnectedPlayers(room).length,
      players: getPlayerList(room)
    });

    // Check if we need to resolve voting
    if (room.phase === 'voting') {
      const connected = getConnectedPlayers(room);
      const votesCast = connected.filter(p => p.vote).length;
      if (votesCast >= connected.length && connected.length > 0) {
        const results = buildResultsPayload(room);
        io.to(room.code).emit('results', results);
      }
    }

    // Grace period before removal
    player.disconnectTimer = setTimeout(() => {
      const currentRoom = rooms.get(socket.roomCode);
      if (!currentRoom) return;

      const wasHost = player.isHost;
      currentRoom.players.delete(socket.id);

      if (currentRoom.players.size === 0) {
        rooms.delete(currentRoom.code);
        return;
      }

      if (wasHost) {
        migrateHost(currentRoom);
      }

      io.to(currentRoom.code).emit('player-left', {
        playerName: player.name,
        playerCount: getConnectedPlayers(currentRoom).length,
        players: getPlayerList(currentRoom)
      });
    }, GRACE_PERIOD_MS);
  });
});

// Room cleanup interval
setInterval(() => {
  for (const [code, room] of rooms) {
    const connected = getConnectedPlayers(room);
    if (connected.length === 0) {
      const allDisconnected = Array.from(room.players.values())
        .every(p => !p.connected);
      if (allDisconnected) {
        rooms.delete(code);
      }
    }
  }
}, 60000);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Imposter Game running on http://localhost:${PORT}`);
});
