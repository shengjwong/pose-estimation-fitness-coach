# Pose Estimation Fitness Coach

A browser prototype that uses MediaPipe Pose Landmarker to analyze exercise form from a camera feed and give real-time coaching feedback.

## Features

- Live pose landmark overlay
- Exercise modes for squat, push-up, plank, and shoulder press
- Form score, rep count, depth, alignment, tempo, and live cues
- Demo mode for trying the feedback loop without camera access
- Local static server for camera-friendly browser testing

## Run Locally

From this folder:

```powershell
powershell -ExecutionPolicy Bypass -File ".\outputs\server.ps1"
```

Then open:

```text
http://localhost:4173
```

The browser may ask for camera permission. Mobile phone cameras usually require HTTPS unless the page is opened on `localhost`.
