import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import roomHandler from './api/room.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Statik fayllar (index.html)
app.use(express.static('.'));

// API route
app.all('/api/room', roomHandler);
app.all('/api/room/*', (req, res) => {
  req.url = '/api/room';
  roomHandler(req, res);
});

// Bot webhook (agar kerak bo'lsa)
// app.all('/api/webhook', webhookHandler);

app.listen(PORT, () => {
  console.log(`🚀 Server ishga tushdi: http://localhost:${PORT}`);
});