
var express    = require('express');
var request    = require('request');
var hashmap    = require('hashmap');
var config     = require('config');
var path       = require('path');
var bodyParser = require('body-parser');
var mqttLib    = require('mqtt');   // ← NEW: for forwarding commands to ESP32
const { verifyToken, requireAdmin, login } = require('./middleware/auth');

var app = express();
var map = new hashmap();

app.use(bodyParser.json({ type: ['application/*+json', 'application/json'] }));
app.use(express.static(__dirname + '/public'));

// ── CSE config ────────────────────────────────────────────────────────────────
var cseURL     = 'http://' + config.cse.ip + ':' + config.cse.port;
var cseRelease = config.cse.release;
var templates  = config.templates;
var acpi       = {};
var requestNr  = 0;

// ── Alarm thresholds ──────────────────────────────────────────────────────────
const THRESHOLDS = {
  Gas_MQ2:     { danger: 500, warning: 299 },
  Temperature: { danger: 40,  warning: 38  },
  Humidity:    { danger: 95,  warning: 85  }
};

var alarmActive = false;

// ── MQTT client — connects to local Mosquitto broker ─────────────────────────
// This is used to forward actuator commands directly to ESP32
var mqttBroker = mqttLib.connect('mqtt://127.0.0.1:1883');

mqttBroker.on('connect', function() {
  console.log('[MQTT-FWD] Connected to local broker (127.0.0.1:1883)');
});

mqttBroker.on('error', function(err) {
  console.log('[MQTT-FWD] Broker error:', err.message);
});

// ── Forward actuator command to ESP32 via MQTT ────────────────────────────────
// ESP32 subscribes to: /oneM2M/req/Mobius2/ESP32/json
// Payload format matches what onMqttMessage() in Arduino expects
function forwardToESP32(name, data) {
  var payload = JSON.stringify({
    'm2m:rqp': {
      'op': 1,
      'to': '/Mobius/' + name + '/COMMAND',
      'fr': 'Mobius2',
      'rqi': 'fwd' + requestNr,
      'ty': 4,
      'pc': { 'm2m:cin': { 'con': data } }
    }
  });
  mqttBroker.publish('/oneM2M/req/Mobius2/ESP32/json', payload);
  console.log('[MQTT-FWD] → ESP32 | ' + name + ' = ' + data);
}

// ── Alarm logic ───────────────────────────────────────────────────────────────
function checkAlarm(type, value) {
  const threshold = THRESHOLDS[type];
  if (!threshold) return;

  const numVal    = parseFloat(value);
  const wasDanger = alarmActive;

  if (numVal >= threshold.danger) {
    alarmActive = true;
    console.log('[ALARM] DANGER! ' + type + ' = ' + numVal + ' (threshold: ' + threshold.danger + ')');
    triggerActuators('1');
  } else if (numVal >= threshold.warning) {
    console.log('[ALARM] WARNING: ' + type + ' = ' + numVal + ' (threshold: ' + threshold.warning + ')');
    // Warning only — log, no auto-trigger
  } else if (wasDanger) {
    alarmActive = false;
    console.log('[ALARM] Cleared. ' + type + ' = ' + numVal + ' (safe)');
    triggerActuators('0');
  }
}

// ── Trigger all actuators ────────────────────────────────────────────────────
function triggerActuators(value) {
  const actuatorTypes = ['ExhaustFan', 'Buzzer', 'LED_Warning'];
  map.forEach(function(deviceObj, name) {
    if (actuatorTypes.includes(deviceObj.type)) {
      console.log('[ACTUATOR] Setting ' + name + ' (' + deviceObj.type + ') → ' + value);
      updateDevice(deviceObj.typeIndex, name, value);
    }
  });
}

// ── Auth routes (public) ──────────────────────────────────────────────────────
app.post('/login', login);

// ── Static dashboard ──────────────────────────────────────────────────────────
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname + '/public/dashboard.html'));
});

// ── Get user info ─────────────────────────────────────────────────────────────
app.get('/me', verifyToken, function(req, res) {
  res.json({ username: req.user.username, role: req.user.role });
});

// ── Get templates ─────────────────────────────────────────────────────────────
app.get('/templates', verifyToken, function(req, res) {
  res.send(templates);
});

