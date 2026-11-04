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
    animation: text('animation').notNull(),
    imageUrl: text('image_url'),
    soundUrl: text('sound_url'),
    soundVolume: integer('sound_volume').notNull().default(70),
    text: text('text').notNull(),
    durationMs: integer('duration_ms').notNull().default(5000),
    userCooldownSec: integer('user_cooldown_sec').notNull().default(30),
    globalCooldownSec: integer('global_cooldown_sec').notNull().default(5),
    /** everyone | subscriber | vip | moderator | broadcaster */
    permission: text('permission').notNull().default('everyone'),
    showUsername: integer('show_username', { mode: 'boolean' }).notNull().default(true),
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

export type User = typeof users.$inferSelect;
export type Command = typeof commands.$inferSelect;
