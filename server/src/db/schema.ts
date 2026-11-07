import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Kept to portable column types so the schema maps 1:1 onto drizzle's pg-core later.

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    twitchId: text('twitch_id').notNull(),
    login: text('login').notNull(),
    displayName: text('display_name').notNull(),
    profileImageUrl: text('profile_image_url'),
    /** AES-256-GCM encrypted */
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    tokenExpiresAt: integer('token_expires_at').notNull(),
    scopes: text('scopes').notNull().default(''),
    /** Secret part of the OBS browser source URL */
    overlayToken: text('overlay_token').notNull(),
    overlayWidth: integer('overlay_width').notNull().default(1920),
    overlayHeight: integer('overlay_height').notNull().default(1080),
    chatEnabled: integer('chat_enabled', { mode: 'boolean' }).notNull().default(true),
    /** UI language and language of default content: en | nl */
    locale: text('locale').notNull().default('en'),
    /** Set when Twitch rejects the token and it could not be refreshed */
    authError: text('auth_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('users_twitch_id_idx').on(t.twitchId), uniqueIndex('users_overlay_token_idx').on(t.overlayToken)],
);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});

export type CommandStyle = {
  fontFamily: string;
  fontSize: number;
  textColor: string;
  accentColor: string;
  /** Position of the element centre, in % of the overlay */
  x: number;
  y: number;
  /** Scale factor of the visual (1 = default size) */
  scale: number;
  /** Entrance effect */
  effect: 'pop' | 'slide-up' | 'slide-left' | 'fade' | 'bounce' | 'zoom' | 'spin';
  /** Extra particles */
  particles: 'none' | 'hearts' | 'stars' | 'confetti' | 'sparkles';
  textShadow: boolean;
};

export const commands = sqliteTable(
  'commands',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** lowercased, without the leading "!" */
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** Built-in animation id ('hug', 'highfive', ...) or 'image' for a custom image/GIF */
    /** chat = triggered by a chat command; otherwise an alert: follow | subscriber | resub | gift | cheer | raid */
    trigger: text('trigger').notNull().default('chat'),
    /** Own description, e.g. the StreamElements overlay/alert it was imported from */
    label: text('label'),
    /** Chat message the bot sends back (optional). Supports {user} {target} {channel} {count} {random:1-100} {args} */
    reply: text('reply'),
    /** Extra command names, e.g. ["socials","links"] */
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** Alerts: minimum amount (bits, raiders, gifted subs, months) for this variation */
    minAmount: integer('min_amount').notNull().default(0),
    useCount: integer('use_count').notNull().default(0),
    animation: text('animation').notNull(),
    /** anime = chibi characters, people = human-proportioned figures */
    characterStyle: text('character_style').notNull().default('anime'),
    /** hug / highfive / dance: characters walk towards each other first */
    walkIn: integer('walk_in', { mode: 'boolean' }).notNull().default(false),
    imageUrl: text('image_url'),
    /** When imageUrl is a video: show it for exactly its own length instead of durationMs */
    useVideoLength: integer('use_video_length', { mode: 'boolean' }).notNull().default(false),
    soundUrl: text('sound_url'),
    soundVolume: integer('sound_volume').notNull().default(70),
    text: text('text').notNull(),
    durationMs: integer('duration_ms').notNull().default(5000),
    userCooldownSec: integer('user_cooldown_sec').notNull().default(30),
    globalCooldownSec: integer('global_cooldown_sec').notNull().default(5),
    /** everyone | subscriber | vip | moderator | broadcaster */
    permission: text('permission').notNull().default('everyone'),
    showUsername: integer('show_username', { mode: 'boolean' }).notNull().default(true),
    /** false: only the animation / GIF is shown, no text banner */
    showText: integer('show_text', { mode: 'boolean' }).notNull().default(true),
    /** optional: `!knuffel @naam` fills {target}, otherwise targetFallback | required: ignored without a name | none: names are ignored */
    targetMode: text('target_mode').notNull().default('optional'),
    // Database default kept from the first version; the app always sets this explicitly.
    targetFallback: text('target_fallback').notNull().default('de streamer'),
    style: text('style', { mode: 'json' }).$type<CommandStyle>().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('commands_user_name_idx').on(t.userId, t.name)],
);

export const activity = sqliteTable(
  'activity',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    commandName: text('command_name').notNull(),
    viewer: text('viewer').notNull(),
    /** triggered | cooldown | denied | test */
    status: text('status').notNull(),
    detail: text('detail'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('activity_user_created_idx').on(t.userId, t.createdAt)],
);

export const uploads = sqliteTable('uploads', {
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  originalName: text('original_name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at').notNull(),
});

/** Repeating chat messages ("timers"). */
export const timers = sqliteTable(
  'timers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** Sent in rotation, one per interval */
    messages: text('messages', { mode: 'json' }).$type<string[]>().notNull(),
    /** Minutes between messages while live */
    intervalMin: integer('interval_min').notNull().default(15),
    /** Minutes between messages while offline; 0 = don't send while offline */
    offlineIntervalMin: integer('offline_interval_min').notNull().default(0),
    /** Minimum chat messages since the previous timer message */
    minChatLines: integer('min_chat_lines').notNull().default(5),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('timers_user_idx').on(t.userId)],
);

export type BotProfile = { nick: string | null; avatar: string | null; bio: string | null };

export type WelcomeCard = {
  /** /uploads/... or https URL; null = gradient in accentColor */
  background: string | null;
  title: string;
  subtitle: string;
  accentColor: string;
  textColor: string;
  /** 0-90: darkens the background so text stays readable */
  dim: number;
};

/** A Discord server connected by a streamer (via the shared Waviloop bot) with its welcome settings. */
export const discordGuilds = sqliteTable(
  'discord_guilds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    guildId: text('guild_id').notNull(),
    guildName: text('guild_name').notNull(),
    guildIcon: text('guild_icon'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    channelId: text('channel_id'),
    /** Text above the image. {user} = mention, {name} = display name, {server}, {count} */
    // Database default kept from the first version; the app always sets this explicitly.
    message: text('message').notNull().default('Welkom {user} in {server}! 🎉'),
    card: text('card', { mode: 'json' }).$type<WelcomeCard>().notNull(),
    /** How the shared bot presents itself on this server (per-server nickname, avatar, bio) */
    /** Set when the bot was removed from the server in Discord itself (kick/leave); cleared when it is back */
    removedAt: integer('removed_at'),
    botProfile: text('bot_profile', { mode: 'json' }).$type<BotProfile>().notNull().default({ nick: null, avatar: null, bio: null }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('discord_guilds_guild_idx').on(t.guildId)],
);

/** Instance-wide settings (e.g. Twitch app credentials entered in the setup wizard). Secrets are stored encrypted. */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type User = typeof users.$inferSelect;
export type Command = typeof commands.$inferSelect;
export type Timer = typeof timers.$inferSelect;
