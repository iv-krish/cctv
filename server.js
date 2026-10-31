// CCTV Dashboard - Native Windows Server
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

// 1. SAFE CONFIGURATION & INTEGRITY CHECKS
const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const DETECTOR_TOKEN = process.env.DETECTOR_TOKEN || '';
const MAX_EVENTS = parseInt(process.env.MAX_EVENTS || '500', 10);
const GO2RTC_API = process.env.GO2RTC_API_URL || 'http://127.0.0.1:1984';

// Safety Refusal: refuse to start if secrets are default, empty, or too short
const defaultPasswords = ['', 'CHANGE_THIS_TO_YOUR_PASSWORD', 'admin', 'password', '12345678', 'admin123', 'adminpass'];
if (!ADMIN_PASS || defaultPasswords.includes(ADMIN_PASS.toLowerCase()) || ADMIN_PASS.length < 8) {
  console.error('\n' + '='.repeat(68));
  console.error(' [SECURITY ERROR] Dashboard refused to start:');
  console.error(' ADMIN_PASS in your .env file is missing, default, or too short (< 8 chars).');
  console.error(' Please open .env in Notepad, choose a strong password for ADMIN_PASS,');
  console.error(' save the file, and start the dashboard again.');
  console.error('='.repeat(68) + '\n');
  process.exit(1);
}

if (!SESSION_SECRET || SESSION_SECRET === 'a_long_random_secret_at_least_32_characters' || SESSION_SECRET.length < 16) {
  console.error('\n' + '='.repeat(68));
  console.error(' [SECURITY ERROR] SESSION_SECRET in .env is missing or too short.');
  console.error('='.repeat(68) + '\n');
  process.exit(1);
}

if (!DETECTOR_TOKEN || DETECTOR_TOKEN === 'a_long_random_secret_at_least_32_characters' || DETECTOR_TOKEN.length < 16) {
  console.error('\n' + '='.repeat(68));
  console.error(' [SECURITY ERROR] DETECTOR_TOKEN in .env is missing or too short.');
  console.error('='.repeat(68) + '\n');
  process.exit(1);
}

