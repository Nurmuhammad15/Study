// ================================================================
// TELEGRAM USER - Foydalanuvchi ma'lumotlarini olish
// ================================================================
function getTelegramUser() {
  try {
    if (window.Telegram && window.Telegram.WebApp) {
      const user = window.Telegram.WebApp.initDataUnsafe?.user;
      if (user) {
        let fullName = user.first_name || '';
        if (user.last_name) fullName += ' ' + user.last_name;
        if (user.username) fullName += ' (@' + user.username + ')';
        return {
          id: user.id,
          first_name: user.first_name || '',
          last_name: user.last_name || '',
          username: user.username || '',
          full_name: fullName,
          photo_url: user.photo_url || ''
        };
      }
    }
    const params = new URLSearchParams(window.location.search);
    const name = params.get('name');
    if (name) {
      return {
        full_name: decodeURIComponent(name),
        username: params.get('username') || '',
        id: params.get('user_id') || ''
      };
    }
    return null;
  } catch(e) {
    console.warn('Telegram user error:', e);
    return null;
  }
}

// ================================================================
// STATE
// ================================================================
let roomToken = null, myRole = null, myName = null;
let roomId = null, peerRoomId = null, roomInfo = null;
let localStream = null, myPeer = null, myPeerId = null;
let camOn = true, micOn = true, screenSharing = false, screenStream = null;
let peers = {}, participantsList = [];
let chatMessages = [];
let timerInterval = null, startTime = null, syncInterval = null;

// ================================================================
// VIEW SWITCH - faqat ustoz
// ================================================================
function switchView(view) {
  if (myRole !== 'teacher') return;
  const vv = document.getElementById('video-view');
  const ba = document.getElementById('board-area');
  const tvb = document.getElementById('tab-video-btn');
  const tbb = document.getElementById('tab-board-btn');
  if (view === 'board') {
    vv.style.display = 'none';
    ba.style.display = 'flex';
    ba.classList.add('active');
    if (tvb) tvb.classList.remove('active');
    if (tbb) tbb.classList.add('active');
    void ba.offsetHeight;
    requestAnimationFrame(() => { void ba.offsetHeight; resizeCanvas(); });
  } else {
    vv.style.display = '';
    ba.style.display = 'none';
    ba.classList.remove('active');
    if (tvb) tvb.classList.add('active');
    if (tbb) tbb.classList.remove('active');
  }
  broadcastBoard({ type: 'view_switch', view });
}

// ================================================================
// WHITEBOARD - faqat ustoz
// ================================================================
let tool = 'pen';
let brushColor = '#1a1a1a';
let brushSize = 3;
let drawing = false;
let startX = 0, startY = 0;
let snapshot = null;
let history = [];
let redoStack = [];
let boardBg = '#ffffff';
let canvasReady = false;

const canvas = document.getElementById('board-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const area = document.getElementById('board-area');
  const toolbar = area.querySelector('.board-toolbar');
  const w = area.offsetWidth;
  const tbH = toolbar.offsetHeight || 48;
  const h = area.offsetHeight - tbH;

  if (w < 10 || h < 10) {
    setTimeout(resizeCanvas, 100);
    return;
  }

  canvas.style.top = tbH + 'px';
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  const tmp = document.createElement('canvas');
  tmp.width = canvas.width || w;
  tmp.height = canvas.height || h;
  if (canvas.width > 0 && canvas.height > 0) {
    tmp.getContext('2d').drawImage(canvas, 0, 0);
  }

  canvas.width = w;
  canvas.height = h;

  ctx.fillStyle = boardBg;
  ctx.fillRect(0, 0, w, h);

  if (tmp.width > 0 && tmp.height > 0) {
    ctx.drawImage(tmp, 0, 0);
  }
  canvasReady = true;
  
  if (myRole === 'teacher') {
    broadcastBoard({ type: 'snapshot', data: canvas.toDataURL('image/jpeg', 0.7) });
  }
}

function saveHistory() {
  history.push(canvas.toDataURL());
  if (history.length > 50) history.shift();
  redoStack = [];
}

function undoBoard() {
  if (myRole !== 'teacher') return;
  if (!history.length) return;
  redoStack.push(canvas.toDataURL());
  const img = new Image();
  img.onload = () => { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0); };
  img.src = history.pop();
}

function redoBoard() {
  if (myRole !== 'teacher') return;
  if (!redoStack.length) return;
  history.push(canvas.toDataURL());
  const img = new Image();
  img.onload = () => { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0); };
  img.src = redoStack.pop();
}

function clearBoard() {
  if (myRole !== 'teacher') return;
  saveHistory();
  ctx.fillStyle = boardBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  broadcastBoard({type:'clear'});
}

function downloadBoard() {
  if (myRole !== 'teacher') return;
  const a = document.createElement('a');
  a.download = 'doska-' + Date.now() + '.png';
  a.href = canvas.toDataURL();
  a.click();
}

function setTool(t) {
  if (myRole !== 'teacher') return;
  tool = t;
  document.querySelectorAll('.tb-btn[id^="tool-"]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tool-' + t);
  if (btn) btn.classList.add('active');
  canvas.style.cursor = t === 'eraser' ? 'cell' : t === 'text' ? 'text' : t === 'select' ? 'default' : 'crosshair';
}

