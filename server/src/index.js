import { nanoid } from 'nanoid';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import 'dotenv/config';
import connectDB from './config/db.js';
import Room from './models/room.js';
import Transfer from './models/transfer.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// connect to MongoDB first
await connectDB();

const app = express();
app.use(helmet({
  contentSecurityPolicy: false
}));
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20 // max 20 requests per minute
});

app.use(limiter);
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*' }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// ─── ROUTES ────────────────────────────────────────────

app.get('/', (req, res) => {
  res.render('home');
});

app.get('/room/:roomId', (req, res) => {
  res.render('room', { roomId: req.params.roomId });
});

app.get('/history', async (req, res) => {
  const transfers = await Transfer.find().sort({ completedAt: -1 }).limit(50);
  res.render('history', { transfers });
});

// ─── SOCKETS ───────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('client connected:', socket.id);

socket.on('join-room', async (roomId) => {
  const room = io.sockets.adapter.rooms.get(roomId);
  const numPeers = room ? room.size : 0;

  // FIRST check limit
  if (numPeers >= 2) {
    socket.emit('room-full');
    return;
  }

  // THEN join
  socket.join(roomId);
  console.log(`${socket.id} joined room ${roomId}, peers: ${numPeers + 1}`);

  if (numPeers === 0) {
    await Room.findOneAndUpdate(
      { roomId },
      { roomId, isActive: true, peerCount: 1 },
      { upsert: true, returnDocument: 'after' }
    );
    socket.emit('room-status', 'waiting');

  } else if (numPeers === 1) {
    await Room.findOneAndUpdate({ roomId }, { peerCount: 2 });
    socket.to(roomId).emit('peer-joined', socket.id);
    socket.emit('room-status', 'ready');
  }
});
  socket.on('send-offer', ({ roomId, offer }) => {
    socket.to(roomId).emit('receive-offer', { offer, from: socket.id });
  });

  socket.on('send-answer', ({ roomId, answer }) => {
    socket.to(roomId).emit('receive-answer', { answer });
  });

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('ice-candidate', { candidate });
  });

  // client tells server when a transfer completes
  socket.on('transfer-complete', async ({ roomId, fileName, fileSize, fileType }) => {
    await Transfer.create({ roomId, fileName, fileSize, fileType });
    console.log(`transfer saved: ${fileName} in room ${roomId}`);
  });

  socket.on('disconnect', async () => {
    console.log('client disconnected:', socket.id);
  });
});

app.get('/create-room', (req, res) => {
  const roomId = nanoid(8);
  res.redirect('/room/' + roomId);
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`server running on http://localhost:${PORT}`);
});