// 2. DATA DIRECTORIES & INITIAL FILES
const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_DIR = path.join(DATA_DIR, 'events');
const CAMERAS_FILE = path.join(DATA_DIR, 'cameras.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR, { recursive: true });
if (!fs.existsSync(CAMERAS_FILE)) fs.writeFileSync(CAMERAS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, JSON.stringify([], null, 2));

function loadCameras() {
  try {
    return JSON.parse(fs.readFileSync(CAMERAS_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveCameras(cams) {
  fs.writeFileSync(CAMERAS_FILE, JSON.stringify(cams, null, 2));
}

function loadEvents() {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveEvents(evs) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(evs, null, 2));
}

// Helper: build RTSP URL with URL-encoded credentials
function buildRtspUrl({ brand, ip, port, username, password, channel, subtype, customUrl }) {
  if (brand === 'advanced' && customUrl) {
    let u = (customUrl || '').trim();
    if (u.startsWith('rtsp://') && !u.includes('#')) {
      u += '#transport=tcp';
    }
    return u;
  }
  const cleanIp = (ip || '').trim();
  const cleanPort = (port || 554).toString().trim();
  const cleanUser = encodeURIComponent((username || '').trim());
  const cleanPass = encodeURIComponent((password || '').trim());
  const ch = parseInt(channel || 1, 10);
  const sub = subtype ? 1 : 0; // 1 = light stream / sub stream, 0 = main stream

  let auth = '';
  if (cleanUser || cleanPass) {
    auth = `${cleanUser}:${cleanPass}@`;
  }

  let finalUrl = '';
  switch (brand) {
    case 'cpplus':
    case 'dahua':
      // CP Plus & Dahua RTSP format
      finalUrl = `rtsp://${auth}${cleanIp}:${cleanPort}/cam/realmonitor?channel=${ch}&subtype=${sub}`;
      break;
    case 'hikvision':
      // Hikvision format: /Streaming/Channels/<ch>0<sub+1>
      finalUrl = `rtsp://${auth}${cleanIp}:${cleanPort}/Streaming/Channels/${ch}0${sub + 1}`;
      break;
    case 'generic':
    default:
      finalUrl = `rtsp://${auth}${cleanIp}:${cleanPort}/live/ch${ch}`;
      break;
  }

  if (!finalUrl.includes('#')) {
    finalUrl += '#transport=tcp';
  }
  return finalUrl;
}

function maskUrl(rawUrl) {
  if (!rawUrl) return '';
  return rawUrl.replace(/rtsp:\/\/([^:]+):([^@]+)@/i, (match, u) => {
    return `rtsp://${decodeURIComponent(u)}:••••••••@`;
  });
}

// Synchronize all saved cameras with go2rtc using PATCH (in-memory registration)
async function syncCamerasToGo2rtc() {
  const cameras = loadCameras();
  for (const cam of cameras) {
    try {
      const url = `${GO2RTC_API}/api/streams?name=${encodeURIComponent(cam.id)}&src=${encodeURIComponent(cam.url)}`;
      await fetch(url, { method: 'PATCH' });
    } catch (e) {}
  }
}

// Comprehensive camera diagnosis helper
async function testCameraDiagnostic({ ip, port, url, brand }) {
  const cleanIp = (ip || '').trim();
  const testPort = parseInt(port || 554, 10);

  // Step 1: TCP Port Reachability Check
  const tcpResult = await new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(1800);
    s.on('connect', () => {
      s.destroy();
      resolve({ success: true });
    });
    s.on('timeout', () => {
      s.destroy();
      resolve({ success: false, reason: 'TIMEOUT' });
    });
    s.on('error', (err) => {
      s.destroy();
      resolve({ success: false, reason: err.code || err.message });
    });
    s.connect(testPort, cleanIp);
  });

  if (!tcpResult.success) {
    if (tcpResult.reason === 'TIMEOUT' || tcpResult.reason === 'EHOSTUNREACH' || tcpResult.reason === 'ENETUNREACH') {
      return {
        status: 'offline',
        code: 'HOST_UNREACHABLE',
        message: `Host unreachable (${cleanIp}:${testPort})`,
        suggestion: `Check DVR power and cabling. Verify your PC is on the same subnet as the DVR.`
      };
    }
    if (tcpResult.reason === 'ECONNREFUSED') {
      return {
        status: 'offline',
        code: 'PORT_CLOSED',
        message: `Port ${testPort} closed on ${cleanIp}`,
        suggestion: `RTSP port is not open on DVR. Open DVR Menu -> Network -> Port to enable RTSP.`
      };
    }
    return {
      status: 'offline',
      code: 'TCP_ERROR',
      message: `TCP Connection failed: ${tcpResult.reason}`,
      suggestion: `Check network cabling, firewall, or DVR IP settings.`
    };
  }

  // Step 2: RTSP handshake and authentication via go2rtc probe
  const testStreamName = `probe_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  try {
    const patchUrl = `${GO2RTC_API}/api/streams?name=${encodeURIComponent(testStreamName)}&src=${encodeURIComponent(url)}`;
    const patchRes = await fetch(patchUrl, { method: 'PATCH' });
    if (!patchRes.ok) {
      return {
        status: 'offline',
        code: 'GO2RTC_ERROR',
        message: 'go2rtc media engine rejected stream registration',
        suggestion: 'Make sure go2rtc service is active.'
      };
    }

    try {
      const ctrl = new AbortController();
      const tId = setTimeout(() => ctrl.abort(), 3500);
      await fetch(`${GO2RTC_API}/api/frame.jpeg?src=${encodeURIComponent(testStreamName)}`, { signal: ctrl.signal });
      clearTimeout(tId);
    } catch(e) {}

    const streamsRes = await fetch(`${GO2RTC_API}/api/streams`);
    const streamsData = await streamsRes.json();
    const probe = streamsData[testStreamName];

    try {
      await fetch(`${GO2RTC_API}/api/streams?name=${encodeURIComponent(testStreamName)}`, { method: 'DELETE' });
    } catch(e) {}

    if (probe && probe.producers && probe.producers.length > 0) {
      const prod = probe.producers[0];
      if (prod.error) {
        const err = prod.error.toLowerCase();
        if (err.includes('401') || err.includes('unauthorized') || err.includes('auth')) {
          return {
            status: 'offline',
            code: 'AUTH_FAILED',
            message: 'Authentication failed (401 Unauthorized)',
            suggestion: 'Check the camera/DVR username and password in DVR user settings.'
          };
        }
        if (err.includes('404') || err.includes('not found') || err.includes('stream not found')) {
          return {
            status: 'offline',
            code: 'STREAM_NOT_FOUND',
            message: 'Stream path or channel not found (404)',
            suggestion: 'Verify the channel number and light stream subtype.'
          };
        }
        return {
          status: 'offline',
          code: 'PROBE_FAILED',
          message: `RTSP response: ${prod.error}`,
          suggestion: 'Check camera stream configuration and brand format.'
        };
      }
    }

    return {
      status: 'online',
      code: 'WORKING',
      message: 'Connection verified! Stream is online and responding.',
      suggestion: 'Stream is ready for live viewing.'
    };
  } catch(err) {
    try {
      await fetch(`${GO2RTC_API}/api/streams?name=${encodeURIComponent(testStreamName)}`, { method: 'DELETE' });
    } catch(e) {}
    return {
      status: 'offline',
      code: 'DIAGNOSTIC_EXCEPTION',
      message: `Diagnostic check error: ${err.message}`,
      suggestion: 'Check if go2rtc engine is responding.'
    };
  }
}

// 3. EXPRESS APP SETUP
const app = express();

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
});
app.use(sessionMiddleware);

// Authentication Check Middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

// Proxy go2rtc media engine through /go2rtc for unified port and remote tunnel streaming
// Protected by requireAuth for security (both local and remote)
app.use('/go2rtc', requireAuth, (req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: 1984,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: '127.0.0.1:1984'
    }
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'go2rtc proxy error', details: err.message });
    }
  });

  req.pipe(proxyReq);
});

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use('/snapshots', express.static(EVENTS_DIR));

// SSE connections for real-time live events in dashboard
let sseClients = [];
app.get('/api/events/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');
  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

function broadcastEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(data); } catch (e) {}
  });
}

// Authentication Check Middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

// 4. AUTHENTICATION ROUTES
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.authenticated = true;
    return res.json({ success: true, user: ADMIN_USER });
  }
  return res.status(401).json({ success: false, error: 'Invalid username or password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/auth-status', (req, res) => {
  res.json({
    authenticated: !!(req.session && req.session.authenticated),
    user: req.session && req.session.authenticated ? ADMIN_USER : null
  });
});

// 5. CAMERA ROUTES
app.get('/api/cameras', requireAuth, (req, res) => {
  const cameras = loadCameras();
  const sanitized = cameras.map(cam => ({
    id: cam.id,
    name: cam.name,
    brand: cam.brand,
    ip: cam.ip,
    port: cam.port,
    username: cam.username,
    password: '••••••••',
    channel: cam.channel,
    subtype: cam.subtype,
    maskedUrl: maskUrl(cam.url),
    createdAt: cam.createdAt,
    lastStatus: cam.lastStatus || 'unchecked',
    lastChecked: cam.lastChecked || null,
    lastStatusMessage: cam.lastStatusMessage || null
  }));
  res.json(sanitized);
});

// Diagnostics endpoint for a specific saved camera
app.post('/api/cameras/:id/diagnose', requireAuth, async (req, res) => {
  const cameras = loadCameras();
  const cam = cameras.find(c => c.id === req.params.id);
  if (!cam) return res.status(404).json({ error: 'Camera not found' });

  const result = await testCameraDiagnostic(cam);
  cam.lastStatus = result.status;
  cam.lastChecked = new Date().toISOString();
  cam.lastStatusMessage = result.message;
  saveCameras(cameras);

  // Sync to go2rtc
  if (result.status === 'online') {
    try {
      const patchUrl = `${GO2RTC_API}/api/streams?name=${encodeURIComponent(cam.id)}&src=${encodeURIComponent(cam.url)}`;
      await fetch(patchUrl, { method: 'PATCH' });
    } catch(e) {}
  }

  res.json({
    success: true,
    result,
    camera: {
      id: cam.id,
      lastStatus: cam.lastStatus,
      lastChecked: cam.lastChecked,
      lastStatusMessage: cam.lastStatusMessage
    }
  });
});

// Test camera connection helper
app.post('/api/cameras/test', requireAuth, async (req, res) => {
  const { brand, ip, port, username, password, channel, subtype, customUrl } = req.body;

  // Validate IP address format (helpful guidance if user typed a P2P Serial Number)
  const cleanIp = (ip || '').trim();
  if (brand !== 'advanced') {
    if (!cleanIp) {
      return res.json({
        status: 'error',
        code: 'MISSING_IP',
        message: 'IP Address cannot be empty.',
        suggestion: 'Please enter your DVR local IP address (e.g. 192.168.1.100).'
      });
    }
    if (!cleanIp.includes('.') && !cleanIp.includes(':')) {
      return res.json({
        status: 'error',
        code: 'P2P_SERIAL_NOT_IP',
        message: `"${cleanIp}" looks like a P2P Serial Number or Cloud ID, not an IP address.`,
        suggestion: 'RTSP streaming requires your DVR local LAN IP address (typically 192.168.1.x or 192.168.0.x). You can find this on your TV/monitor in DVR Menu -> Network -> TCP/IP.'
      });
    }
  }

  const testUrl = buildRtspUrl({ brand, ip, port, username, password, channel, subtype, customUrl });

  if (!testUrl.startsWith('rtsp://')) {
    return res.json({
      status: 'error',
      code: 'INVALID_URL',
      message: 'RTSP URL must start with rtsp://',
      suggestion: 'Check the IP address and format.'
    });
  }

  const testStreamName = `test_probe_${Date.now()}`;
  try {
    // Register temporary stream in go2rtc using PATCH (in-memory, avoids modifying yaml)
    const patchUrl = `${GO2RTC_API}/api/streams?name=${encodeURIComponent(testStreamName)}&src=${encodeURIComponent(testUrl)}`;
    const patchRes = await fetch(patchUrl, { method: 'PATCH' });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return res.json({
        status: 'error',
        code: 'GO2RTC_ERROR',
        message: 'go2rtc stream registration returned: ' + errText,
        suggestion: 'Make sure go2rtc is running in the background.'
      });
    }

    // Force go2rtc to connect by probing a frame
    try {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 3500);
      await fetch(`${GO2RTC_API}/api/frame.jpeg?src=${encodeURIComponent(testStreamName)}`, { signal: ctrl.signal });
      clearTimeout(timeoutId);
    } catch (e) {}

    // Check stream probe info from go2rtc
    const streamsRes = await fetch(`${GO2RTC_API}/api/streams`);
    const streamsData = await streamsRes.json();
    const probe = streamsData[testStreamName];

    // Clean up temporary probe stream
    try {
      await fetch(`${GO2RTC_API}/api/streams?name=${encodeURIComponent(testStreamName)}`, { method: 'DELETE' });
    } catch(e) {}

    if (probe && probe.producers && probe.producers.length > 0) {
      const prod = probe.producers[0];
      if (prod.error) {
        const err = prod.error.toLowerCase();
        if (err.includes('401') || err.includes('unauthorized') || err.includes('auth')) {
          return res.json({
            status: 'error',
            code: 'WRONG_PASSWORD',
            message: 'Wrong username or password (401 Unauthorized)',
            suggestion: 'Check the camera/DVR username and password in your DVR user settings.'
          });
        }
        if (err.includes('no such host') || err.includes('lookup') || err.includes('too many colons')) {
          return res.json({
            status: 'error',
            code: 'CANNOT_RESOLVE_HOST',
            message: `Could not resolve hostname/IP: "${cleanIp}"`,
            suggestion: 'Make sure you type a valid local IP address (like 192.168.1.100), not a device serial number.'
          });
        }
        if (err.includes('timeout') || err.includes('refused') || err.includes('unreachable') || err.includes('no route')) {
          return res.json({
            status: 'error',
            code: 'CANNOT_REACH_IP',
            message: `Cannot connect to IP ${cleanIp}:554 (Connection timed out / refused)`,
            suggestion: 'Verify that the DVR is powered on, plugged into your router, and your PC is on the same home network.'
          });
        }
        if (err.includes('404') || err.includes('not found') || err.includes('stream not found')) {
          return res.json({
            status: 'error',
            code: 'WRONG_PATH',
            message: 'Camera stream path or channel not found (404 Not Found)',
            suggestion: 'Check the channel number (e.g. 1, 2) or try toggling the light stream checkbox.'
          });
        }
        return res.json({
          status: 'error',
          code: 'PROBE_FAILED',
          message: `Stream probe response: ${prod.error}`,
          suggestion: 'Check camera brand, IP address, and channel number.'
        });
      }
      return res.json({
        status: 'ok',
        code: 'WORKING',
        message: 'Connection successful! Stream is working.',
        suggestion: 'You can now save this camera.'
      });
    }

    return res.json({
      status: 'ok',
      code: 'WORKING',
      message: 'Camera stream reached successfully.',
      suggestion: 'You can now save this camera.'
    });
  } catch (err) {
    try { await fetch(`${GO2RTC_API}/api/streams?name=${encodeURIComponent(testStreamName)}`, { method: 'DELETE' }); } catch(e) {}
    return res.json({
      status: 'error',
      code: 'TEST_EXCEPTION',
      message: `Connection test error: ${err.message}`,
      suggestion: 'Ensure the camera IP is reachable and go2rtc is running.'
    });
  }
});

// Add Camera
app.post('/api/cameras', requireAuth, async (req, res) => {
  const { name, brand, ip, port, username, password, channel, subtype, customUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'Camera name is required' });

  const finalUrl = buildRtspUrl({ brand, ip, port, username, password, channel, subtype, customUrl });
  const cameras = loadCameras();
  const id = 'cam_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

  const newCam = {
    id,
    name: name.trim(),
    brand: brand || 'cpplus',
    ip: (ip || '').trim(),
    port: parseInt(port || 554, 10),
    username: (username || '').trim(),
    password: password || '',
    channel: parseInt(channel || 1, 10),
    subtype: !!subtype,
    url: finalUrl,
    createdAt: new Date().toISOString()
  };

  cameras.push(newCam);
  saveCameras(cameras);

  // Register in go2rtc via PATCH
  try {
    const patchUrl = `${GO2RTC_API}/api/streams?name=${encodeURIComponent(id)}&src=${encodeURIComponent(finalUrl)}`;
    await fetch(patchUrl, { method: 'PATCH' });
  } catch (err) {
    console.error('Failed to register stream in go2rtc:', err.message);
  }

  res.json({
    success: true,
    camera: {
      id: newCam.id,
      name: newCam.name,
      brand: newCam.brand,
      ip: newCam.ip,
      port: newCam.port,
      username: newCam.username,
      password: '••••••••',
      channel: newCam.channel,
      subtype: newCam.subtype,
      maskedUrl: maskUrl(newCam.url)
    }
  });
});

// Bulk Add Channels (e.g. Channels 1 to 4)
app.post('/api/cameras/bulk', requireAuth, async (req, res) => {
  const { namePrefix, brand, ip, port, username, password, startChannel, endChannel, subtype } = req.body;
  const start = parseInt(startChannel || 1, 10);
  const end = parseInt(endChannel || 4, 10);

  if (start < 1 || end < start || end - start > 32) {
    return res.status(400).json({ error: 'Invalid channel range (max 32 channels at once).' });
  }

  const cameras = loadCameras();
  const added = [];

  for (let ch = start; ch <= end; ch++) {
    const id = 'cam_' + Date.now() + '_' + ch;
    const finalUrl = buildRtspUrl({ brand, ip, port, username, password, channel: ch, subtype });
    const camObj = {
      id,
      name: `${namePrefix || 'Camera'} Ch${ch}`,
      brand: brand || 'cpplus',
      ip: (ip || '').trim(),
      port: parseInt(port || 554, 10),
      username: (username || '').trim(),
      password: password || '',
      channel: ch,
      subtype: !!subtype,
      url: finalUrl,
      createdAt: new Date().toISOString()
    };
    cameras.push(camObj);
    added.push(camObj);

    try {
      const patchUrl = `${GO2RTC_API}/api/streams?name=${encodeURIComponent(id)}&src=${encodeURIComponent(finalUrl)}`;
      await fetch(patchUrl, { method: 'PATCH' });
    } catch (e) {}
  }

  saveCameras(cameras);
  res.json({ success: true, count: added.length });
});

// Delete Camera
app.delete('/api/cameras/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  let cameras = loadCameras();
  cameras = cameras.filter(c => c.id !== id);
  saveCameras(cameras);

  try {
    await fetch(`${GO2RTC_API}/api/streams?name=${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {}

  res.json({ success: true });
});

// 6. AI EVENTS ROUTES (Protected by DETECTOR_TOKEN or Session)
function verifyDetectorAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const queryToken = req.query.token;
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : queryToken;

  if (token === DETECTOR_TOKEN || (req.session && req.session.authenticated)) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: Invalid detector token' });
}

// Detector sends detection event
app.post('/api/events', verifyDetectorAuth, (req, res) => {
  const { cameraId, cameraName, label, confidence, imageBase64, timestamp } = req.body;
  if (!label) return res.status(400).json({ error: 'Missing detection label' });

  const eventId = 'ev_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  let snapshotFile = null;

  if (imageBase64) {
    try {
      const buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      snapshotFile = `${eventId}.jpg`;
      fs.writeFileSync(path.join(EVENTS_DIR, snapshotFile), buffer);
    } catch (e) {
      console.error('Error saving event image snapshot:', e.message);
    }
  }

  const newEvent = {
    id: eventId,
    cameraId: cameraId || 'unknown',
    cameraName: cameraName || 'Camera',
    label,
    confidence: typeof confidence === 'number' ? Math.round(confidence * 100) : 80,
    timestamp: timestamp || new Date().toISOString(),
    snapshot: snapshotFile ? `/snapshots/${snapshotFile}` : null
  };

  const events = loadEvents();
  events.unshift(newEvent);

  // Enforce MAX_EVENTS limit (FIFO: prune oldest)
  while (events.length > MAX_EVENTS) {
    const oldest = events.pop();
    if (oldest.snapshot) {
      const oldImg = path.join(EVENTS_DIR, path.basename(oldest.snapshot));
      if (fs.existsSync(oldImg)) {
        try { fs.unlinkSync(oldImg); } catch (e) {}
      }
    }
  }

  saveEvents(events);
  broadcastEvent(newEvent);

  // Trigger optional background alerts
  sendAlerts(newEvent);

  res.json({ success: true, eventId });
});

app.get('/api/events', requireAuth, (req, res) => {
  const events = loadEvents();
  res.json(events);
});

app.delete('/api/events/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  let events = loadEvents();
  const target = events.find(e => e.id === id);
  if (target && target.snapshot) {
    const imgPath = path.join(EVENTS_DIR, path.basename(target.snapshot));
    if (fs.existsSync(imgPath)) {
      try { fs.unlinkSync(imgPath); } catch (e) {}
    }
  }
  events = events.filter(e => e.id !== id);
  saveEvents(events);
  res.json({ success: true });
});