function setColor(el) {
  if (myRole !== 'teacher') return;
  brushColor = el.dataset.color;
  document.querySelectorAll('.tb-color').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('custom-color').value = brushColor;
}

function setCustomColor(val) {
  if (myRole !== 'teacher') return;
  brushColor = val;
  document.querySelectorAll('.tb-color').forEach(c => c.classList.remove('active'));
}

function setBrushSize(v) {
  if (myRole !== 'teacher') return;
  brushSize = parseInt(v);
  document.getElementById('brush-size-val').textContent = v;
}

function setBg(color) {
  if (myRole !== 'teacher') return;
  boardBg = color;
  document.querySelectorAll('#bg-white,#bg-black,#bg-cream,#bg-blue').forEach(el => el.classList.remove('active'));
  const map = {'#ffffff':'bg-white','#0f1117':'bg-black','#fefce8':'bg-cream','#eff6ff':'bg-blue'};
  if (map[color]) document.getElementById(map[color]).classList.add('active');
  if (!canvasReady) return;
  saveHistory();
  const tmp = document.createElement('canvas');
  tmp.width = canvas.width; tmp.height = canvas.height;
  tmp.getContext('2d').drawImage(canvas, 0, 0);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tmp, 0, 0);
  broadcastBoard({ type: 'snapshot', data: canvas.toDataURL('image/jpeg', 0.7) });
}

