# Light Runner

A Windows desktop app by RG Studios for designing and engraving on the **LaserPecker LP2** over USB,
without LaserPecker Design Space.

## What it does

**Laser**
- Connects to the LP2 over USB (CH340) and shows its firmware, status and live progress.
- **Preview** traces the frame of the selection, or of everything, with adjustable brightness.
  **Centre** shows just the centre point.
- **Engrave**, **Pause**, **Resume** and **Stop**, with a confirmation before the laser fires.
- Outlines that share the same power, depth and passes are sent as one job, which saves an upload
  and a start for each.
- LP2 settings: beep and reverse engraving direction.

**Designs**
- Import:
  - **SVG** and **DXF** drawings (lines, polylines with arcs, circles, arcs, ellipses, splines).
  - **G-code** (G0–G3, inches or mm, absolute or relative).
  - **Pictures** (PNG, JPG, BMP, WebP, GIF).
  - Use the Import button or drop files on the window.
- Add **text** (choice of fonts, bold, italic) and **shapes**: square, rounded square, circle,
  hexagon, star, heart, line.
- Move, size, **rotate**, **mirror** and **align** to the 100 × 100 mm field.
- Zoom (mouse wheel) and pan (drag empty space), with optional snap to whole millimetres.
- **Undo and redo**, duplicate, copy and paste, and layer order (the order things are engraved in).
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

**Other**
- **Export G-code** for an outline.

## Keyboard

| Keys | Does |
| --- | --- |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+C / Ctrl+V / Ctrl+D | Copy / paste / duplicate |
| Delete | Delete the selection |
| Arrow keys | Move 1 mm (Shift: 5 mm, Alt: 0.1 mm) |
| Ctrl+I / Ctrl+O / Ctrl+S | Import / open / save |
| Esc | Deselect |

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
