export type StoryEasing = 'linear' | 'ease-in-out' | 'ease-out';

export interface StoryScene {
  id: string;
  title: string;
  /** Total scene time, including its entrance transition, in seconds. */
  duration: number;
  transition: number;
  easing: StoryEasing;
  /** Null shows the complete diagram; an empty array starts with an empty stage. */
  visible: string[] | null;
  reveal: 'together' | 'sequence';
  highlight: string[];
  flow: string[];
  camera: { mode: 'fit' | 'elements'; keys: string[]; padding: number };
}

export interface StoryboardState {
  version: 1;
  scenes: StoryScene[];
  loop: boolean;
}

export interface StoryPlaybackState {
  time: number;
  duration: number;
  sceneIndex: number;
  playing: boolean;
  /** A settled scene composition, distinct from an exact timeline position. */
  preview: boolean;
}

export type StoryPlaybackAction = 'play' | 'pause' | 'restart' | 'previous' | 'next' | 'seek' | 'preview' | 'stop';

export interface StoryboardController {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  preview: (sceneIndex: number) => void;
  previous: () => void;
  next: () => void;
  restart: () => void;
  destroy: () => void;
  setReducedMotion: (reduced: boolean) => void;
  getState: () => StoryPlaybackState;
}

export interface StoryboardPlayerOptions {
  onUpdate?: (state: StoryPlaybackState) => void;
  reducedMotion?: boolean;
  initialTime?: number;
  initialPreview?: number;
  accent?: string;
}