function getPos(e) {
  const r = canvas.getBoundingClientRect();
  if (e.touches) {
    return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
  }
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function drawShape(x, y) {
  ctx.putImageData(snapshot, 0, 0);
  ctx.strokeStyle = brushColor;
  ctx.lineWidth = brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (tool === 'line') {
    ctx.moveTo(startX, startY);
    ctx.lineTo(x, y);
    ctx.stroke();
  } else if (tool === 'rect') {
    ctx.strokeRect(startX, startY, x - startX, y - startY);
  } else if (tool === 'circle') {
    const rx = Math.abs(x - startX) / 2;
    const ry = Math.abs(y - startY) / 2;
    const cx = startX + (x - startX) / 2;
    const cy = startY + (y - startY) / 2;
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tool === 'arrow') {
    const dx = x - startX, dy = y - startY;
    const angle = Math.atan2(dy, dx);
    const len = 14 + brushSize * 1.5;
    ctx.moveTo(startX, startY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * Math.cos(angle - 0.4), y - len * Math.sin(angle - 0.4));
    ctx.lineTo(x - len * Math.cos(angle + 0.4), y - len * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fillStyle = brushColor;
    ctx.fill();
  }
}

let textActive = false;
function placeTextInput(x, y) {
  if (myRole !== 'teacher') return;
  const ti = document.getElementById('board-text-input');
  const area = document.getElementById('board-area');
  const tb = area.querySelector('.board-toolbar');
  ti.style.display = 'block';
  ti.style.left = x + 'px';
  ti.style.top = (y + tb.offsetHeight) + 'px';
  ti.style.fontSize = Math.max(14, brushSize * 4) + 'px';
  ti.style.color = brushColor;
  ti.value = '';
  ti.focus();
  textActive = true;
}

function commitText() {
  if (myRole !== 'teacher') return;
  const ti = document.getElementById('board-text-input');
  if (!ti.value.trim()) { ti.style.display = 'none'; textActive = false; return; }
  const area = document.getElementById('board-area');
  const tb = area.querySelector('.board-toolbar');
  const x = parseInt(ti.style.left);
  const y = parseInt(ti.style.top) - tb.offsetHeight;
  saveHistory();
  ctx.fillStyle = brushColor;
  ctx.font = `${Math.max(14, brushSize * 4)}px -apple-system, sans-serif`;
  const lines = ti.value.split('\n');
  const lh = Math.max(14, brushSize * 4) * 1.3;
  lines.forEach((line, i) => ctx.fillText(line, x, y + lh * (i + 1)));
  broadcastBoard({type:'text', text:ti.value, x, y, color:brushColor, fontSize:Math.max(14,brushSize*4)});
  ti.style.display = 'none';
  ti.value = '';
  textActive = false;
}

function handleTextInput(e) {
  if (myRole !== 'teacher') return;
  if (e.key === 'Escape') { document.getElementById('board-text-input').style.display = 'none'; textActive = false; }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
}

// ================================================================
// BOARD EVENTS - faqat ustoz
// ================================================================
canvas.addEventListener('mousedown', e => {
  if (myRole !== 'teacher' || !canvasReady) return;
  e.preventDefault();
  if (tool === 'text') { placeTextInput(...Object.values(getPos(e))); return; }
  if (textActive) commitText();
  saveHistory();
  drawing = true;
  const {x, y} = getPos(e);
  startX = x; startY = y;
  snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (tool === 'pen' || tool === 'eraser') {
    ctx.beginPath();
    ctx.moveTo(x, y);
    queueStroke({op:'begin', x, y, color: brushColor, size: brushSize});
  }
});

canvas.addEventListener('mousemove', e => {
  if (myRole !== 'teacher' || !drawing) return;
  const {x, y} = getPos(e);
  if (tool === 'pen') {
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    queueStroke({op:'move', x, y, color: brushColor, size: brushSize});
  } else if (tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = brushSize * 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.globalCompositeOperation = 'source-over';
    queueStroke({op:'move', x, y, color: brushColor, size: brushSize * 3, eraser: true});
  } else {
    drawShape(x, y);
  }
});

canvas.addEventListener('mouseup', () => { drawing = false; });
canvas.addEventListener('mouseleave', () => { drawing = false; });

canvas.addEventListener('touchstart', e => { if (myRole !== 'teacher') return; e.preventDefault(); canvas.dispatchEvent(new MouseEvent('mousedown', {clientX: e.touches[0].clientX, clientY: e.touches[0].clientY})); }, {passive:false});
canvas.addEventListener('touchmove', e => { if (myRole !== 'teacher') return; e.preventDefault(); canvas.dispatchEvent(new MouseEvent('mousemove', {clientX: e.touches[0].clientX, clientY: e.touches[0].clientY})); }, {passive:false});
canvas.addEventListener('touchend', e => { if (myRole !== 'teacher') return; e.preventDefault(); canvas.dispatchEvent(new MouseEvent('mouseup', {})); }, {passive:false});

// ================================================================
// KEYBOARD SHORTCUTS - faqat ustoz
// ================================================================
document.addEventListener('keydown', e => {
  if (myRole !== 'teacher') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoBoard(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redoBoard(); }
  if (e.key === 'p') setTool('pen');
  if (e.key === 'e') setTool('eraser');
  if (e.key === 'l') setTool('line');
  if (e.key === 'r') setTool('rect');
  if (e.key === 'c') setTool('circle');
  if (e.key === 't') setTool('text');
  if (e.key === 'a') setTool('arrow');
});

window.addEventListener('resize', () => {
  const ba = document.getElementById('board-area');
  if (ba.classList.contains('active') && ba.style.display !== 'none') {
    canvasReady = false;
    resizeCanvas();
  }
});

function initCanvas() {
  canvasReady = false;
  resizeCanvas();
}

// ================================================================
// LOGIN
// ================================================================
function extractToken(input) {
  input = (input || '').trim();
  if (!input) return { token: null, role: null };
  try {
    const url = new URL(input);
    const t = url.searchParams.get('t');
    const s = url.searchParams.get('s');
    if (t) return { token: t, role: 'teacher' };
    if (s) return { token: s, role: 'student' };
  } catch {}
  if (input.includes('.')) return { token: input, role: null };
  return { token: null, role: null };
}

async function doEnter() {
  const input = document.getElementById('link-input').value;
  const errEl = document.getElementById('login-err');
  const btn = document.querySelector('.login-btn');
  errEl.textContent = '';
  const { token, role } = extractToken(input);
  if (!token) {
    errEl.innerHTML = "Havola noto'g'ri. Botdan kelgan to'liq havolani kiriting.";
    document.getElementById('link-input').focus();
    return;
  }
  btn.innerHTML = '<div class="loader-ring" style="width:18px;height:18px;border-width:2px"></div> Tekshirilmoqda...';
  btn.disabled = true;
  try {
    const tgUser = getTelegramUser();
    let userName = '';
    if (tgUser && tgUser.full_name) {
      userName = tgUser.full_name;
    }
    
    const r = await fetch('/api/room?action=info', { headers: { 'X-Room-Token': token } });
    const d = await r.json();
    btn.innerHTML = 'Darsga kirish';
    btn.disabled = false;
    if (!d.ok) { errEl.innerHTML = esc(d.msg || "Havola noto'g'ri yoki muddati o'tgan"); return; }
    
    roomToken = token;
    myRole = role || d.user.role || 'student';
    
    if (userName) {
      myName = userName;
    } else {
      myName = d.user.name || 'Foydalanuvchi';
    }
    
    if (myRole === 'teacher' && !userName) {
      myName += ' (Ustoz)';
    }
    
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';
    await enterRoom(d);
  } catch(e) {
    btn.innerHTML = 'Darsga kirish';
    btn.disabled = false;
    errEl.innerHTML = "Server bilan aloqa yo'q. Qayta urinib ko'ring.";
  }
}

// ================================================================
// INIT
// ================================================================
async function init() {
  const params = new URLSearchParams(window.location.search);
  const tToken = params.get('t');
  const sToken = params.get('s');
  roomToken = tToken || sToken || null;
  myRole = tToken ? 'teacher' : 'student';

  if (!roomToken) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('login-page').style.display = 'flex';
    setTimeout(() => document.getElementById('link-input').focus(), 150);
    return;
  }
  window.history.replaceState({}, '', window.location.pathname);
  try {
    const r = await fetch('/api/room?action=info', { headers: { 'X-Room-Token': roomToken } });
    const d = await r.json();
    if (!d.ok) { showError('', 'Kirish rad etildi', d.msg); return; }
    await enterRoom(d);
  } catch(e) {
    showError('', 'Ulanish xatosi', "Server bilan ulanib bo'lmadi.");
  }
}

async function enterRoom(d) {
  roomInfo = d.room;
  myRole = myRole || d.user.role;
  
  const tgUser = getTelegramUser();
  if (tgUser && tgUser.full_name) {
    myName = tgUser.full_name;
    if (myRole === 'teacher' && !tgUser.full_name.includes('Ustoz')) {
      myName += ' (Ustoz)';
    }
  } else {
    myName = d.user.name || 'Foydalanuvchi';
    if (myRole === 'teacher') {
      myName += ' (Ustoz)';
    }
  }
  
  roomId = d.room.id;
  peerRoomId = d.room.peer_room_id;
  document.getElementById('room-title-text').textContent = roomInfo.title;
  
  const roomEl = document.getElementById('room');
  if (myRole === 'teacher') {
    roomEl.classList.add('teacher-mode');
    roomEl.classList.remove('student-mode');
  } else {
    roomEl.classList.add('student-mode');
    roomEl.classList.remove('teacher-mode');
  }
  
  await getMedia();
}

// ================================================================
// ULASHISH - faqat ustoz
// ================================================================
async function shareRoomLink() {
  if (myRole !== 'teacher') {
    showToast('❌ Faqat ustoz ulashishi mumkin');
    return;
  }
  
  try {
    let userName = myName || 'Ustoz';
    const tgUser = getTelegramUser();
    if (tgUser && tgUser.full_name) {
      userName = tgUser.full_name;
    }
    
    const roomLink = window.location.href.split('?')[0] + '?t=' + roomToken;
    
    const shareText = `👨‍🏫 ${userName} sizni darsga taklif qiladi!\n\n` +
                      `📚 Dars: ${roomInfo?.title || 'Dars xonasi'}\n` +
                      `🔗 Havola: ${roomLink}\n\n` +
                      `📱 Telegram orqali kiring!`;
    
    if (navigator.share) {
      await navigator.share({
        title: 'Study - Darsga taklif',
        text: shareText,
        url: roomLink
      });
      showToast('✅ Havola ulashildi!');
    } else {
      await navigator.clipboard.writeText(shareText);
      showToast('✅ Havola nusxalandi!');
    }
  } catch(e) {
    try {
      const roomLink = window.location.href.split('?')[0] + '?t=' + roomToken;
      await navigator.clipboard.writeText(roomLink);
      showToast('✅ Havola nusxalandi!');
    } catch(err) {
      showToast('❌ Havolani nusxalab bo\'lmadi');
    }
  }
}

// ================================================================
// MEDIA
// ================================================================
async function getMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 }
    });
    camOn = true;
    micOn = true;
  } catch(e1) {
    console.warn('Video+audio failed:', e1.name, e1.message);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      camOn = false;
      micOn = true;
      showToast('Kamera ruxsat berilmagan — faqat mikrofon');
    } catch(e2) {
      console.warn('Audio only failed:', e2.name);
      localStream = new MediaStream();
      camOn = false;
      micOn = false;
      showToast('Kamera va mikrofon topilmadi yoki ruxsat berilmagan');
    }
  }
  updateBtnState();
  startPeer();
}

