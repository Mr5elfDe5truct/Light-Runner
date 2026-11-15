# Light Runner

A Windows desktop app by RG Studios for designing and engraving on the **LaserPecker LP2** over USB,
without LaserPecker Design Space.

## What it does

- Connects to the LP2 over its USB serial port (CH340) and shows its firmware, status and progress.
- Imports **SVG** outlines and **pictures** (PNG, JPG, BMP, WebP), and adds **text** and basic shapes.
- Lays out jobs on the LP2's 100 × 100 mm field: drag to move, and set size and position in mm.
- Engrave modes:
  - **Line**: outlines as G-code.
  - **Fill**: filled shapes as burn runs.
  - **Black & white**: threshold.
  - **Dither**.
  - **Greyscale**: 8-bit shades.
- Power, depth, passes and 1K/2K resolution per object. **Material presets** are read from your
  LaserPecker Design Space install, if it's present.
- **Preview** traces the frame with low light, with adjustable brightness. **Engrave**, **Pause**,
  **Resume** and **Stop** work like LDS.
- LP2 settings: beep and reverse engraving direction.
- Saves and opens projects (`.lightrunner.json`).

## Build and run

```
npm install
node node_modules/electron/install.js   # npm 11 skips Electron's download step
npm start                                 # build and open the app
npm test                                  # protocol tests against real LDS captures
npm run dist                              # Windows installer in release/
```

Close LaserPecker Design Space before connecting. Only one program can use the LP2's port at a time.

## How it works

- `shared/lp2.ts`: the LP2 protocol (frames, commands, file formats). See [docs/PROTOCOL.md](docs/PROTOCOL.md).
- `electron/device.ts`: the serial connection and job sequence (upload, engrave, status polling).
- `src/`: the React interface, image processing (`imaging.ts`) and SVG import (`vector.ts`).
- `test/fixtures/lds-captures.json`: jobs and commands captured from LDS. The tests rebuild every one byte for byte.

The protocol was worked out from USB captures of LDS 2.12.1 with an LP2 on firmware 3.7.7.
