// CCTV Dashboard Self-Test Suite
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '3000', 10);
const GO2RTC_PORT = 1984;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const DETECTOR_TOKEN = process.env.DETECTOR_TOKEN || '';

let results = [];
function report(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(` ${status} ${name} ${detail ? '(' + detail + ')' : ''}`);
}

function httpRequest({ path, method = 'GET', headers = {}, body = null, port = PORT }) {
  return new Promise((resolve, reject) => {
    const dataString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (dataString && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(dataString);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: reqHeaders,
      timeout: 5000
    }, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(chunks); } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: chunks,
          json
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (dataString) req.write(dataString);
    req.end();
  });
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/',
      timeout: 1000
    }, () => resolve(true));
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function runTests() {
  console.log('='.repeat(65));
  console.log('   CCTV Dashboard Self-Test System Check');
  console.log('='.repeat(65));

  let spawnedGo = null;
  let spawnedNode = null;

  // 1. Check if services are running; if not, spin them up for testing
  const goRunning = await isPortOpen(GO2RTC_PORT);
  if (!goRunning) {
    const goBin = path.join(__dirname, 'tools', 'go2rtc', 'go2rtc.exe');
    spawnedGo = spawn(goBin, ['-c', path.join(__dirname, 'go2rtc.yaml')], { stdio: 'ignore', detached: false });
  }

  const nodeRunning = await isPortOpen(PORT);
  if (!nodeRunning) {
    const nodeBin = path.join(__dirname, 'tools', 'node', 'node.exe');
    spawnedNode = spawn(nodeBin, ['--env-file=' + path.join(__dirname, '.env'), path.join(__dirname, 'server.js')], { stdio: 'ignore', detached: false });
  }

  if (spawnedGo || spawnedNode) {
    await new Promise(r => setTimeout(r, 2500));
  }

  try {
    // Test 1: Check go2rtc port 1984
    try {
      const res = await httpRequest({ path: '/api', port: GO2RTC_PORT });
      report('1. Port 1984 (go2rtc API) is up and responding', res.statusCode === 200 || res.statusCode === 404);
    } catch (err) {
      report('1. Port 1984 (go2rtc API) is up and responding', false, err.message);
    }

    // Test 2: Check Dashboard port 3000
    try {
      const res = await httpRequest({ path: '/api/auth-status' });
      report('2. Port 3000 (Dashboard Web Server) is up and responding', res.statusCode === 200);
    } catch (err) {
      report('2. Port 3000 (Dashboard Web Server) is up and responding', false, err.message);
    }

    // Test 3: Login with WRONG password
    try {
      const res = await httpRequest({
        path: '/api/login',
        method: 'POST',
        body: { username: ADMIN_USER, password: 'wrong_password_test_123' }
      });
      report('3. Login with WRONG password is correctly rejected', res.statusCode === 401);
    } catch (err) {
      report('3. Login with WRONG password is correctly rejected', false, err.message);
    }

    // Test 4: Login with RIGHT password
    let sessionCookie = '';
    try {
      const res = await httpRequest({
        path: '/api/login',
        method: 'POST',
        body: { username: ADMIN_USER, password: ADMIN_PASS }
      });
      const setCookie = res.headers['set-cookie'];
      if (setCookie && setCookie.length > 0) {
        sessionCookie = setCookie[0].split(';')[0];
      }
      report('4. Login with RIGHT password succeeds', res.statusCode === 200 && res.json && res.json.success === true);
    } catch (err) {
      report('4. Login with RIGHT password succeeds', false, err.message);
    }

    // Test 5: Add a fake camera
    let createdCamId = null;
    try {
      const res = await httpRequest({
        path: '/api/cameras',
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: {
          name: 'Test Front Camera',
          brand: 'cpplus',
          ip: '192.168.1.150',
          port: 554,
          username: 'testuser',
          password: 'Secret@Password#123',
          channel: 1,
          subtype: true
        }
      });
      if (res.statusCode === 200 && res.json && res.json.success) {
        createdCamId = res.json.camera.id;
        const isMasked = res.json.camera.password === '••••••••';
        report('5. Adding a fake camera works (credentials properly masked)', isMasked);
      } else {
        report('5. Adding a fake camera works', false, 'Status ' + res.statusCode);
      }
    } catch (err) {
      report('5. Adding a fake camera works', false, err.message);
    }

    // Test 6: Verify camera list & URL mask
    try {
      const res = await httpRequest({
        path: '/api/cameras',
        headers: { Cookie: sessionCookie }
      });
      const found = res.json && res.json.find(c => c.id === createdCamId);
      report('6. Fetching cameras returns masked stream URL', !!(found && found.maskedUrl.includes('••••••••')));
    } catch (err) {
      report('6. Fetching cameras returns masked stream URL', false, err.message);
    }

    // Test 7: Delete fake camera
    try {
      const res = await httpRequest({
        path: `/api/cameras/${createdCamId}`,
        method: 'DELETE',
        headers: { Cookie: sessionCookie }
      });
      report('7. Deleting camera removes it cleanly', res.statusCode === 200 && res.json && res.json.success);
    } catch (err) {
      report('7. Deleting camera removes it cleanly', false, err.message);
    }

    // Test 8: Fake detection event with snapshot
    let eventSnapshotPath = null;
    let testEventId = null;
    try {
      const tinyJpgBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
      const res = await httpRequest({
        path: '/api/events',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${DETECTOR_TOKEN}` },
        body: {
          cameraId: 'cam_test',
          cameraName: 'Test Gate',
          label: 'person',
          confidence: 0.94,
          imageBase64: tinyJpgBase64
        }
      });

      if (res.statusCode === 200 && res.json && res.json.success) {
        testEventId = res.json.eventId;
        eventSnapshotPath = `/snapshots/${testEventId}.jpg`;
        report('8. Fake detection event is accepted and stored', true);
      } else {
        report('8. Fake detection event is accepted and stored', false, 'Status ' + res.statusCode);
      }
    } catch (err) {
      report('8. Fake detection event is accepted and stored', false, err.message);
    }

    // Test 9: Event snapshot picture loads successfully
    try {
      const res = await httpRequest({ path: eventSnapshotPath });
      report('9. Stored detection snapshot picture loads', res.statusCode === 200);
    } catch (err) {
      report('9. Stored detection snapshot picture loads', false, err.message);
    }

    // Test 10: Detector unauthorized access test (wrong token rejected)
    try {
      const res = await httpRequest({
        path: '/api/events',
        method: 'POST',
        headers: { 'Authorization': 'Bearer wrong_token_test' },
        body: { label: 'car' }
      });
      report('10. Detector security: requests with wrong token are rejected', res.statusCode === 403);
    } catch (err) {
      report('10. Detector security: requests with wrong token are rejected', false, err.message);
    }

    // Cleanup test event
    if (testEventId) {
      try {
        await httpRequest({
          path: `/api/events/${testEventId}`,
          method: 'DELETE',
          headers: { Cookie: sessionCookie }
        });
      } catch (e) {}
    }
  } finally {
    if (spawnedNode) {
      try { spawnedNode.kill(); } catch (e) {}
    }
    if (spawnedGo) {
      try { spawnedGo.kill(); } catch (e) {}
    }
  }

  console.log('='.repeat(65));
  const failed = results.filter(r => !r.passed).length;
  if (failed === 0) {
    console.log(`\x1b[32m ALL ${results.length} TESTS PASSED! System is 100% operational.\x1b[0m`);
  } else {
    console.log(`\x1b[31m ${failed} of ${results.length} tests failed.\x1b[0m`);
  }
  console.log('='.repeat(65));
  process.exit(failed === 0 ? 0 : 1);
}

runTests();
