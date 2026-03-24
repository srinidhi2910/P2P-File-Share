import mongoose from 'mongoose';

const transferSchema = new mongoose.Schema({
  roomId:      { type: String, required: true },
  fileName:    { type: String, required: true },
  fileSize:    { type: Number, required: true },
  fileType:    { type: String },
  completedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Transfer', transferSchema);