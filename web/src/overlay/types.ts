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
  /** anime = chibi characters (default), people = human-proportioned figures */
  characterStyle?: 'anime' | 'people';
  /** hug / highfive / dance: characters walk towards each other first */
  walkIn?: boolean;
  /** Video: show for exactly the video's own length */
  useVideoLength?: boolean;
  imageUrl: string | null;
  soundUrl: string | null;
  soundVolume: number;
  text: string;
  viewer: string | null;
  target: string | null;
  durationMs: number;
  style: CommandStyle;
};
