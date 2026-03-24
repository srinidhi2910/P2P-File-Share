function init(roomId) {
  const socket = io();

  // wait for socket to connect first, THEN join the room
  socket.on('connect', () => {
    console.log('socket connected:', socket.id);
    socket.emit('join-room', roomId);
  });

  initWebRTC(socket, roomId);
}