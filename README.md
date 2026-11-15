# Light Runner

A Windows desktop app by RG Studios for designing and engraving on the **LaserPecker LP2** over USB,
without LaserPecker Design Space. It also drives **G-code (GRBL) diode lasers**, so one app runs both.

## What it does

**Laser**
- Connects to the LP2 over USB (CH340) and shows its firmware, status and live progress.
- Also drives **GRBL lasers**:
  - "Find out" detects which kind is on the port.
  - The bed size comes from the machine.
  - **Speed** in mm/min replaces Depth.
  - Jobs stream as G-code.
  - Preview traces the frame with the laser off.
- **Recovery**: if the cable drops it reconnects by itself and keeps following the job; it also picks
  up a job already running on the LP2 when you connect.
- **Safety checks** before firing:
  - It flags very hard burns, many passes, long jobs and codes too small to scan.
  - When those apply, you confirm you'll stay with the laser.
- **Preview** traces the frame of the selection, or of everything, with adjustable brightness.
  **Centre** shows just the centre point.
- **Engrave**, **Pause**, **Resume** and **Stop**, with a confirmation before the laser fires.
- Outlines that share the same power, depth and passes are sent as one job, which saves an upload
  and a start for each.
- LP2 settings: beep and reverse engraving direction.

**Designs**
- Import:
  - **SVG** and **DXF** drawings (lines, polylines with arcs, circles, arcs, ellipses, splines).
  - **PDF** pages, at their printed size.
  - **G-code** (G0–G3, inches or mm, absolute or relative).
  - **Pictures** (PNG, JPG, BMP, WebP, GIF).
  - Use the Import button or drop files on the window.
- Add **text** in two styles:
  - **Filled letters**: any font on the PC, bold or italic.
  - **Single line**: the fast Hershey stroke font, for labels and serial numbers.
- Add **shapes**: square, rounded square, circle, hexagon, star, heart, line.
- Add **QR codes** (four error-correction levels, optional quiet border) and **barcodes** (Code 128,
  EAN-13, UPC-A, Code 39, ITF-14).
- Move, size, **rotate**, **mirror** and **align** to the 100 × 100 mm field.
- **Select several items**:
  - Ctrl- or Shift-click, Shift-drag a box, or press Ctrl+A.
  - Move, align, delete or duplicate them together, and set the laser settings for all of them at once.
- Zoom (mouse wheel) and pan (drag empty space), with optional snap to whole millimetres.
- **Undo and redo**, duplicate, copy and paste, and layer order (the order things are engraved in).
- **Estimated job time** before you engrave, and the elapsed time while it runs.
- **Autosave**: your design comes back when you reopen the app. You can also save and open
  `.lightrunner.json` files.

**Engrave modes**
- **Line**: outlines.
- **Fill**: filled shapes.
- **Black & white**: with a threshold.
- **Dither**.
- **Greyscale**: 8-bit shades.
- **Sketch**: a pencil look.
- Pictures also have **brightness**, **contrast** and **invert**, and **Trace to outline** turns a
  picture into lines.
- Resolution is 1K (0.1 mm) or 2K (0.05 mm).

**Materials**
- **Material presets** are read from your LaserPecker Design Space install, if it's present.
- **Save…** keeps your own settings as a ★ material, for each kind of job and resolution.
- **Test grid** makes a power × depth grid of squares with labels, to find the right settings for a
  new material.

**Placing and producing**
- **Camera placement**:
  - Use a webcam or a photo, and the laser traces the field.
  - Click its four corners, and the straightened photo sits under your design.
- **Batch runs**: the same design on many parts, with `{n}` serial numbers or `{line}` names from a
  list, pausing for each part.
- **Self-test**: one of each kind of job, for checking on scrap.

**Images and shapes**
- Six dither styles: Floyd–Steinberg, Atkinson, Jarvis, Stucki, Burkes and halftone.
- Midtones (gamma), sharpen, and removing a plain background.
- **Offset** outlines inside or outside a shape.
- **Combine** shapes: union, cut out, overlap and exclude.
- Single-line text **around a circle**.

**Library and help**
- **My designs**: saved designs with thumbnails. **Job history**: the last 50 jobs, with Run again.
- Export and import your own materials to share or back up.
- A first-run guide, Help with troubleshooting, a light theme, and full keyboard use.
- About shows the version and checks GitHub for newer releases.

**Other**
- **Export G-code** for an outline.

## Keyboard

| Keys | Does |
| --- | --- |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+C / Ctrl+V / Ctrl+D | Copy / paste / duplicate |
| Ctrl+A | Select everything |
| Ctrl- or Shift-click, Shift-drag | Add to the selection, select with a box |
| Delete | Delete the selection |
| Arrow keys | Move 1 mm (Shift: 5 mm, Alt: 0.1 mm) |
| Ctrl+I / Ctrl+O / Ctrl+S | Import / open / save |
| Esc | Deselect, or close a dialog |

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
- `shared/grbl.ts`: G-code generation and streaming for GRBL lasers.
- `electron/device.ts`, `electron/grblDevice.ts`, `electron/machines.ts`: the two drivers, and picking between them.
- `electron/store.ts`: My designs and the job history.
- `src/`: the React interface, image processing (`imaging.ts`) and SVG import (`vector.ts`).
- `test/fixtures/lds-captures.json`: jobs and commands captured from LDS. The tests rebuild every one byte for byte.

The protocol was worked out from USB captures of LDS 2.12.1 with an LP2 on firmware 3.7.7.

Open-source parts and their licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
