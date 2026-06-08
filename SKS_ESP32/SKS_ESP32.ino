#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>

// ── WiFi ──────────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "HONOR_90_Lite";
const char* WIFI_PASSWORD = "12345678";

// ── MQTT (TLS) ────────────────────────────────────────────────────────────────
const char* MQTT_BROKER = "10.49.156.91";
const int   MQTT_PORT   = 8883;
const char* MQTT_CLIENT = "ESP32_SKS_01";

// ── Topics ────────────────────────────────────────────────────────────────────
#define TOPIC_PUB     "/oneM2M/req/ESP32/Mobius2/json"
#define TOPIC_CMD_SUB "/oneM2M/req/Mobius2/ESP32/json"

// ── Pins ──────────────────────────────────────────────────────────────────────
#define MQ2_PIN      34
#define DHT_PIN       4
#define DHT_TYPE      DHT22
#define RELAY_FAN    26
#define RELAY_BUZZER 27
#define NEO_PIN      13
#define NEO_COUNT     8

// ── Relay active level ────────────────────────────────────────────────────────
#define RELAY_ACTIVE_LOW  false

#if RELAY_ACTIVE_LOW
  #define RELAY_ON  LOW
  #define RELAY_OFF HIGH
#else
  #define RELAY_ON  HIGH
  #define RELAY_OFF LOW
#endif

// ── Thresholds ────────────────────────────────────────────────────────────────
// Gas:  < 299       = SAFE | 299-499 = WARNING | >= 500 = DANGER
// Temp: < 38        = SAFE | 38-39.9 = WARNING | >= 40  = DANGER
// Hum:  < 85        = SAFE | 85-94.9 = WARNING | >= 95  = DANGER
#define GAS_WARNING   299
#define GAS_DANGER    500
#define TEMP_WARNING  38.0
#define TEMP_DANGER   40.0
#define HUM_WARNING   85.0
#define HUM_DANGER    95.0

// ── Device names — MUST match Mobius / dashboard ──────────────────────────────
#define AE_GAS     "Gas"
#define AE_TEMP    "Suhu"
#define AE_HUM     "Kelembapan"
#define AE_FAN     "Kipas"
#define AE_BUZZER  "Alarm"
#define AE_LED     "Lampu"

// ── Objects ───────────────────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
WiFiClientSecure wifiClient;
PubSubClient     mqtt(wifiClient);
Adafruit_NeoPixel strip(NEO_COUNT, NEO_PIN, NEO_GRB + NEO_KHZ800);

unsigned long lastSensorTime = 0;
int    requestId = 1;
String alarmState = "safe";

// ═══════════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== SecureKitchen ESP32 Started ===");
  Serial.println("Gas:  SAFE<299 | WARNING 299-499 | DANGER>=500");
  Serial.println("Temp: SAFE<38  | WARNING 38-39.9 | DANGER>=40");
  Serial.println("Hum:  SAFE<85  | WARNING 85-94.9 | DANGER>=95");

  pinMode(RELAY_FAN,    OUTPUT);
  pinMode(RELAY_BUZZER, OUTPUT);
  digitalWrite(RELAY_FAN,    RELAY_OFF);
  digitalWrite(RELAY_BUZZER, RELAY_OFF);

  strip.begin();
  strip.setBrightness(100);
  strip.clear();
  strip.show();

  dht.begin();
  connectWiFi();

  wifiClient.setInsecure();

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(1024);
  connectMQTT();
}

void loop() {
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  if (millis() - lastSensorTime >= 5000) {
    lastSensorTime = millis();
    readAndSendSensors();
  }
}

// ── Read and send sensor data ─────────────────────────────────────────────────
void readAndSendSensors() {
  int   rawGas = analogRead(MQ2_PIN);
  float gasPPM = map(rawGas, 0, 4095, 0, 1000);
  float temp   = dht.readTemperature();
  float hum    = dht.readHumidity();

  if (isnan(temp) || isnan(hum)) {
    Serial.println("[DHT22] Read failed — skipping");
    return;
  }

  Serial.printf("[SENSOR] Gas: %.0f ppm | Temp: %.1f C | Hum: %.1f%%\n",
                gasPPM, temp, hum);

  // Print gas status
  if (gasPPM >= GAS_DANGER)        Serial.println("[GAS] DANGER!");
  else if (gasPPM >= GAS_WARNING)  Serial.println("[GAS] WARNING");
  else                             Serial.println("[GAS] SAFE");

  // Print temp status
  if (temp >= TEMP_DANGER)         Serial.println("[TEMP] DANGER!");
  else if (temp >= TEMP_WARNING)   Serial.println("[TEMP] WARNING");
  else                             Serial.println("[TEMP] SAFE");

  // Print humidity status
  if (hum >= HUM_DANGER)           Serial.println("[HUM] DANGER!");
  else if (hum >= HUM_WARNING)     Serial.println("[HUM] WARNING");
  else                             Serial.println("[HUM] SAFE");

  publishSensor(AE_GAS,  String((int)gasPPM));
  publishSensor(AE_TEMP, String(temp, 1));
  publishSensor(AE_HUM,  String(hum, 1));

  // ← FIXED: pass all 3 values
  checkAlarm(gasPPM, temp, hum);
}

