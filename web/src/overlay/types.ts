export type CommandStyle = {
  fontFamily: string;
  fontSize: number;
  textColor: string;
  accentColor: string;
  x: number;
  y: number;
  scale: number;
  effect: 'pop' | 'slide-up' | 'slide-left' | 'fade' | 'bounce' | 'zoom' | 'spin';
  particles: 'none' | 'hearts' | 'stars' | 'confetti' | 'sparkles';
  textShadow: boolean;
};

export type OverlayEvent = {
  type: 'command';
  eventId: string;
  createdAt: number;
  command: string;
  animation: string;
  imageUrl: string | null;
  soundUrl: string | null;
  soundVolume: number;
  text: string;
  viewer: string | null;
  target: string | null;
  durationMs: number;
  style: CommandStyle;
};
