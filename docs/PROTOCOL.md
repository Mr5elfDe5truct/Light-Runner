# LaserPecker LP2 USB protocol

Worked out from 15 USB captures of LaserPecker Design Space 2.12.1 (in `captures\`), and confirmed live:
our own code (`tools\lp2_send.py`) uploaded and engraved a job that the LP2 ran just as it runs LDS's.
`tools\lp2.py` implements everything below. `tests\test_lp2.py` rebuilds every command and file in the
captures and checks they match byte for byte.

**Confirmed** = matches every capture. **Copy as-is** = always the same value in the captures, meaning unknown.

## 1. Connection

- USB serial chip CH340, USB ID `1a86:7523`. The COM number can change between USB ports (COM5, later COM7); find it by the USB ID.
- **460,800 baud, 8 data bits, no parity, 1 stop bit, DTR and RTS on.** Confirmed live with `tools\lp2_client.py`, which only sends the two read-only queries.
- Only one program can hold the port: close LDS first.
- Multi-byte numbers are **big-endian**.

## 2. Frames (confirmed)

All commands and most replies are framed:

```
aa bb | LEN | PAYLOAD ... | SUM_HI SUM_LO
```

- `LEN` = payload length + 2.
- `SUM` = the 16-bit sum of the payload bytes.
- Replies can arrive glued together. `lp2.split_frames()` separates them.
- **File data is the only thing sent unframed.**

## 3. Commands (PC -> LP2)

| Payload | Meaning |
| --- | --- |
| `00 00 00 00 00 00` | **Status.** LDS asks about once a second during a job. Reply in section 6. |
| `00 01 00 00 00 00` | **List of stored files.** Reply: `00`, number of files, 31 four-byte ID slots (`ff ff ff ff` = empty), 2 more bytes. Confirmed live: the LP2 listed every test job's ID. |
| `00 02` / `00 03` / `00 05` / `00 08` (+ `00 00 00 00`) | Device info, asked once at connect. `00 03` reply holds the **firmware version** (`01 79` = 377 = V3.7.7). `00 05` holds the **device ID** (`… 11 bf 1f …` = LP2-11BF1F). `00 02` looks like a settings read-back. `00 08` answers `00 00`. None are needed for engraving. |
| `06 01` + 20 bytes | **Settings**, sent whole at connect and on every change. Reply `06 01`. Byte 3 = **beep** at job start/end. Byte 18 = **reverse engraving direction** (handheld). Bytes 2, 4, 9 = 1 (Free mode and Touch buttons were on; which byte is which wasn't tested). Path optimization isn't sent: it only affects how LDS orders paths. |
| `ff 00 00 00 00 00` | **Idle / stop.** Echoed back. Sent before and after every upload. Also **stops a running job** (confirmed in `stop`). |
| `05 01 SIZE(4) 00` | **Announce a file** of SIZE bytes (64-byte header + data). Reply `05 01 01` = ready. Send the file raw. Reply `05 02 01` = received, followed by `ff 01 00 00 SIZE…`. |
| `01 01 POWER DEPTH ID(4) X(2) Y(2) PASSES(2) 00 07 d0 01 MODE 3c 00 00 01` | **Engrave** the stored file with that ID. Details below. Reply `01 01`. |
| `01 04 00 65` + 18 × `00` + `01` | **Pause.** Status becomes paused. |
| `01 02 00 65` + 18 × `00` + `01` | **Resume.** |
| `02 02 W(2) H(2) X(2) Y(2) 00 04 BRIGHT 07 d0` | **Preview**: traces the job's frame with low light **until stopped with `ff`** (LDS's Exit preview). W, H, X, Y in 0.1 mm. BRIGHT = brightness (LDS slider: 1 at minimum, 5 at mid). Resending changes it live. **Centre-point** preview = W = H = 1 at the job's centre. Reply `02 02 00 01`. Status `02 02` while tracing. |

Engrave fields (all confirmed):
- **POWER** = 1–100 %.
- **DEPTH** = `101 − LDS depth` (depth 100 → `01`, depth 50 → `33`). It's really a speed.
- **ID** = the file ID from the header.
- **X, Y** = the job's top-left corner in **whole mm** (floor).
- **PASSES** = how many times to engrave.
- **MODE** = `00` for a **dithered** image, `ff` for everything else (G-code, B&W runs, greyscale/2.5D raster).
- `00 07 d0 01 … 3c 00 00 01`: copy as-is. It didn't change with resolution, position, size, power, depth or passes.

## 4. Sending a job (confirmed order)

```
-> ff (idle)                 <- ff
-> 05 01 SIZE                <- 05 01 01
-> header + data (raw)       <- 05 02 01, ff 01 …
-> ff (idle)                 <- ff
-> 01 01 … (engrave)         <- 01 01
-> 00 00 every ~1 s          <- status … until state 01 03 (finished), then 06 ff
-> ff (idle)                 <- ff
```

A job with several objects is sent as **separate jobs, one after another** (`two_line_and_picture`: the image, then the outline).

## 5. Files: 64-byte header + data

| Byte | G-code `20` | B&W runs `40` | Dithered raster `10` |
| --- | --- | --- | --- |
| 0 | `20` | `40` | `10` |
| 1–2, 3–4 | width, height | width, height (pixels) | width, height (pixels) |
| 5–8 | file ID (LDS uses 4 random bytes) | file ID | file ID |
| 9– | line count (4 bytes) = newlines + 1 | run count (4 bytes) | resolution code (1 byte) |
| next | X, Y in 0.1 mm (2+2) | resolution code (1), then X, Y in pixels (2+2) | X, Y in pixels (2+2) |
| next | dpi (2) = `00 fe` (254) | dpi (2) | dpi (2) |
| 34– | file name, ASCII, zero-padded ("Untitled") | same | same |

- **Resolution:** 1K = code `04`, 254 dpi = 0.1 mm per pixel. 2K = code `02`, 508 dpi = 0.05 mm.
- **Coordinates:** the work field is about 0–100 mm on each axis, centre (50, 50). Pixel position = mm × dpi / 25.4.
- **G-code size:** width/height are in 0.1 mm, rounded up from LDS's own unrounded shapes. Computing them from the G-code can come out one step different, which doesn't matter in practice.

### G-code data (`20`), confirmed

LDS writes exactly this shape:

```
G90
G21
M8F{speed×120}M5S0          speed = 101 − depth
G1S255
F12000
M05S0
G0 X.. Y..                  (each path) move to its start
M03S255                     laser on
G1 X.. Y..                  ... the path's points, 3 decimals
M05S0                       laser off
M05                         (end)
```

Power is **not** in the G-code (always S255). It comes from the engrave command.

### B&W runs (`40`), confirmed

- Triples of 16-bit numbers: **(start x, row y, length)**, pixels counted from 1.
- Rows go **left-to-right, then right-to-left, alternating**, starting left-to-right with the first row that has anything to burn.
- A right-to-left run starts at its right end. A row with holes has several runs, in travel order.

### Raster (`10`): dithered and greyscale, confirmed

- One byte per pixel, row by row: **`00` = darkest burn, `ff` = skip, values between = shades**.
- **Dither** mode: LDS dithers on the PC and sends only `00`/`ff`.
- **2.5D** mode (LDS's greyscale relief; LDS has no plain "Grayscale" effect): real 8-bit shades. The test gradient
  sent 101 different values, so the LP2 varies the burn per pixel.
- Pencil and Stamp effects weren't captured. They're B&W-looking effects, most likely sent as runs (`40`) or dithered raster.

## 6. Status reply (to `00 00`), confirmed

```
00 | STATE(2) | PROGRESS % | POWER | DEPTH | 00 00 | FILE ID(4) | …
```

| STATE | Meaning |
| --- | --- |
| `06 00` | idle |
| `06 ff` | idle after a job |
| `01 01` | engraving |
| `01 02` | engraving (resumed) |
| `01 03` | finished |
| `01 04` | paused |
| `02 02` | previewing |
| `02 03` | preview done |

## 7. Still open (none needed for normal jobs)

- Which of settings bytes 2, 4 and 9 is Free mode / Touch buttons. Toggling those would show it; LDS's defaults work as they are.
- **4K resolution** code (probably `01`, 1016 dpi), if LDS offers it for the LP2.
- The Versatile Electric Roller and Control Stand commands (accessories: not tested).
- `00 07 d0 01 … 3c 00 00 01` in the engrave command and `00 04` / `07 d0` in preview: always the same, copied as-is.
