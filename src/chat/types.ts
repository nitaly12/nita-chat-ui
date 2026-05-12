export type ChatMessage = {
  id: string;
  roomId: string;
  senderId?: string;
  sender: string;
  content: string;
  /** Plain-text preview from API (e.g. for replies or list cells). */
  contentSnippet?: string;
  createdAt: string;
  /** Parent message id when this message is a reply. */
  parentMessageId?: string;
  /** Optional quoted parent content for reply rendering. */
  parentMessage?: {
    id: string;
    sender?: string;
    content?: string;
    /** Short preview for quoted reply strip (preferred over `content`). */
    contentSnippet?: string;
    mediaUrl?: string;
    mediaType?: "image" | "voice" | "file";
  };
  /** Message kind when API distinguishes (e.g. text vs voice). */
  type?: string;
  mine?: boolean;
  pending?: boolean;
  /** When the message was last edited (ISO), if known */
  editedAt?: string;
  /** When the message was read by recipient(s) (ISO), if known */
  readAt?: string;
  /** Server flag: message has been read */
  seen?: boolean;
  /** User ids (or usernames) who have seen the message */
  seenBy?: string[];
  /** Usernames (or ids as string) who read the message, if provided */
  readBy?: string[];
  /** Attached media URL if this is a media message */
  mediaUrl?: string;
  /** Voice / audio URL when API sends `audioUrl` (alias of media for voice). */
  audioUrl?: string;
  mediaType?: "image" | "file" | "voice";
  mediaName?: string;
  /** Voice note length in seconds (from client or server metadata). */
  voiceDurationSec?: number;
  /** Optimistic voice only: upload → REST send progress. */
  voiceDeliveryPhase?: "uploading" | "sending";
  /** Emoji -> count map */
  reactions?: Record<string, number>;
  /** Server aggregate when sent (e.g. WebSocket `reactionSummary`); use for authoritative replace. */
  reactionSummary?: Record<string, number>;
  /** Emoji -> user ids/usernames that reacted (when available). */
  reactionUsers?: Record<string, string[]>;
  /** Current user's own reaction, if any */
  myReaction?: string;
};

export type ChatMember = {
  id?: string;
  username?: string;
  name?: string;
  /** Profile / room image URL when the API sends it (relative or absolute). */
  avatarUrl?: string;
  online?: boolean;
  isOnline?: boolean;
  onlineStatus?: string;
  status?: string;
};

export type Chat = {
  id: string;
  isGroup: boolean;
  groupName?: string;
  directName?: string;
  /** Room or group avatar when provided by the API. */
  avatarUrl?: string;
  lastMessagePreview?: string;
  /** Server-reported unread count, if provided */
  unreadCount?: number;
  /** ISO timestamp of last message, if provided */
  lastMessageAt?: string;
  members?: ChatMember[];
};

export type AuthResult = {
  token: string;
  currentUserId: string | null;
  currentUsername: string | null;
};

/** Normalized comment on a post (list + create response). */
export type PostComment = {
  id: string;
  content: string;
  createdAt?: string;
  displayName: string;
  avatarUrl?: string | null;
  /** Parent comment id for threaded replies. */
  parentCommentId?: string | null;
  /** Author id used for ownership actions (edit/delete visibility). */
  authorId?: string | null;
};

/** Normalized post from `GET /api/posts/user/{userId}` (extend as your DTO grows). */
export type UserPost = {
  id: string;
  title?: string;
  content: string;
  createdAt?: string;
  mediaUrl?: string;
  reactionCount?: number;
  /** Per-emoji counts from the API (e.g. `{ "❤️": 1 }`). */
  reactionSummary?: Record<string, number>;
  commentCount?: number;
  /** Current user’s reaction emoji, if any */
  myReaction?: string | null;
  /** Embedded comment thread when API returns it on post list/detail */
  comments?: PostComment[];
};

/** UI state for friend / follow-request flows (`FriendButton`). */
export type FriendshipUiStatus = null | "PENDING" | "RECEIVED" | "ACCEPTED";

export type FriendshipSnapshot = {
  status: FriendshipUiStatus;
  /** Friend-request row id when status is PENDING or RECEIVED. */
  requestId?: string;
};

export type IncomingFriendRequest = {
  id: string;
  requesterId: string;
  requesterUsername: string;
  requesterDisplayName?: string | null;
  requesterAvatarUrl?: string | null;
  createdAt?: string;
};

export type UserSummary = {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  online?: boolean;
  bio?: string | null;
  lastSeenAt?: string | null;
};

/** Normalized `GET /api/users/me` shape for profile settings (extend fields as your API grows). */
export type MyUserProfile = {
  id: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  coverPhotoUrl: string | null;
  bio: string | null;
  theme: "light" | "dark";
};
