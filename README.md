# 🔥 SecureKitchen System (SKS)
### IIB20804 IoT Application Security — Mini Project
### Universiti Kuala Lumpur — Malaysian Institute of Information Technology (UniKL MIIT)

---

## 👥 Team — Mar26_SecureKitchen System (SKS)

| Name | Student ID | Role |
|------|-----------|------|
| Engku Ahmad Kamil Bin Engku Dandam | 52224224256 | Leader |
| Nur Izzah Binti Mohd Razali | 52224224189 | Member |
| Fatin Farzana Binti Faizal | 52224224051 | Member |
| Nurin Irdina Binti Hj.Saiful Bahri | 52224224328 | Member |

---

## 📌 System Overview

SecureKitchen is an IoT-based smart kitchen safety monitoring system that detects gas leaks, high temperature, and abnormal humidity. It uses an ESP32 microcontroller with MQ-2 and DHT22 sensors, communicates over **MQTTS (TLS port 8883)**, stores data on a **Mobius oneM2M platform**, and displays live data on a **Node.js dashboard** protected by JWT authentication and RBAC. The dashboard is exposed publicly via **ngrok HTTPS**.

![System Overview](screenshots/System%20Overview.jpeg)

```
ESP32 (MQ2 + DHT22)
       ↓  MQTTS (TLS port 8883)
Mosquitto MQTT Broker
       ↓  MQTT (port 1883 internal)
Mobius oneM2M Server (port 7579)
       ↓  HTTP polling every 5 seconds
SKS Dashboard (port 8369)
       ↓  ngrok HTTPS tunnel
https://xxxx.ngrok-free.app  ← lecturer accesses here
```

---

## 🔌 Circuit Diagram

![Circuit Diagram](screenshots/Circuit%20diagram.jpeg)

---

## 🛠️ Hardware Requirements

| Component | Pin |
|-----------|-----|
| MQ-2 Gas Sensor (AO) | GPIO 34 |
| DHT22 Temperature & Humidity | GPIO 4 |
| Relay — Exhaust Fan | GPIO 26 |
| Relay — Buzzer | GPIO 27 |
| NeoPixel LED Strip (8 LEDs) | GPIO 13 |

---

## 💻 Software Requirements

- Node.js v18+
- MySQL (for Mobius)
- Mosquitto MQTT Broker v2.1+
- ngrok (for HTTPS public access)
- Arduino IDE 2.x (for ESP32)
- Arduino Libraries: `WiFi`, `WiFiClientSecure`, `PubSubClient`, `DHT`, `ArduinoJson`, `Adafruit_NeoPixel`

---

## ⚙️ Setup Instructions

### Step 1 — Start Mosquitto with MQTTS

Edit `C:\Program Files\mosquitto\mosquitto.conf`:

```
listener 1883
allow_anonymous true

listener 8883
cafile C:\path\to\Mobius-master\mobius\ca-crt.pem
certfile C:\path\to\Mobius-master\mobius\server-crt.pem
keyfile C:\path\to\Mobius-master\mobius\server-key.pem
allow_anonymous true
```

Start Mosquitto (run as Administrator):
```
net start mosquitto
```

---

### Step 2 — Start Mobius oneM2M Server

```bash
cd Mobius-master
node mobius.js
```

Wait until you see:
```
mobius server running at 7579 port
sgn_mqtt_client is connected
```

![Mobius Server Running](screenshots/mobius%20js.jpeg)

---

### Step 3 — Install SKS dependencies

```bash
cd SKS
npm install
```

---

### Step 4 — Configure SKS

Edit `config/default.json`:

```json
{
    "cse": {
        "ip": "127.0.0.1",
        "port": 7579,
        "id": "Mobius",
        "name": "Mobius",
        "release": "1",
        "acp_required": false
    },
    "app": {
        "ip": "YOUR_PC_IP",
        "port": 8369
    }
}
```

> Replace `YOUR_PC_IP` with your actual PC IP (run `ipconfig` to find it).

---

### Step 5 — Start SKS Dashboard

```bash
node app.js
```

Expected output:
```
SecureKitchen System (SKS) started
Dashboard : http://localhost:8369
CSE target: http://127.0.0.1:7579
[MQTT-FWD] Connected to local broker (127.0.0.1:1883)
[AUTO-REGISTER] Gas → 201
[AUTO-REGISTER] Suhu → 201
[AUTO-REGISTER] Kelembapan → 201
```

![app.js running](screenshots/app%20js.jpeg)

---

### Step 6 — Expose Dashboard via ngrok (HTTPS)

> **Important:** Lecturer requires HTTPS access — we use ngrok to get a public HTTPS URL.

#### Install ngrok
Download from: https://ngrok.com/download

#### Run ngrok
Open a new CMD window and run:
```bash
ngrok http 8369
```

![ngrok running](screenshots/ngrok.jpeg)

You will see output like:
```
Forwarding  https://abcd1234.ngrok-free.app → http://localhost:8369
```

#### Share with lecturer
```
https://abcd1234.ngrok-free.app
```

> **Note:** The ngrok URL changes every time you restart. Keep the CMD window open during your demo.

> **Note:** Keep `config/default.json` → `app.ip` as your **private PC IP** (not ngrok URL). The private IP is needed for Mobius callbacks to work correctly.

---

### Step 7 — Flash ESP32

Open `SKS_ESP32/SKS_ESP32.ino` in Arduino IDE.

Update these lines:
```cpp
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* MQTT_BROKER   = "YOUR_PC_IP";
```

