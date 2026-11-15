/**
 * Camera placement: capture the work area (webcam or photo), click the four corners of the frame
 * the laser traces, and get a straightened picture of the field to design on top of.
 */
import { useEffect, useRef, useState } from 'react';
import type { Point } from '../shared/lp2.ts';
import { straighten } from './camera.ts';
import { Modal } from './dialogs.tsx';

const SAVED_KEY = 'lightrunner.camera';
const OUT_SIZE = 1000; // 0.1 mm per pixel
const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

interface Saved {
  source: string;
  width: number;
  height: number;
  corners: Point[];
}

const loadSaved = (): Saved | null => {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null');
  } catch {
    return null;
  }
};

interface Props {
  connected: boolean;
  previewing: boolean;
  onTraceField: () => Promise<void>;
  onStopTrace: () => Promise<void>;
  onDone: (url: string) => void;
  onCancel: () => void;
}

export function CameraDialog({ connected, previewing, onTraceField, onStopTrace, onDone, onCancel }: Props) {
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [source, setSource] = useState<string>('');
  const [photo, setPhoto] = useState<{ url: string; data: ImageData } | null>(null);
  const [corners, setCorners] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const saved = loadSaved();

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => {
        const v = d.filter((x) => x.kind === 'videoinput');
        setCams(v);
        setSource((s) => s || saved?.source || v[0]?.deviceId || 'file');
      })
      .catch(() => setSource('file'));
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // Live view of the chosen webcam.
  useEffect(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (!source || source === 'file' || photo) return;
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: source }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((s) => {
        stream.current = s;
        if (video.current) video.current.srcObject = s;
        setError(null);
      })
      .catch((e) => setError(`Couldn't open the camera: ${(e as Error).message}`));
  }, [source, photo]);

  const useImage = (canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    setPhoto({ url: canvas.toDataURL('image/jpeg', 0.9), data });
    // Reuse the saved corners if this is the same camera at the same size.
    if (saved && saved.source === source && saved.width === canvas.width && saved.height === canvas.height) setCorners(saved.corners);
    else setCorners([]);
  };

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return setError('The camera has no picture yet.');
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    useImage(c);
  };

  const fromFile = (file: File | undefined) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      setSource('file');
      useImage(c);
    };
    img.onerror = () => setError('That photo could not be read.');
    img.src = URL.createObjectURL(file);
  };

  const clickPhoto = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!photo || corners.length >= 4) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * photo.data.width;
    const y = ((e.clientY - r.top) / r.height) * photo.data.height;
    setCorners([...corners, [x, y]]);
  };

  const finish = () => {
    if (!photo || corners.length !== 4) return;
    try {
      const out = straighten(photo.data.data, photo.data.width, photo.data.height, corners, OUT_SIZE);
      const c = document.createElement('canvas');
      c.width = OUT_SIZE;
      c.height = OUT_SIZE;
      c.getContext('2d')!.putImageData(new ImageData(out, OUT_SIZE, OUT_SIZE), 0, 0);
      localStorage.setItem(SAVED_KEY, JSON.stringify({ source, width: photo.data.width, height: photo.data.height, corners }));
      onDone(c.toDataURL('image/jpeg', 0.85));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Camera placement" onClose={onCancel}>
      <ol className="steps">
        <li>Put the object under the laser. Use a webcam that stays still, or take a photo from straight above.</li>
        <li>
          Have the LP2 trace the whole field with its light, so the field's edges show in the picture.{' '}
          {previewing ? (
            <button className="small" onClick={() => onStopTrace()}>
              Stop the light
            </button>
          ) : (
            <button className="small" disabled={!connected} onClick={() => onTraceField().catch((e) => setError((e as Error).message))} title={connected ? '' : 'Connect the laser first'}>
              Trace the field
            </button>
          )}
        </li>
        <li>Capture, then click the four corners of the traced square: top-left, top-right, bottom-right, bottom-left.</li>
      </ol>

      <div className="row">
        <label className="grow">
          Camera
          <select value={source} onChange={(e) => (setPhoto(null), setSource(e.target.value))}>
            {cams.map((c, i) => (
              <option key={c.deviceId || i} value={c.deviceId}>
                {c.label || `Camera ${i + 1}`}
              </option>
            ))}
            <option value="file">A photo file</option>
          </select>
        </label>
        {source !== 'file' && !photo && (
          <button className="primary" onClick={capture}>
            Capture
          </button>
        )}
        {source === 'file' && !photo && <button onClick={() => fileInput.current?.click()}>Choose photo…</button>}
        {photo && (
          <button onClick={() => (setPhoto(null), setCorners([]))} title="Take the picture again">
            Retake
          </button>
        )}
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
      </div>

      <div className="camera-view">
        {!photo && source !== 'file' && <video ref={video} autoPlay muted playsInline />}
        {photo && (
          <div className="photo-wrap">
            <img src={photo.url} alt="Captured work area" onClick={clickPhoto} />
            <svg viewBox={`0 0 ${photo.data.width} ${photo.data.height}`} preserveAspectRatio="none">
              {corners.length > 1 && <polygon points={corners.map((p) => p.join(',')).join(' ')} className="cam-frame" />}
              {corners.map(([x, y], i) => (
                <g key={i}>
                  <circle cx={x} cy={y} r={Math.max(photo.data.width, photo.data.height) / 120} className="cam-dot" />
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>
      {photo && (
        <p className="hint">
          {corners.length < 4 ? `Click the ${CORNER_NAMES[corners.length]} corner of the traced square.` : 'All four corners set.'}{' '}
          {corners.length > 0 && (
            <button className="small" onClick={() => setCorners([])}>
              Clear corners
            </button>
          )}
        </p>
      )}
      {error && <p className="warn">{error}</p>}
      <div className="buttons">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!photo || corners.length !== 4} onClick={finish}>
          Show under my design
        </button>
      </div>
    </Modal>
  );
}