async function toggleCam() {
  camOn = !camOn;
  if (localStream) {
    localStream.getVideoTracks().forEach(t => { t.enabled = camOn; });
  }
  updateBtnState();
  rebuildGrid();
  showToast(camOn ? 'Kamera yoqildi' : 'Kamera o\'chirildi');
}

function toggleMic() {
  micOn = !micOn;
  if (localStream) {
    localStream.getAudioTracks().forEach(t => { t.enabled = micOn; });
  }
  updateBtnState();
  showToast(micOn ? 'Mikrofon yoqildi' : 'Mikrofon o\'chirildi');
}

async function toggleScreen() {
  if (myRole !== 'teacher') return;
  if (screenSharing) { stopScreen(); return; }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const track = screenStream.getVideoTracks()[0];
    Object.values(peers).forEach(p => {
      const sender = p.call?.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(track);
    });
    const myTile = document.getElementById('tile-' + myPeerId?.replace(/[^a-z0-9]/gi,'_'));
    if (myTile) { const v = myTile.querySelector('video'); v.srcObject = new MediaStream([track]); v.play().catch(()=>{}); }
    track.onended = stopScreen;
    screenSharing = true;
    document.getElementById('btn-screen').className = 'ctrl-btn screen-on';
    showToast('Ekran ulashish boshlandi');
  } catch { showToast('Ekran ulashish bekor qilindi'); }
}

function stopScreen() {
  if (myRole !== 'teacher') return;
  screenSharing = false;
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  if (localStream) {
    const camTrack = localStream.getVideoTracks()[0];
    if (camTrack) {
      Object.values(peers).forEach(p => {
        const sender = p.call?.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(camTrack);
      });
      const myTile = document.getElementById('tile-' + myPeerId?.replace(/[^a-z0-9]/gi,'_'));
      if (myTile) { const v = myTile.querySelector('video'); v.srcObject = localStream; v.play().catch(()=>{}); }
    }
  }
  const sb = document.getElementById('btn-screen');
  if (sb) sb.className = 'ctrl-btn on';
  showToast("Ekran ulashish to'xtatildi");
}

