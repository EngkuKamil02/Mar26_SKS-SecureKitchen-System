# SecureKitchen System (SKS)
### IIB20804 IoT Application Security — Mini Project

---

## Team — Mar26_SecureKitchen System (SKS)

| Name | Student ID | Role |
|------|-----------|------|
| Engku Ahmad Kamil Bin Engku Dandam | 52224224256 | Leader |
| Nur Izzah Binti Mohd Razali | 52224224189 | Member |
| Fatin Farzana Binti Faizal | 52224224051 | Member |
| Nurin Irdina Binti Hj.Saiful Bahri | 52224224328 | Member |

---

## System Overview

SecureKitchen is an IoT-based smart kitchen safety monitoring system that detects gas leaks, high temperature, and abnormal humidity. It uses an ESP32 microcontroller with MQ-2 and DHT22 sensors, communicates over **MQTTS (TLS port 8883)**, stores data on a **Mobius oneM2M platform**, and displays live data on a **Node.js dashboard** protected by JWT authentication and RBAC. The dashboard is exposed publicly via **ngrok HTTPS**.

### System Architecture Flow

![System Overview Diagram](screenshots/System%20Overview.jpeg)

---

## Hardware Requirements

| Component | Pin |
|-----------|-----|
| MQ-2 Gas Sensor (AO) | GPIO 34 |
| DHT22 Temperature & Humidity | GPIO 4 |
| Relay — Exhaust Fan | GPIO 26 |
| Relay — Buzzer | GPIO 27 |
| NeoPixel LED Strip (8 LEDs) | GPIO 13 |

### Schematic Circuit Diagram

![Circuit Diagram](screenshots/CIrcuit%20diagram.jpeg)

---

## Software Requirements

- Node.js v18+
- MySQL (for Mobius)
- Mosquitto MQTT Broker v2.1+
- ngrok (for HTTPS public access)
- Arduino IDE 2.x (for ESP32)
- Arduino Libraries: WiFi, WiFiClientSecure, PubSubClient, DHT, ArduinoJson, Adafruit_NeoPixel

---

## Setup Instructions

### Step 1 — Start Mosquitto with MQTTS

Edit `C:\Program Files\mosquitto\mosquitto.conf`:
```text
listener 1883
allow_anonymous true

listener 8883
cafile C:\path\to\Mobius-master\mobius\ca-crt.pem
certfile C:\path\to\Mobius-master\mobius\server-crt.pem
keyfile C:\path\to\Mobius-master\mobius\server-key.pem
allow_anonymous true