app.delete('/api/events', requireAuth, (req, res) => {
  saveEvents([]);
  try {
    const files = fs.readdirSync(EVENTS_DIR);
    for (const f of files) {
      fs.unlinkSync(path.join(EVENTS_DIR, f));
    }
  } catch (e) {}
  res.json({ success: true });
});

// 7. ALERT DISPATCHERS (WhatsApp & SMTP)
async function sendAlerts(event) {
  if (process.env.WHATSAPP_ENABLED === 'true' && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_RECIPIENT_PHONE) {
    try {
      const msg = `🚨 *CCTV Alert*\nDetected: ${event.label} (${event.confidence}%)\nCamera: ${event.cameraName}\nTime: ${new Date(event.timestamp).toLocaleTimeString()}`;
      await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: process.env.WHATSAPP_RECIPIENT_PHONE,
          type: 'text',
          text: { body: msg }
        })
      });
    } catch (e) {
      console.error('WhatsApp alert error:', e.message);
    }
  }

  if (process.env.SMTP_ENABLED === 'true' && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      console.log(`[EMAIL ALERT] Triggered for ${event.label} on ${event.cameraName}`);
    } catch (e) {}
  }
}

// 8. CLOUDFLARE TUNNEL MANAGEMENT
const { spawn: spawnProcess } = require('child_process');
let tunnelProcess = null;
let tunnelUrl = null;
let tunnelStatus = 'stopped'; // stopped | starting | running | error
let tunnelLog = [];