function updateBtnState() {
  document.getElementById('btn-cam').className = 'ctrl-btn ' + (camOn ? 'on' : 'off');
  document.getElementById('btn-mic').className = 'ctrl-btn ' + (micOn ? 'on' : 'off');
}

// ================================================================
// PEER
// ================================================================
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

let peerRetries = 0;

function startPeer() {
  const peerId = (myRole === 'teacher' ? 'tr-' : 'st-') + peerRoomId + '-' + Math.random().toString(36).slice(2,8);
  myPeer = new Peer(peerId, {
    debug: 1,
    config: { iceServers: ICE_SERVERS, iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' }
  });
  myPeer.on('open', id => {
    myPeerId = id;
    peerRetries = 0;
    listenDataConns();
    showRoom();
    joinRoomServer();
    syncInterval = setInterval(syncParticipants, 5000);
    startTimer();
  });
  myPeer.on('call', call => { call.answer(localStream || new MediaStream()); handleCall(call); });
  myPeer.on('error', e => {
    console.warn('PeerJS error:', e.type);
    if (e.type === 'unavailable-id') { setTimeout(startPeer, 800); }
    else if (['network','server-error','socket-error','socket-closed'].includes(e.type)) {
      peerRetries++;
      setTimeout(startPeer, Math.min(1000 * peerRetries, 8000));
    }
  });
  myPeer.on('disconnected', () => {
    setTimeout(() => { if (myPeer && !myPeer.destroyed) myPeer.reconnect(); }, 1500);
  });
}

function handleCall(call) {
  const pid = call.peer;
  try { if (peers[pid]?.call) peers[pid].call.close(); } catch(e) {}
  peers[pid] = { call, stream: null, name: peers[pid]?.name || '...', role: peers[pid]?.role || '?' };

  call.on('stream', s => {
    if (!s || s.getTracks().length === 0) return;
    peers[pid].stream = s;
    rebuildGrid();
    let tries = 0;
    const tryPlay = () => {
      const tileId = '#tile-' + pid.replace(/[^a-z0-9]/gi,'_') + ' video';
      const el = document.querySelector(tileId);
      if (el) {
        el.srcObject = s;
        el.play().catch(() => {});
      } else if (tries++ < 5) {
        setTimeout(tryPlay, 400);
      }
    };
    setTimeout(tryPlay, 200);
  });

  call.on('close',  () => { delete peers[pid]; rebuildGrid(); updateParticipants(); });
  call.on('error',  (e) => { console.warn('call error', pid, e); delete peers[pid]; rebuildGrid(); });
}

async function connectToPeer(peerId) {
  if (!myPeer || !myPeerId || peerId === myPeerId) return;
  const shouldCall = myPeerId < peerId;
  if (!shouldCall) {
    if (!peers[peerId]) {
      peers[peerId] = { call: null, stream: null, name: '...', role: '?' };
    }
    setTimeout(() => openDataConn(peerId), 800);
    return;
  }
  if (peers[peerId]?.call?.open) return;
  peers[peerId] = { call: null, stream: null, name: peers[peerId]?.name || '...', role: peers[peerId]?.role || '?' };

  try {
    const stream = localStream && localStream.getTracks().length > 0
      ? localStream
      : new MediaStream();
    const call = myPeer.call(peerId, stream);
    if (!call) { delete peers[peerId]; return; }
    peers[peerId].call = call;

    call.on('stream', s => {
      if (!s || s.getTracks().length === 0) return;
      peers[peerId].stream = s;
      rebuildGrid();
      let tries = 0;
      const tryPlay = () => {
        const el = document.querySelector('#tile-' + peerId.replace(/[^a-z0-9]/gi,'_') + ' video');
        if (el) { el.srcObject = s; el.play().catch(()=>{}); }
        else if (tries++ < 5) setTimeout(tryPlay, 400);
      };
      setTimeout(tryPlay, 200);
    });
    call.on('close',  () => { delete peers[peerId]; rebuildGrid(); });
    call.on('error',  (e) => { console.warn('call err', peerId, e); delete peers[peerId]; rebuildGrid(); });
  } catch(e) { console.warn('connectToPeer error:', e); delete peers[peerId]; }

  setTimeout(() => openDataConn(peerId), 800);
}

// ================================================================
// SERVER SIGNALING
// ================================================================
async function joinRoomServer() {
  try {
    const r = await fetch('/api/room?action=join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Token': roomToken },
      body: JSON.stringify({ peer_id: myPeerId, name: myName })
    });
    const d = await r.json();
    if (d.ok) handleParticipants(d.participants || []);
  } catch {}
}

let lastParticipantCount = 0;
let heartbeatFails = 0;
let syncTick = 0;

