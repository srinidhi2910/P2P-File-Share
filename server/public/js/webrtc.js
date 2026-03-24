let peerConnection = null;
let dataChannel = null;
let currentSocket = null;
let currentRoomId = null;

// file receiving state
let incomingFile = null;
let receivedChunks = [];
let receivedSize = 0;

const CHUNK_SIZE = 16 * 1024;

const iceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

function initWebRTC(socket, roomId) {
  currentSocket = socket;
  currentRoomId = roomId;

  socket.on('room-status', (status) => {
    if (status === 'waiting') {
      document.getElementById('status').textContent = 'Waiting for peer to join...';
      document.getElementById('status-dot').className = 'dot waiting';
    } else if (status === 'ready') {
      document.getElementById('status').textContent = 'Joined room, setting up connection...';
    }
  });

  socket.on('room-full', () => {
    document.getElementById('status').textContent = 'Room is full. Only 2 peers allowed.';
    document.getElementById('status-dot').className = 'dot disconnected';
  });

  socket.on('peer-joined', async (peerId) => {
    console.log('peer joined, creating offer...');
    await createPeerConnection(socket, roomId);

    dataChannel = peerConnection.createDataChannel('file-transfer');
    setupDataChannel(dataChannel);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('send-offer', { roomId, offer });
  });

  socket.on('receive-offer', async ({ offer }) => {
    console.log('received offer, creating answer...');
    await createPeerConnection(socket, roomId);

    peerConnection.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
    };

    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('send-answer', { roomId, answer });
  });

  socket.on('receive-answer', async ({ answer }) => {
    await peerConnection.setRemoteDescription(answer);
  });

  socket.on('ice-candidate', async ({ candidate }) => {
    if (candidate && peerConnection) {
      await peerConnection.addIceCandidate(candidate);
    }
  });
}

async function createPeerConnection(socket, roomId) {
  peerConnection = new RTCPeerConnection(iceConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { roomId, candidate: event.candidate });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('connection state:', peerConnection.connectionState);
  };
}

function setupDataChannel(channel) {
  channel.binaryType = 'arraybuffer';

  channel.onopen = () => {
    console.log('DataChannel is open!');
    document.getElementById('status').textContent = 'Peer connected! Ready to send files.';
    document.getElementById('status-dot').className = 'dot connected';
    document.getElementById('send-section').style.display = 'block';
  };

  channel.onclose = () => {
    document.getElementById('status').textContent = 'Peer disconnected.';
    document.getElementById('status-dot').className = 'dot disconnected';
    document.getElementById('send-section').style.display = 'none';
  };

  channel.onmessage = (event) => {
    handleIncomingMessage(event.data);
  };
}

// ─── SENDING ───────────────────────────────────────────

function sendFile(file) {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    alert('No peer connected yet');
    return;
  }

  // send metadata first
  const metadata = JSON.stringify({
    type: 'metadata',
    name: file.name,
    size: file.size,
    fileType: file.type
  });
  dataChannel.send(metadata);

  let offset = 0;
  const reader = new FileReader();

  reader.onload = (e) => {
    dataChannel.send(e.target.result);
    offset += e.target.result.byteLength;

    // update send progress bar
    const percent = Math.floor((offset / file.size) * 100);
    document.getElementById('progress-wrap').style.display = 'block';
    document.getElementById('progress-bar').style.width = percent + '%';
    document.getElementById('progress-percent').textContent = percent + '%';
    document.getElementById('progress-text').textContent = 'Sending ' + file.name + '...';

    if (offset < file.size) {
      readNextChunk();
    } else {
      // done sending
      dataChannel.send(JSON.stringify({ type: 'transfer-complete' }));
      document.getElementById('progress-text').textContent = 'Sent successfully!';
      document.getElementById('progress-percent').textContent = '100%';
      document.getElementById('progress-bar').style.width = '100%';

      // save to MongoDB via server
      currentSocket.emit('transfer-complete', {
        roomId: currentRoomId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
      });
    }
  };

  function readNextChunk() {
    if (dataChannel.bufferedAmount > 5 * CHUNK_SIZE) {
      setTimeout(readNextChunk, 50);
      return;
    }
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    reader.readAsArrayBuffer(slice);
  }

  readNextChunk();
}

// ─── RECEIVING ─────────────────────────────────────────

function handleIncomingMessage(data) {
  if (typeof data === 'string') {
    const message = JSON.parse(data);

    if (message.type === 'metadata') {
      incomingFile = message;
      receivedChunks = [];
      receivedSize = 0;
      document.getElementById('receive-progress-wrap').style.display = 'block';
      document.getElementById('receive-text').textContent = 'Receiving ' + message.name + '...';
    }

    if (message.type === 'transfer-complete') {
      const blob = new Blob(receivedChunks, { type: incomingFile.fileType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = incomingFile.name;
      a.click();
      URL.revokeObjectURL(url);
      document.getElementById('receive-text').textContent = 'Saved: ' + incomingFile.name;
      document.getElementById('receive-percent').textContent = '100%';
      document.getElementById('receive-bar').style.width = '100%';
    }

  } else {
    // binary chunk
    receivedChunks.push(data);
    receivedSize += data.byteLength;

    if (incomingFile) {
      const percent = Math.floor((receivedSize / incomingFile.size) * 100);
      document.getElementById('receive-progress-wrap').style.display = 'block';
      document.getElementById('receive-bar').style.width = percent + '%';
      document.getElementById('receive-percent').textContent = percent + '%';
      document.getElementById('receive-text').textContent = 'Receiving ' + incomingFile.name + '...';
    }
  }
}

// ─── HELPERS ───────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}