// ── Get all devices ───────────────────────────────────────────────────────────
app.get('/devices', verifyToken, function(req, res) {
  var devices = [];
  var keys    = map.keys();
  var pending = keys.length;

  if (pending === 0) { return res.send([]); }

  keys.forEach(function(key) {
    var value = map.get(key);

    if (value.stream === 'up') {
      // Sensors — fetch latest real value from Mobius
      var options = {
        uri: cseURL + '/' + config.cse.name + '/' + key + '/DATA/la',
        method: 'GET',
        headers: {
          'X-M2M-Origin': 'C' + key,
          'X-M2M-RI': 'req' + requestNr++,
          'Accept': 'application/json'
        }
      };
      if (cseRelease !== '1') options.headers['X-M2M-RVI'] = '3';

      request(options, function(err, resp, body) {
        var liveData = value.data;
        if (!err && resp && resp.statusCode === 200) {
          try {
            var parsed = (typeof body === 'string') ? JSON.parse(body) : body;
            var con = parsed['m2m:cin'] ? parsed['m2m:cin'].con : null;
            if (con !== null && con !== undefined) liveData = con.toString();
          } catch(e) {}
        }

        value.data = liveData;
        map.set(key, value);

        const threshold = THRESHOLDS[value.type];
        let status = 'safe';
        if (threshold) {
          const num = parseFloat(liveData);
          if      (num >= threshold.danger)  status = 'danger';
          else if (num >= threshold.warning) status = 'warning';
        }

        devices.push({
          typeIndex: value.typeIndex,
          name:   key,
          type:   value.type,
          data:   liveData,
          icon:   value.icon,
          unit:   value.unit,
          stream: value.stream,
          status: status
        });

        pending--;
        if (pending === 0) res.send(devices);
      });

    } else {
      // Actuators — read from in-memory map
      devices.push({
        typeIndex: value.typeIndex,
        name:   key,
        type:   value.type,
        data:   value.data,
        icon:   value.icon,
        unit:   value.unit,
        stream: value.stream,
        status: 'safe'
      });
      pending--;
      if (pending === 0) res.send(devices);
    }
  });
});

// ── Delete device — admin only ────────────────────────────────────────────────
app.delete('/devices/:name', verifyToken, requireAdmin, function(req, res) {
  map.remove(req.params.name);
  deleteAE(req.params.name);
  res.sendStatus(204);
});

// ── Manual actuator control — admin only ──────────────────────────────────────
app.post('/devices/:name', verifyToken, requireAdmin, function(req, res) {
  let typeIndex = req.query.typeIndex;
  let name      = req.params.name;
  let value     = req.query.value;
  updateDevice(typeIndex, name, value);
  res.sendStatus(201);
});

// ── Create device — admin only ────────────────────────────────────────────────
app.post('/devices', verifyToken, requireAdmin, function(req, res) {
  let typeIndex = req.query.type;
  let name      = req.query.name;
  var object = {
    typeIndex: typeIndex,
    type:   templates[typeIndex].type,
    data:   random(templates[typeIndex].min, templates[typeIndex].max),
    icon:   templates[typeIndex].icon,
    unit:   templates[typeIndex].unit,
    stream: templates[typeIndex].stream
  };
  map.set(name, object);
  createAE(name, typeIndex);
  res.sendStatus(201);
});

// ── Alarm status ──────────────────────────────────────────────────────────────
app.get('/alarm', verifyToken, function(req, res) {
  res.json({ alarmActive });
});