async function syncParticipants() {
  if (!roomToken || !myPeerId) return;
  syncTick++;
  const doFullJoin = syncTick % 3 === 0 || lastParticipantCount === 0;

  try {
    if (doFullJoin) {
      const r = await fetch('/api/room?action=join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Room-Token': roomToken },
        body: JSON.stringify({ peer_id: myPeerId, name: myName })
      });
      if (r.status === 404 || r.status === 401 || r.status === 403) {
        if (myRole !== 'teacher') { clearInterval(syncInterval); syncInterval = null; showRoomClosed(); }
        return;
      }
      const d = await r.json();
      if (d.ok) {
        heartbeatFails = 0;
        lastParticipantCount = (d.participants || []).length;
        handleParticipants(d.participants || []);
      }
    } else {
      const r = await fetch('/api/room?action=heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Room-Token': roomToken },
        body: JSON.stringify({ peer_id: myPeerId })
      });
      if (r.status === 404 || r.status === 401 || r.status === 403) {
        if (myRole !== 'teacher') { clearInterval(syncInterval); syncInterval = null; showRoomClosed(); }
        return;
      }
      heartbeatFails = 0;
    }
  } catch {
    heartbeatFails++;
    if (heartbeatFails >= 3) { syncTick = 0; heartbeatFails = 0; }
  }
}

function showRoomClosed() {
  if (localStream)  { localStream.getTracks().forEach(t => t.stop()); }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); }
  Object.values(peers).forEach(p => p.call?.close());
  if (myPeer) { myPeer.destroy(); myPeer = null; }
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  document.getElementById('room').style.display = 'none';
  const el = document.getElementById('error-page');
  document.getElementById('err-icon').textContent  = '';
  document.getElementById('err-title').textContent = 'Dars yakunlandi';
  document.getElementById('err-sub').textContent   = 'Ustoz darsni tugatdi. Ushbu havola endi ishlamaydi.';
  document.querySelector('#error-page .error-btn').style.display = 'none';
  el.style.display = 'flex';
}

function handleParticipants(list) {
  participantsList = list;
  const activePeerIds = new Set(list.map(p => p.peer_id));
  
  Object.keys(peers).forEach(pid => {
    if (pid !== myPeerId && !activePeerIds.has(pid)) {
      try { peers[pid]?.call?.close(); } catch(e) {}
      delete peers[pid];
    }
  });
  
  list.forEach(p => {
    if (p.peer_id === myPeerId) return;
    const existing = peers[p.peer_id];
    const needsConnect = !existing
      || !existing.call
      || existing.call.peerConnection?.connectionState === 'closed'
      || existing.call.peerConnection?.connectionState === 'failed';
    if (needsConnect) {
      connectToPeer(p.peer_id);
    }
    if (peers[p.peer_id]) {
      peers[p.peer_id].name = p.name || peers[p.peer_id].name;
      peers[p.peer_id].role = p.role || peers[p.peer_id].role;
    }
  });
  
  updateParticipants();
  rebuildGrid();
}

// ================================================================
// VIDEO GRID
// ================================================================
function rebuildGrid() {
  const grid = document.getElementById('video-grid');
  const activePeers = Object.keys(peers).filter(pid => {
    return participantsList.some(p => p.peer_id === pid);
  });
  const total = 1 + activePeers.length;
  grid.className = 'video-grid g' + Math.min(total, 9);
  grid.innerHTML = '';
  
  grid.appendChild(makeTile(myPeerId, myName, myRole, localStream, true, camOn, micOn));
  
  activePeers.forEach(pid => {
    const p = peers[pid];
    const info = participantsList.find(x => x.peer_id === pid) || {};
    if (info && info.name) {
      grid.appendChild(makeTile(pid, info.name || p?.name || 'Ishtirokchi', info.role || p?.role || 'student', p?.stream, false, true, true));
    }
  });
}

function makeTile(pid, name, role, stream, isSelf, hasCam, hasMic) {
  const tile = document.createElement('div');
  const hasVideo = hasCam && stream && stream.getVideoTracks && stream.getVideoTracks().some(t => t.enabled);
  let cls = 'vtile';
  if (!hasVideo) cls += ' no-cam';
  if (isSelf)  cls += ' self-tile';
  if (role === 'teacher') cls += ' teacher-tile';
  tile.className = cls;
  tile.id = 'tile-' + pid.replace(/[^a-z0-9]/gi, '_');

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline','');
  video.setAttribute('webkit-playsinline','');
  if (isSelf) video.muted = true;
  if (stream) {
    video.srcObject = stream;
    video.play().catch(()=>{});
  }
  video.addEventListener('loadedmetadata', () => video.play().catch(()=>{}));
  tile.appendChild(video);

  const av = document.createElement('div');
  av.className = 'vtile-av';
  av.style.background = role === 'teacher' ? 'linear-gradient(135deg,#4f46e5,#7c3aed)' : 'linear-gradient(135deg,#0ea5e9,#0284c7)';
  av.textContent = (name||'U').charAt(0).toUpperCase();
  tile.appendChild(av);

  const label = document.createElement('div');
  label.className = 'vtile-label';
  if (!hasMic) label.innerHTML += '<span style="color:#f87171;font-size:9px;font-weight:700">M</span>';
  label.appendChild(document.createTextNode((isSelf?'Siz':name)));
  tile.appendChild(label);
  return tile;
}