Upload to ESP32. Open Serial Monitor (115200 baud):
```
[WiFi] Connected! IP: 10.x.x.x
[MQTT] Connected via MQTTS!
[SENSOR] Gas: 160 ppm | Temp: 32.0 C | Hum: 69.5%
[MQTT] Gas = 160 → OK
```

---

## 🖥️ Dashboard Screenshots

### ✅ Safe State
All sensors within normal range. Actuators on standby.

![Safe State](screenshots/Safe%20state.jpeg)

### ⚠️ Warning State
Gas level between 299–499 ppm. System monitoring closely.

![Warning State](screenshots/Warning%20state.jpeg)

### 🚨 Danger State (Critical Alert)
Gas level ≥ 500 ppm. Exhaust fan, buzzer, and LED auto-triggered.

![Danger State](screenshots/Dashboard1.jpeg)

### 🔧 Admin View — Actuator Control & Deploy
Admin can control actuators, deploy new devices, and remove existing ones.

![Admin Dashboard](screenshots/Dashboard2.jpeg)

---

## 🗄️ Mobius oneM2M Platform

### Resource Browser
All devices registered as Application Entities (AE) in Mobius. Sensor data stored as ContentInstances (CIN) inside DATA containers.

![Mobius Monitor](screenshots/mobius%20monitor.jpeg)

### MySQL Database (mobiusdb)
Sensor data persisted in MySQL via Mobius CIN table.

![Mobius Database](screenshots/mobiusdb.jpeg)

---

## 🔐 Security Features

### 1. MQTTS — TLS Encrypted MQTT (Port 8883)
- ESP32 uses `WiFiClientSecure` with TLS
- All sensor data transmitted over encrypted channel
- Verified with Wireshark — shows **TLSv1.2 Application Data** (encrypted payload)

![Wireshark TLS Capture](screenshots/Wireshark.png)

### 2. HTTPS via ngrok
- Dashboard exposed publicly via ngrok HTTPS tunnel
- Protects dashboard traffic with TLS encryption

### 3. JWT Authentication
- Every API request requires a valid JWT token
- Header: `Authorization: Bearer <token>`
- Tokens expire after **8 hours**
- Login endpoint: `POST /login`

### 4. Role-Based Access Control (RBAC)
- **Admin** — full access: view, add, delete, control actuators, reset alarm
- **Viewer** — read-only: cannot control actuators or modify devices

### 5. Alarm Auto-Trigger Logic

| Sensor | Safe | Warning | Danger |
|--------|------|---------|--------|
| Gas (MQ-2) | < 299 ppm | 299–499 ppm | ≥ 500 ppm |
| Temperature | < 38 °C | 38–39.9 °C | ≥ 40 °C |
| Humidity | < 85 % | 85–94.9 % | ≥ 95 % |

When **DANGER** threshold is crossed:
- 🌀 Exhaust fan turns ON automatically
- 🔔 Buzzer sounds automatically
- 🔴 LED turns RED automatically
- 🚨 Dashboard shows DANGER status

### 6. oneM2M Platform (Mobius)
- Devices registered as Application Entities (AE)
- Sensor data stored in DATA containers (ContentInstances)
- Actuators use COMMAND containers + Subscriptions

---

## 🔑 Login Credentials

| Role | Username | Password | Permissions |
|------|----------|----------|-------------|
| Admin | `admin` | `admin123` | View + Control + Add + Delete + Reset alarm |
| Viewer | `viewer` | `viewer123` | View only (read-only) |

---

## 📡 Devices

| Dashboard Name | Type | Direction |
|---------------|------|-----------|
| Gas | Gas_MQ2 | Sensor (up) |
| Suhu | Temperature | Sensor (up) |
| Kelembapan | Humidity | Sensor (up) |
| Kipas | ExhaustFan | Actuator (down) |
| Alarm | Buzzer | Actuator (down) |
| Lampu | LED_Warning | Actuator (down) |

---

## 🌐 API Endpoints

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| POST | `/login` | No | Any | Get JWT token |
| GET | `/me` | JWT | Any | Get current user info |
| GET | `/devices` | JWT | Any | List all devices + live data |
| POST | `/devices` | JWT | Admin | Add new device |
| POST | `/devices/:name` | JWT | Admin | Control actuator |
| DELETE | `/devices/:name` | JWT | Admin | Remove device |
| GET | `/alarm` | JWT | Any | Get alarm status |
| POST | `/alarm/reset` | JWT | Admin | Reset alarm + turn off actuators |
| GET | `/templates` | JWT | Any | Get device templates |

---

## 📨 MQTTS Topics

| Topic | Direction | Description |
|-------|-----------|-------------|
| `/oneM2M/req/ESP32/Mobius2/json` | ESP32 → Mobius | Sensor data publish |
| `/oneM2M/req/Mobius2/ESP32/json` | Mobius → ESP32 | Actuator commands |

---

## 🚀 Quick Start (All-in-One)

Double-click `start_SKS.bat` on Desktop **(Run as Administrator)**.

This automatically:
1. Starts Mosquitto MQTTS broker
2. Starts Mobius oneM2M server
3. Starts SKS Dashboard
4. Opens browser at `http://localhost:8369`

Then separately run ngrok:
```bash
ngrok http 8369
```

Share the HTTPS URL with your lecturer.

---

## 📁 Folder Structure

```
SKS/
├── app.js                  ← Main dashboard server
├── config/
│   └── default.json        ← IP and port config
├── SKS_ESP32/
│   └── SKS_ESP32.ino       ← Arduino firmware
├── screenshots/            ← All screenshots for README
└── start_SKS.bat           ← One-click startup script
```

---

> **Course:** IIB20804 IoT Application Security | **UniKL MIIT** | 2026