const CLOUDFLARED_PATH = path.join(__dirname, 'tools', 'cloudflared', 'cloudflared.exe');
const CLOUDFLARED_EXISTS = fs.existsSync(CLOUDFLARED_PATH);

app.get('/api/tunnel/status', requireAuth, (req, res) => {
  res.json({
    available: CLOUDFLARED_EXISTS,
    status: tunnelStatus,
    url: tunnelUrl,
    log: tunnelLog.slice(-20)
  });
});

app.post('/api/tunnel/start', requireAuth, (req, res) => {
  if (!CLOUDFLARED_EXISTS) {
    return res.status(400).json({ error: 'cloudflared.exe not found in tools/cloudflared/' });
  }
  if (tunnelProcess) {
    return res.json({ success: true, message: 'Tunnel already running', url: tunnelUrl });
  }

  tunnelStatus = 'starting';
  tunnelUrl = null;
  tunnelLog = [];

  tunnelProcess = spawnProcess(CLOUDFLARED_PATH, ['tunnel', '--url', `http://127.0.0.1:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  const handleOutput = (data) => {
    const line = data.toString().trim();
    if (line) {
      tunnelLog.push(line);
      if (tunnelLog.length > 100) tunnelLog.shift();
      // Extract the public URL from cloudflared output
      const urlMatch = line.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/i);
      if (urlMatch) {
        tunnelUrl = urlMatch[0];
        tunnelStatus = 'running';
        console.log(`[Tunnel] Public URL: ${tunnelUrl}`);
      }
    }
  };

  tunnelProcess.stdout.on('data', handleOutput);
  tunnelProcess.stderr.on('data', handleOutput);

  tunnelProcess.on('error', (err) => {
    tunnelStatus = 'error';
    tunnelLog.push(`Process error: ${err.message}`);
    tunnelProcess = null;
  });

  tunnelProcess.on('close', (code) => {
    tunnelStatus = 'stopped';
    tunnelUrl = null;
    tunnelLog.push(`Tunnel process exited with code ${code}`);
    tunnelProcess = null;
  });

  res.json({ success: true, message: 'Tunnel starting...' });
});

app.post('/api/tunnel/stop', requireAuth, (req, res) => {
  if (!tunnelProcess) {
    tunnelStatus = 'stopped';
    tunnelUrl = null;
    return res.json({ success: true, message: 'Tunnel is not running' });
  }

  try {
    tunnelProcess.kill('SIGTERM');
    // Force kill after 3 seconds if still alive
    setTimeout(() => {
      try { if (tunnelProcess) tunnelProcess.kill('SIGKILL'); } catch(e) {}
    }, 3000);
  } catch (e) {}

  tunnelStatus = 'stopped';
  tunnelUrl = null;
  tunnelProcess = null;

  res.json({ success: true, message: 'Tunnel stopped' });
});

// 9. START HTTP SERVER (127.0.0.1 ONLY FOR LOCAL SECURITY)
const server = app.listen(PORT, '127.0.0.1', async () => {
  console.log('='.repeat(60));
  console.log(` CCTV Dashboard running securely at http://127.0.0.1:${PORT}`);
  console.log(` go2rtc API linked at: ${GO2RTC_API}`);
  console.log(` Cloudflare Tunnel: ${CLOUDFLARED_EXISTS ? 'Available (start from dashboard)' : 'Not installed'}`);
  console.log(` Events storage limit: ${MAX_EVENTS}`);
  console.log('='.repeat(60));

  await syncCamerasToGo2rtc();
});

// WebSocket proxy for go2rtc WebRTC and MSE signaling
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/go2rtc')) {
    // Authenticate WebSocket upgrade using session middleware
    sessionMiddleware(req, {}, () => {
      if (!req.session || !req.session.authenticated) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const targetPath = req.url.replace('/go2rtc', '') || '/';
      const proxySocket = net.connect(1984, '127.0.0.1', () => {
        proxySocket.write(`${req.method} ${targetPath} HTTP/${req.httpVersion}\r\n`);
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const key = req.rawHeaders[i];
          const val = req.rawHeaders[i + 1];
          if (key.toLowerCase() === 'host') {
            proxySocket.write(`Host: 127.0.0.1:1984\r\n`);
          } else if (key.toLowerCase() === 'origin') {
            // Rewrite origin so go2rtc internal Upgrader.CheckOrigin always accepts proxied WebSockets
            proxySocket.write(`Origin: http://127.0.0.1:1984\r\n`);
          } else {
            proxySocket.write(`${key}: ${val}\r\n`);
          }
        }
        proxySocket.write('\r\n');
        if (head && head.length > 0) proxySocket.write(head);
        socket.pipe(proxySocket);
        proxySocket.pipe(socket);
      });

      proxySocket.on('error', () => {
        socket.destroy();
      });
      socket.on('error', () => {
        proxySocket.destroy();
      });
    });
  }
});

// Clean shutdown handler
process.on('SIGINT', () => {
  if (tunnelProcess) try { tunnelProcess.kill(); } catch(e) {}
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  if (tunnelProcess) try { tunnelProcess.kill(); } catch(e) {}
  server.close(() => process.exit(0));
});