// ================================================================
// CONTROLS / LEAVE
// ================================================================
async function leaveRoom() {
  if (localStream)  { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  Object.values(peers).forEach(p => p.call?.close());
  peers = {};
  if (myPeer) { myPeer.destroy(); myPeer = null; }
  if (syncInterval)  { clearInterval(syncInterval); syncInterval = null; }
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (roomToken && myPeerId) {
    navigator.sendBeacon('/api/room?action=leave', new Blob([JSON.stringify({peer_id:myPeerId})],{type:'application/json'}));
  }
  showError('', myRole==='teacher'?'Dars yakunlandi':'Darsdan chiqdingiz', myRole==='teacher'?'Dars muvaffaqiyatli o\'tkazildi.':"Qaytish uchun havoladan foydalaning.");
}

// ================================================================
// CHAT
// ================================================================
function sendChat() {
  const inp = document.getElementById('chat-inp');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = ''; inp.style.height = 'auto';
  chatMessages.push({ text, sender: myName, time: Date.now(), mine: true });
  renderChat();
  broadcastBoard({ type: 'chat', text, sender: myName, time: Date.now() });
}

function renderChat() {
  const box = document.getElementById('chat-msgs');
  if (!chatMessages.length) { box.innerHTML = '<div class="chat-empty">Hali xabar yo\'q</div>'; return; }
  box.innerHTML = '';
  chatMessages.forEach(m => {
    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap ' + (m.mine ? 'mine' : 'theirs');
    if (!m.mine) wrap.innerHTML = `<div class="msg-sender">${esc(m.sender)}</div>`;
    const time = new Date(m.time).toLocaleTimeString('uz',{hour:'2-digit',minute:'2-digit'});
    wrap.innerHTML += `<div class="msg ${m.mine?'mine':'theirs'}">${esc(m.text)}<div class="msg-time">${time}</div></div>`;
    box.appendChild(wrap);
  });
  box.scrollTop = box.scrollHeight;
}

// ================================================================
// PARTICIPANTS
// ================================================================
let kickTargetPeerId = null;
let kickTargetName = null;

function openKickModal(peerId, name) {
  if (myRole !== 'teacher') return;
  kickTargetPeerId = peerId;
  kickTargetName = name;
  document.getElementById('kick-modal-text').textContent = '"' + name + '" ni darsdan chiqarishni tasdiqlaysizmi?';
  document.getElementById('kick-modal').style.display = 'flex';
}

function closeKickModal() {
  kickTargetPeerId = null;
  kickTargetName = null;
  document.getElementById('kick-modal').style.display = 'none';
}

async function confirmKick() {
  if (myRole !== 'teacher') return;
  if (!kickTargetPeerId) return;
  const peerId = kickTargetPeerId;
  const name = kickTargetName;
  closeKickModal();
  
  if (peers[peerId]) {
    try { peers[peerId].call?.close(); } catch(e) {}
    delete peers[peerId];
  }
  
  try {
    await fetch('/api/room?action=kick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Token': roomToken },
      body: JSON.stringify({ peer_id: peerId })
    });
  } catch(e) {}
  
  participantsList = participantsList.filter(p => p.peer_id !== peerId);
  updateParticipants();
  rebuildGrid();
  showToast('✅ "' + name + '" darsdan chiqarildi');
}

function updateParticipants() {
  const list = document.getElementById('part-list');
  const activePeerIds = new Set([myPeerId, ...Object.keys(peers)]);
  const filtered = participantsList.filter(p => p.peer_id === myPeerId || activePeerIds.has(p.peer_id));
  const all = [
    { peer_id: myPeerId, name: myName, role: myRole, self: true },
    ...filtered.filter(p => p.peer_id !== myPeerId)
  ];
  
  if (all.length === 0) {
    list.innerHTML = '<div class="chat-empty">Hali ishtirokchi yo\'q</div>';
    return;
  }
  
  list.innerHTML = '';
  all.forEach(p => {
    const div = document.createElement('div');
    div.className = 'part-item';
    const isTeacher = p.role === 'teacher';
    const bg = isTeacher ? 'linear-gradient(135deg,#4f46e5,#7c3aed)' : 'linear-gradient(135deg,#0ea5e9,#0284c7)';
    let actionsHtml = '';
    if (myRole === 'teacher' && !p.self) {
      const safeName = (p.name||'').replace(/'/g, '').replace(/"/g, '');
      actionsHtml = '<div class="part-actions">'
        + '<button class="part-action-btn kick" title="Chiqarish" onclick="openKickModal(\'' + p.peer_id + '\',\'' + safeName + '\')">✕</button>'
        + '</div>';
    }
    div.innerHTML = '<div class="part-av" style="background:' + bg + '">' + (p.name||'U').charAt(0).toUpperCase() + '</div>'
      + '<div class="part-info"><div class="part-name">' + esc(p.name||'Foydalanuvchi') + (p.self ? ' <span class="part-self">(Siz)</span>' : '') + '</div>'
      + '<div class="part-role-txt">' + (isTeacher ? '👨‍🏫 Ustoz' : "🎓 O'quvchi") + '</div></div>'
      + (isTeacher ? '<div class="part-badge">USTOZ</div>' : '')
      + actionsHtml;
    list.appendChild(div);
  });
  document.getElementById('room-sub').textContent = all.length + ' ishtirokchi';
}

// ================================================================
// UI HELPERS
// ================================================================
function showRoom() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('room').style.display = 'flex';
  document.getElementById('live-chip').style.display = '';
  document.getElementById('room-timer').style.display = '';
  setTimeout(initCanvas, 200);
}

