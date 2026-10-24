#!/usr/bin/env python3
"""
CCTV AI Detector using YOLOv8 (CPU mode).
Polls camera frames from go2rtc every 2 seconds, runs object detection,
and sends events to the CCTV Dashboard at http://127.0.0.1:3000.
"""

import os
import sys
import time
import base64
import signal
import requests
import cv2
import numpy as np
from pathlib import Path
from ultralytics import YOLO

# 1. READ CONFIGURATION FROM .ENV
BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"

config = {}
if ENV_FILE.exists():
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                config[key.strip()] = val.strip()

DASHBOARD_URL = config.get("DASHBOARD_URL", "http://127.0.0.1:3000")
GO2RTC_API = config.get("GO2RTC_API_URL", "http://127.0.0.1:1984")
DETECTOR_TOKEN = config.get("DETECTOR_TOKEN", "")
INTERVAL_SEC = float(config.get("DETECTOR_INTERVAL_SEC", "2"))
MODEL_PATH = str(BASE_DIR / config.get("YOLO_MODEL", "models/yolov8n.pt"))
IMG_SIZE = int(config.get("YOLO_IMG_SIZE", "640"))
CONFIDENCE = float(config.get("YOLO_CONFIDENCE", "0.45"))

# Target classes of interest (COCO dataset)
TARGET_CLASSES = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    15: "cat",
    16: "dog"
}

# Cooldown tracker to prevent duplicate event spam (15 seconds per camera per class)
ALERT_COOLDOWN_SEC = 15
last_alert_time = {}  # (cam_id, label) -> timestamp

running = True
def handle_exit(signum, frame):
    global running
    print("\n[AI Detector] Stopping cleanly...")
    running = False

signal.signal(signal.SIGINT, handle_exit)
signal.signal(signal.SIGTERM, handle_exit)

def load_yolo_model():
    print(f"[AI Detector] Loading YOLOv8 model from {MODEL_PATH} (CPU mode)...")
    model = YOLO(MODEL_PATH)
    # Warm up model on a blank image
    dummy = np.zeros((IMG_SIZE, IMG_SIZE, 3), dtype=np.uint8)
    model.predict(source=dummy, imgsz=IMG_SIZE, device="cpu", verbose=False)
    print("[AI Detector] YOLO model loaded successfully!")
    return model

def get_active_streams():
    """Fetch registered stream IDs from go2rtc"""
    try:
        resp = requests.get(f"{GO2RTC_API}/api/streams", timeout=2)
        if resp.status_code == 200:
            data = resp.json()
            return list(data.keys())
    except Exception:
        pass
    return []

def grab_snapshot(stream_name):
    """Grab latest JPEG frame directly from go2rtc"""
    url = f"{GO2RTC_API}/api/frame.jpeg?src={stream_name}"
    try:
        resp = requests.get(url, timeout=3)
        if resp.status_code == 200 and resp.content:
            img_array = np.frombuffer(resp.content, dtype=np.uint8)
            img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
            return img
    except Exception:
        pass
    return None

def send_event_to_dashboard(cam_id, label, confidence, annotated_img):
    """Send detection event and snapshot to dashboard"""
    # Encode annotated image to JPEG base64
    _, buf = cv2.imencode(".jpg", annotated_img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    img_b64 = base64.b64encode(buf).decode("utf-8")

    payload = {
        "cameraId": cam_id,
        "cameraName": cam_id.replace("cam_", "Camera "),
        "label": label,
        "confidence": float(confidence),
        "imageBase64": img_b64,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    }

    headers = {
        "Authorization": f"Bearer {DETECTOR_TOKEN}",
        "Content-Type": "application/json"
    }

    try:
        resp = requests.post(f"{DASHBOARD_URL}/api/events", json=payload, headers=headers, timeout=5)
        if resp.status_code == 200:
            print(f"[EVENT SENT] Camera: {cam_id} | Detected: {label} ({int(confidence*100)}%)")
    except Exception as e:
        print(f"[AI Detector] Error sending event to dashboard: {e}")

def main():
    print("=" * 60)
    print(" CCTV YOLO AI Detector - Running natively on Windows")
    print(f" Dashboard: {DASHBOARD_URL}")
    print(f" go2rtc:    {GO2RTC_API}")
    print(f" Interval:  {INTERVAL_SEC} seconds | ImgSize: {IMG_SIZE}")
    print("=" * 60)

    model = load_yolo_model()

    while running:
        streams = get_active_streams()
        now = time.time()

        for stream_id in streams:
            if not running:
                break
            # Skip test probe streams
            if stream_id.startswith("test_probe_"):
                continue

            frame = grab_snapshot(stream_id)
            if frame is None:
                continue

            results = model.predict(source=frame, imgsz=IMG_SIZE, conf=CONFIDENCE, device="cpu", verbose=False)

            if not results or len(results) == 0:
                continue

            boxes = results[0].boxes
            if boxes is None or len(boxes) == 0:
                continue

            # Process detected objects
            annotated = None
            for box in boxes:
                cls_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                if cls_id in TARGET_CLASSES:
                    label = TARGET_CLASSES[cls_id]
                    cooldown_key = (stream_id, label)
                    last_time = last_alert_time.get(cooldown_key, 0)

                    if now - last_time >= ALERT_COOLDOWN_SEC:
                        last_alert_time[cooldown_key] = now
                        if annotated is None:
                            annotated = results[0].plot()
                        send_event_to_dashboard(stream_id, label, conf, annotated)

        # Sleep interval between camera checks
        time.sleep(INTERVAL_SEC)

if __name__ == "__main__":
    main()
