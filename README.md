# SecureKitchen System (SKS)
### IIB20804 IoT Application Security — Mini Project

---

## Team
- Engku Ahmad Kamil (52224224256) — Leader
- Fatin Farzana (52224224051)
- Nur Izzah (52224224189)
- Nurin Irdina (52224224328)

---

## Setup Instructions

### Step 1 — Install Node.js dependencies
```bash
cd SKS
npm install
```

### Step 2 — Start ACME CSE (oneM2M platform)
Make sure ACME CSE is running on `localhost:8080`.
Default CSE name: `Mobius`

### Step 3 — Start the SKS application
```bash
node app.js
```

### Step 4 — Open the dashboard
Go to: http://localhost:8369

### Step 5 — Login
| Role   | Username | Password  | Can do                        |
|--------|----------|-----------|-------------------------------|
| Admin  | admin    | admin123  | View + control + add + reset  |
| Viewer | viewer   | viewer123 | View only (read-only)         |

### Step 6 — Add devices
Click "Add Device" and add these 6 devices:

| Name          | Type         |
|---------------|--------------|
| GasSensor1    | Gas_MQ2      |
| TempSensor1   | Temperature  |
| HumSensor1    | Humidity     |
| ExhaustFan1   | ExhaustFan   |
| Buzzer1       | Buzzer       |
| LED1          | LED_Warning  |

---

## Security Features

### 1. JWT Authentication
- Every API request requires a valid JWT token in the `Authorization: Bearer <token>` header
- Tokens expire after 8 hours
- Login endpoint: `POST /login`

### 2. Role-Based Access Control (RBAC)
- **Admin**: full access — view, add, delete, control actuators, reset alarm
- **Viewer**: read-only — cannot control actuators or add/delete devices

### 3. Alarm Logic (Auto-trigger)
| Sensor      | Warning Threshold | Danger Threshold |
|-------------|-------------------|------------------|
| Gas (MQ-2)  | 500 ppm           | 800 ppm          |
| Temperature | 45 °C             | 60 °C            |
| Humidity    | 80 %              | 90 %             |

When danger threshold is crossed:
→ Exhaust fan turns ON automatically
→ Buzzer sounds automatically
→ LED warning activates automatically
→ Red alarm banner appears on dashboard

### 4. oneM2M Platform (ACME CSE)
- All devices registered as Application Entities (AE)
- Sensor data stored in DATA containers (ContentInstances)
- Actuators use COMMAND containers + Subscriptions for real-time push
- Access Control Policies (ACP) applied per device

---

## API Endpoints

| Method | Endpoint         | Auth    | Role    | Description             |
|--------|------------------|---------|---------|-------------------------|
| POST   | /login           | No      | Any     | Get JWT token           |
| GET    | /me              | JWT     | Any     | Get current user info   |
| GET    | /devices         | JWT     | Any     | List all devices        |
| POST   | /devices         | JWT     | Admin   | Add new device          |
| POST   | /devices/:name   | JWT     | Admin   | Update actuator value   |
| DELETE | /devices/:name   | JWT     | Admin   | Remove device           |
| GET    | /alarm           | JWT     | Any     | Get alarm status        |
| POST   | /alarm/reset     | JWT     | Admin   | Reset alarm + actuators |
| GET    | /templates       | JWT     | Any     | Get device templates    |