function showError(icon, title, sub) {
  ['loading','waiting','room'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('err-icon').textContent  = icon;
  document.getElementById('err-title').textContent = title;
  document.getElementById('err-sub').textContent   = sub;
  document.getElementById('error-page').style.display = 'flex';
}

let _toastTimer;
function showToast(msg, dur = 3500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}

function switchTab(name) {
  document.querySelectorAll('.stab').forEach((el,i) => el.classList.toggle('active',['participants','chat'][i]===name));
  document.querySelectorAll('.stab-panel').forEach(el => el.classList.toggle('active', el.id==='tab-'+name));
}

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now()-startTime)/1000);
    const m = String(Math.floor(s/60)).padStart(2,'0');
    const sc = String(s%60).padStart(2,'0');
    document.getElementById('room-timer').textContent = `${m}:${sc}`;
  }, 1000);
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ================================================================
// BOARD SYNC - REAL TIME (O'QUVCHI USTOZ DOSKASINI KO'RADI)
// ================================================================
let dataConns = {};
let boardSyncBuf = [];
let syncTimer = null;

function listenDataConns() {
  if (!myPeer) return;
  myPeer.on('connection', dc => setupDataConn(dc, dc.peer));
}

function openDataConn(peerId) {
  if (!myPeer || !myPeer.open || dataConns[peerId]) return;
  const dc = myPeer.connect(peerId, { reliable: true, serialization: 'json' });
  setupDataConn(dc, peerId);
}

function setupDataConn(dc, peerId) {
  dataConns[peerId] = dc;
  
  dc.on('open', () => {
    if (myRole === 'teacher') {
      sendBoardSnapshot(dc);
    }
  });
  
  dc.on('data', msg => {
    if (!msg || !msg.type) return;
    
    // O'QUVCHI UCHUN - doska ma'lumotlarini qabul qilish
    if (myRole !== 'teacher') {
      if (msg.type === 'stroke') {
        applyRemoteStroke(msg);
      }
      if (msg.type === 'snapshot') {
        applySnapshot(msg.data);
      }
      if (msg.type === 'clear') {
        ctx.fillStyle = boardBg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (msg.type === 'text') {
        applyRemoteText(msg);
      }
      if (msg.type === 'view_switch') {
        switchView(msg.view);
      }
      if (msg.type === 'chat') {
        chatMessages.push({ text: msg.text, sender: msg.sender, time: msg.time || Date.now(), mine: false });
        renderChat();
      }
    }
  });
  
  dc.on('close', () => { delete dataConns[peerId]; });
  dc.on('error', () => { delete dataConns[peerId]; });
}

function broadcastBoard(msg) {
  Object.values(dataConns).forEach(dc => {
    if (dc && dc.open) { 
      try { dc.send(msg); } catch(e) {} 
    }
  });
}

function sendBoardSnapshot(dc) {
  if (canvas.width < 10 || myRole !== 'teacher') return;
  try {
    dc.send({ 
      type: 'snapshot', 
      data: canvas.toDataURL('image/jpeg', 0.7) 
    });
  } catch(e) {}
}

function applySnapshot(dataUrl) {
  const img = new Image();
  img.onload = () => {
    if (canvas.width < 10) {
      setTimeout(() => applySnapshot(dataUrl), 600);
      return;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = dataUrl;
}

function queueStroke(data) {
  if (myRole !== 'teacher') return;
  boardSyncBuf.push(data);
  if (!syncTimer) {
    syncTimer = setTimeout(() => {
      if (boardSyncBuf.length) {
        broadcastBoard({ 
          type: 'stroke', 
          points: boardSyncBuf.splice(0) 
        });
      }
      syncTimer = null;
    }, 30);
  }
}

function applyRemoteStroke(msg) {
  if (!msg.points) return;
  msg.points.forEach(p => {
    ctx.strokeStyle = p.color || '#1a1a1a';
    ctx.lineWidth = p.size || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (p.op === 'begin') {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    } else if (p.op === 'move') {
      if (p.eraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    } else if (p.op === 'shape') {
      const img = new Image();
      img.onload = () => {
        if (canvas.width < 10) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = p.patch;
    }
  });
}

function applyRemoteText(msg) {
  ctx.fillStyle = msg.color || '#1a1a1a';
  ctx.font = (msg.fontSize || 16) + 'px -apple-system, sans-serif';
  const lines = (msg.text || '').split('\n');
  const lh = (msg.fontSize || 16) * 1.3;
  lines.forEach((line, i) => ctx.fillText(line, msg.x, msg.y + lh * (i + 1)));
}

window.addEventListener('beforeunload', () => {
  if (roomToken && myPeerId)
    navigator.sendBeacon('/api/room?action=leave', new Blob([JSON.stringify({peer_id:myPeerId})],{type:'application/json'}));
});

init();