import type { DeviceSettings, Status } from './lp2.ts';

export interface PortInfo {
  path: string;
  label: string;
  likelyLp2: boolean; // a CH340 serial chip, as in the LP2
}

export type MachineKind = 'lp2' | 'grbl';

export interface DeviceInfo {
  kind: MachineKind;
  bed: { w: number; h: number }; // work area, mm
  profile?: import('./grbl.ts').MachineProfile; // GRBL only
  path: string;
  firmware: string | null;
  deviceId: string | null;
  storedFiles: number;
}

/** One file to upload and engrave. The file ID is read from the file's header. */
export interface JobSpec {
  name: string;
  file: Uint8Array; // LP2 job file (empty for GRBL)
  gcode?: string; // GRBL program
  power: number;
  depth: number;
  passes: number;
  xMm: number;
  yMm: number;
  dithered: boolean;
}

/** A frame to trace, in 0.1 mm. */
export interface PreviewSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  brightness: number;
}

export type RunPhase = 'idle' | 'uploading' | 'engraving' | 'paused' | 'stopping' | 'previewing';

export type LaserEvent =
  | { type: 'connection'; connected: boolean; info?: DeviceInfo; error?: string; reconnecting?: boolean }
  | { type: 'status'; status: Status }
  | { type: 'run'; phase: RunPhase; job?: number; jobs?: number; name?: string; uploaded?: number; size?: number }
  | { type: 'log'; level: 'info' | 'error'; message: string };

export interface MaterialPreset {
  mode: 'line' | 'fill' | 'image';
  dpi: number;
  power: number;
  depth: number;
  passes: number;
}

export interface Material {
  id: string;
  name: string;
  presets: MaterialPreset[];
}

export interface LibraryEntry {
  id: string;
  name: string;
  updated: number;
  thumbnail: string;
  items: number;
}

export interface HistoryEntry {
  id: string;
  at: number;
  names: string[];
  jobs: number;
  seconds: number; // how long it really took
  result: 'finished' | 'stopped' | 'failed';
}

export interface LaserApi {
  library: {
    list(): Promise<LibraryEntry[]>;
    save(name: string, design: unknown, thumbnail: string, id?: string): Promise<string>;
    load(id: string): Promise<unknown>;
    remove(id: string): Promise<void>;
    rename(id: string, name: string): Promise<void>;
  };
  history: {
    list(): Promise<HistoryEntry[]>;
    add(entry: Omit<HistoryEntry, 'id'>, design: unknown): Promise<void>;
    design(id: string): Promise<unknown>;
    clear(): Promise<void>;
  };
  materials(): Promise<Material[]>;
  /** The design in progress, kept between runs. */
  saveDraft(json: string): Promise<void>;
  loadDraft(): Promise<string | null>;
  appInfo(): Promise<{ version: string; electron: string; data: string }>;
  checkUpdate(): Promise<{ current: string; latest: string | null; url: string | null; newer: boolean; note?: string }>;
  openUrl(url: string): Promise<void>;
  ports(): Promise<PortInfo[]>;
  connect(path: string, kind?: MachineKind | 'auto'): Promise<DeviceInfo>;
  disconnect(): Promise<void>;
  run(jobs: JobSpec[]): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  preview(spec: PreviewSpec): Promise<void>;
  stopPreview(): Promise<void>;
  applySettings(settings: DeviceSettings): Promise<void>;
  loadSettings(): Promise<DeviceSettings>;
  onEvent(listener: (event: LaserEvent) => void): () => void;
}

declare global {
  interface Window {
    laser: LaserApi;
  }
}
