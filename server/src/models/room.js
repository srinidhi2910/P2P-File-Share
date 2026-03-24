import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  roomId:    { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  isActive:  { type: Boolean, default: true },
  peerCount: { type: Number, default: 0 }
});

export default mongoose.model('Room', roomSchema);