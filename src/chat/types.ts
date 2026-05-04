export type ChatMessage = {
  id: string;
  roomId: string;
  senderId?: string;
  sender: string;
  content: string;
  createdAt: string;
  mine?: boolean;
  pending?: boolean;
  /** When the message was last edited (ISO), if known */
  editedAt?: string;
  /** When the message was read by recipient(s) (ISO), if known */
  readAt?: string;
  /** Server flag: message has been read */
  seen?: boolean;
  /** Usernames (or ids as string) who read the message, if provided */
  readBy?: string[];
  /** Attached media URL if this is a media message */
  mediaUrl?: string;
  mediaType?: "image" | "file";
  mediaName?: string;
  /** Emoji -> count map */
  reactions?: Record<string, number>;
  /** Current user's own reaction, if any */
  myReaction?: string;
};

export type ChatMember = {
  id?: string;
  username?: string;
  name?: string;
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

export type UserSummary = {
  id: string;
  username: string;
  online?: boolean;
};