// ── Manual alarm reset — admin only ──────────────────────────────────────────
app.post('/alarm/reset', verifyToken, requireAdmin, function(req, res) {
  alarmActive = false;
  triggerActuators('0');
  console.log('[ALARM] Manually reset by:', req.user.username);
  res.json({ message: 'Alarm reset. Actuators turned off.' });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(config.app.port, function() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  SecureKitchen System (SKS) started  ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('Dashboard : http://localhost:' + config.app.port);
  console.log('CSE target: ' + cseURL);
  console.log('Credentials: admin/admin123  |  viewer/viewer123');

  // Auto-register all 6 SKS devices on startup
  setTimeout(function() {
    console.log('[AUTO-REGISTER] Registering SKS devices...');
    var defaults = [
      { type: 0, name: 'Gas'        },
      { type: 1, name: 'Suhu'       },
      { type: 2, name: 'Kelembapan' },
      { type: 3, name: 'Kipas'      },
      { type: 4, name: 'Alarm'      },
      { type: 5, name: 'Lampu'      }
    ];
    defaults.forEach(function(d, i) {
      setTimeout(function() {
        if (!map.has(d.name)) {
          var object = {
            typeIndex: d.type,
            type:   templates[d.type].type,
            data:   random(templates[d.type].min, templates[d.type].max),
            icon:   templates[d.type].icon,
            unit:   templates[d.type].unit,
            stream: templates[d.type].stream
          };
          map.set(d.name, object);
          createAE(d.name, d.type);
          console.log('[AUTO-REGISTER] ' + d.name + ' (' + templates[d.type].type + ')');
        }
      }, i * 800);
    });
  }, 1000);
});

// ── Poll Mobius every 5s for live sensor data ─────────────────────────────────
setInterval(function() {
  map.forEach(function(value, key) {
    if (value.stream !== 'up') return;
    var opts = {
      uri: cseURL + '/' + config.cse.name + '/' + key + '/DATA/la',
      method: 'GET',
      headers: {
        'X-M2M-Origin': 'C' + key,
        'X-M2M-RI': 'rp' + requestNr++,
        'Accept': 'application/json'
      },
      json: true
    };
    if (cseRelease !== '1') opts.headers['X-M2M-RVI'] = '3';
    request(opts, function(err, resp, body) {
      if (!err && resp && resp.statusCode === 200 && body && body['m2m:cin']) {
        var con = body['m2m:cin'].con;
        if (con !== undefined && con !== null) {
          value.data = con.toString();
          map.set(key, value);
          checkAlarm(value.type, value.data);
          console.log('[LIVE] ' + key + ' = ' + con);
        }
      }
    });
  });
}, 5000);

// ═════════════════════════════════════════════════════════════════════════════
// oneM2M helper functions
// ═════════════════════════════════════════════════════════════════════════════

function listen(name, typeIndex) {
  app.post('/S' + name, function(req, res) {
    var req_body = req.body['m2m:sgn'].nev.rep['m2m:cin'];
    if (req_body != undefined) {
      var content = (req.body['m2m:sgn'].nev.rep['m2m:cin'].con == '1') ? '1' : '0';
      console.log('[NOTIFICATION] ' + templates[typeIndex].type + ' ' + name + ' = ' + content);

      // ── FIX: Only update in-memory map + forward to ESP32.
      // Do NOT call updateDevice() here — that would write back to Mobius
      // and trigger another notification, causing an infinite loop.
      var object = {
        typeIndex: typeIndex,
        type:   templates[typeIndex].type,
        data:   content,
        icon:   templates[typeIndex].icon,
        unit:   templates[typeIndex].unit,
        stream: templates[typeIndex].stream
      };
      map.set(name, object);
      forwardToESP32(name, content);

      res.set('X-M2M-RSC', 2000);
      res.status(200);
      if (cseRelease != '1') res.set('X-M2M-RVI', cseRelease);
      res.send();
    }
  });
}

function createAE(name, typeIndex) {
  console.log('\n[REQUEST]');

  var aeBody = {
    'rn':  name,
    'api': 'Naapp.securekitchen.com',
    'rr':  false,
    'srv': ['3']
  };

  if (templates[typeIndex].stream == 'down') {
    aeBody['rr']  = true;
    aeBody['poa'] = ['http://' + config.app.ip + ':' + config.app.port + '/S' + name];
    listen(name, typeIndex);
  }

  var options = {
    uri: cseURL + '/' + config.cse.name,
    method: 'POST',
    headers: {
      'X-M2M-Origin': 'C' + name,
      'X-M2M-RI':     'req' + requestNr,
      'X-M2M-RVI':    '3',
      'Content-Type': 'application/vnd.onem2m-res+json;ty=2',
      'Accept':        'application/json'
    },
    json: { 'm2m:ae': aeBody }
  };

  if (cseRelease == '1') {
    options.headers['X-M2M-Origin'] = 'S' + name;
    delete options.headers['X-M2M-RVI'];
    delete options.json['m2m:ae']['srv'];
  }

  requestNr += 1;
  request(options, function(err, resp, body) {
    console.log('[RESPONSE]');
    if (err) {
      console.log('AE Creation error: ' + err);
    } else {
      console.log('AE Creation: ' + resp.statusCode);
      if (resp.statusCode == 409) {
        resetAE(name, typeIndex);
      } else {
        if (config.cse.acp_required) createAccessControlPolicy(name, typeIndex);
        else createDataContainer(name, typeIndex);
      }
    }
  });
}

function deleteAE(name) {
  var options = {
    uri: cseURL + '/' + config.cse.name + '/' + name,
    method: 'DELETE',
    headers: { 'X-M2M-Origin': 'S' + name, 'X-M2M-RI': 'req' + requestNr }
  };
  if (cseRelease != '1') options.headers['X-M2M-RVI'] = cseRelease;
  requestNr += 1;
  request(options, function(err, resp, body) {
    if (err) console.log(err);
    else     { console.log(resp.statusCode); console.log(body); }
  });
}

function resetAE(name, typeIndex) {
  var options = {
    uri: cseURL + '/' + config.cse.name + '/' + name,
    method: 'DELETE',
    headers: { 'X-M2M-Origin': 'S' + name, 'X-M2M-RI': 'req' + requestNr }
  };
  if (cseRelease != '1') options.headers['X-M2M-RVI'] = cseRelease;
  requestNr += 1;
  request(options, function(err, resp, body) {
    if (err) console.log(err);
    else     { console.log(resp.statusCode); createAE(name, typeIndex); }
  });
}

function createAccessControlPolicy(name, typeIndex) {
  var options = {
    uri: cseURL + '/' + config.cse.name + '/' + name,
    method: 'POST',
    headers: {
      'X-M2M-Origin': 'S' + name,
      'X-M2M-RI':     'req' + requestNr,
      'Content-Type': 'application/json;ty=1'
    },
    json: {
      'm2m:acp': {
        'rn':  'MyACP',
        'pv':  { 'acr': [{ 'acor': ['all'], 'acop': 63 }] },
        'pvs': { 'acr': [{ 'acor': ['all'], 'acop': 63 }] }
      }
    }
  };
  if (cseRelease != '1') options.headers['X-M2M-RVI'] = cseRelease;
  requestNr += 1;
  request(options, function(err, resp, body) {
    if (err) console.log(err);
    else {
      console.log(resp.statusCode);
      acpi = { 'acpi': [config.cse.name + '/' + name + '/MyACP'] };
      createDataContainer(name, typeIndex);
    }
  });
}

function createDataContainer(name, typeIndex) {
  var options = {
    uri: cseURL + '/' + config.cse.name + '/' + name,
    method: 'POST',
    headers: {
      'X-M2M-Origin': 'C' + name,
      'X-M2M-RI':     'req' + requestNr,
      'X-M2M-RVI':    '3',
      'Content-Type': 'application/vnd.onem2m-res+json;ty=3',
      'Accept':        'application/json'
    },
    json: { 'm2m:cnt': Object.assign({ 'rn': 'DATA', 'mni': 10000 }, acpi) }
  };
  requestNr += 1;
  request(options, function(err, resp, body) {
    if (err) console.log(err);
    else {
      console.log(resp.statusCode);
      if (templates[typeIndex].stream == 'down') {
        createCommandContainer(name, typeIndex);
      }
    }
  });
}

function createCommandContainer(name, typeIndex) {
  var options = {
    uri: cseURL + '/' + config.cse.name + '/' + name,
    method: 'POST',
    headers: {
      'X-M2M-Origin': 'C' + name,
      'X-M2M-RI':     'req' + requestNr,
      'X-M2M-RVI':    '3',
      'Content-Type': 'application/vnd.onem2m-res+json;ty=3',
      'Accept':        'application/json'
    },
    json: { 'm2m:cnt': Object.assign({ 'rn': 'COMMAND', 'mni': 10000 }, acpi) }
  };
  requestNr += 1;
  request(options, function(err, resp, body) {
    if (err) console.log(err);
    else     { console.log(resp.statusCode); createSubscription(name, typeIndex); }
  });
}

// ── Update device state + write to Mobius + forward command to ESP32 ──────────
function updateDevice(typeIndex, name, data) {
  // Update in-memory map
  var object = {
    typeIndex: typeIndex,
    type:   templates[typeIndex].type,
    data:   data,
    icon:   templates[typeIndex].icon,
    unit:   templates[typeIndex].unit,
    stream: templates[typeIndex].stream
  };
  map.set(name, object);

  // Write to correct Mobius container
  var container = (templates[typeIndex].stream === 'down') ? 'COMMAND' : 'DATA';

  var options = {
    uri: cseURL + '/' + config.cse.name + '/' + name + '/' + container,
    method: 'POST',
    headers: {
      'X-M2M-Origin': 'C' + name,
      'X-M2M-RI':     'req' + requestNr,
      'X-M2M-RVI':    '3',
      'Content-Type': 'application/vnd.onem2m-res+json;ty=4',
      'Accept':        'application/json'
    },
    json: { 'm2m:cin': { 'con': data } }
  };
  requestNr += 1;
  request(options, function(err, resp, body) {
    if (err) console.log(err);
    else     { console.log('[UPDATE] ' + name + '/' + container + ' → ' + data + ' (' + resp.statusCode + ')'); }
  });

  // Forward actuator commands to ESP32 via MQTT
  if (templates[typeIndex].stream === 'down') {
    forwardToESP32(name, data);
  }
}

function createSubscription(name, typeIndex) {
  var options = {
    uri: cseURL + '/' + config.cse.name + '/' + name + '/COMMAND',
    method: 'POST',
    headers: {
      'X-M2M-Origin': 'C' + name,
      'X-M2M-RI':     'req' + requestNr,
      'X-M2M-RVI':    '3',
      'Content-Type': 'application/vnd.onem2m-res+json;ty=23',
      'Accept':        'application/json'
    },
    json: {
      'm2m:sub': {
        'rn':  'sub',
        'nu':  ['http://' + config.app.ip + ':' + config.app.port + '/S' + name + '?ct=json'],
        'nct': 2,
        'enc': { 'net': [3] }
      }
    }
  };
  requestNr += 1;
  request(options, function(err, resp, body) {
    if (err) console.log(err);
    else     { console.log(resp.statusCode); }
  });
}

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}