// ── Publish to Mobius via MQTT ────────────────────────────────────────────────
void publishSensor(const char* ae, String val) {
  String rqi = "rq" + String(requestId++);
  String p = "{\"m2m:rqp\":{";
  p += "\"op\":1,";
  p += "\"to\":\"/Mobius/" + String(ae) + "/DATA\",";
  p += "\"fr\":\"ESP32\",";
  p += "\"rqi\":\"" + rqi + "\",";
  p += "\"ty\":4,";
  p += "\"pc\":{\"m2m:cin\":{\"con\":\"" + val + "\"}}";
  p += "}}";
  bool ok = mqtt.publish(TOPIC_PUB, p.c_str());
  Serial.printf("[MQTT] %s = %s -> %s\n", ae, val.c_str(), ok ? "OK" : "FAIL");
}

// ── Alarm logic ───────────────────────────────────────────────────────────────
void checkAlarm(float gas, float temp, float hum) {
  bool isDanger  = (gas >= GAS_DANGER)  || (temp >= TEMP_DANGER)  || (hum >= HUM_DANGER);
  bool isWarning = (gas >= GAS_WARNING) || (temp >= TEMP_WARNING) || (hum >= HUM_WARNING);

  if (isDanger) {
    if (alarmState != "danger") {
      alarmState = "danger";
      Serial.println("[ALARM] >>> DANGER! Fan + Buzzer ON, LED RED");
      setFan(true);
      setBuzzer(true);
      setNeo("red");
    }
  } else if (isWarning) {
    if (alarmState != "warning") {
      alarmState = "warning";
      Serial.println("[ALARM] WARNING — LED YELLOW");
      setFan(false);
      setBuzzer(false);
      setNeo("yellow");
    }
  } else {
    if (alarmState != "safe") {
      alarmState = "safe";
      Serial.println("[ALARM] SAFE — LED GREEN 10 seconds then OFF");
      setFan(false);
      setBuzzer(false);
      setNeo("green");
      delay(10000);
      setNeo("off");
    }
  }
}

// ── Receive actuator commands from dashboard ──────────────────────────────────
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.println("[CMD IN] " + msg);

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, msg)) {
    Serial.println("[CMD] JSON parse error");
    return;
  }

  String to  = doc["m2m:rqp"]["to"]  | "";
  String con = doc["m2m:rqp"]["pc"]["m2m:cin"]["con"] | "";
  bool on = (con == "1");

  Serial.printf("[CMD] to=%s val=%s\n", to.c_str(), con.c_str());

  if      (to.indexOf(AE_FAN)    >= 0) setFan(on);
  else if (to.indexOf(AE_BUZZER) >= 0) setBuzzer(on);
  else if (to.indexOf(AE_LED)    >= 0) setNeo(on ? "red" : "off");
}

// ── Actuators ─────────────────────────────────────────────────────────────────
void setFan(bool on) {
  digitalWrite(RELAY_FAN, on ? RELAY_ON : RELAY_OFF);
  Serial.printf("[FAN] %s\n", on ? "ON" : "OFF");
}

void setBuzzer(bool on) {
  digitalWrite(RELAY_BUZZER, on ? RELAY_ON : RELAY_OFF);
  Serial.printf("[BUZZER] %s\n", on ? "ON" : "OFF");
}

// ── NeoPixel ──────────────────────────────────────────────────────────────────
void setNeo(String color) {
  uint32_t c;
  if      (color == "red")    c = strip.Color(255,   0, 0);
  else if (color == "green")  c = strip.Color(  0, 255, 0);
  else if (color == "yellow") c = strip.Color(255, 150, 0);
  else                        c = strip.Color(  0,   0, 0);

  for (int i = 0; i < strip.numPixels(); i++)
    strip.setPixelColor(i, c);
  strip.show();
  Serial.printf("[LED] %s\n", color.c_str());
}

// ── WiFi ──────────────────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());
}

// ── MQTT (TLS) ────────────────────────────────────────────────────────────────
void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.printf("[MQTT] Connecting to %s:%d (TLS)\n", MQTT_BROKER, MQTT_PORT);
    if (mqtt.connect(MQTT_CLIENT)) {
      Serial.println("[MQTT] Connected via MQTTS!");
      mqtt.subscribe(TOPIC_CMD_SUB);
      Serial.println("[MQTT] Subscribed: " + String(TOPIC_CMD_SUB));
      setNeo("green");
      delay(1500);
      setNeo("off");
    } else {
      Serial.printf("[MQTT] Failed rc=%d, retry 3s\n", mqtt.state());
      delay(3000);
    }
  }
}
