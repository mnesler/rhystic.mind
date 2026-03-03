// Multi-turn conversation session management.
//
// Sessions are held in memory — they don't survive server restarts.
// Each session stores the full message history so the LLM has context
// for follow-up questions ("now make it budget", "what about adding X?").
//
// Sessions expire after IDLE_TIMEOUT_MS of inactivity to avoid unbounded growth.

import { randomUUID } from "crypto";
import type { ChatMessage } from "./intent.js";
import type { LoadedDeck } from "../deck/types.js";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  history: ChatMessage[];
  createdAt: Date;
  lastActiveAt: Date;
  /** The deck loaded into this session, if any. */
  loadedDeck?: LoadedDeck;
}

// ── Store ─────────────────────────────────────────────────────────────────────

const sessions = new Map<string, Session>();

// ── Cleanup timer ─────────────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActiveAt.getTime() > IDLE_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000); // Run cleanup every 5 minutes

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a new session and return its ID.
 *  If an id is supplied, that exact id is used (allows the client to pre-assign
 *  a UUID so deck-load and chat calls share the same session).
 */
export function createSession(id?: string): Session {
  const sessionId = id ?? randomUUID();
  const session: Session = {
    id: sessionId,
    history: [],
    createdAt: new Date(),
    lastActiveAt: new Date(),
  };
  sessions.set(sessionId, session);
  return session;
}

/** Get an existing session by ID, or create a new one if not found.
 *  When a sessionId is provided and not found (e.g. fresh server, session
 *  expired) we create a new session using that SAME id so subsequent requests
 *  from the client will continue to find it.
 */
export function getOrCreateSession(sessionId?: string): Session {
  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (existing) {
      existing.lastActiveAt = new Date();
      return existing;
    }
    // Session not found — create one pinned to the client's id
    return createSession(sessionId);
  }
  return createSession();
}

/** Get a session by ID. Returns undefined if not found. */
export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

/** Append a user message to the session history. */
export function addUserMessage(session: Session, content: string): void {
  session.history.push({ role: "user", content });
  session.lastActiveAt = new Date();
}

/** Append an assistant message to the session history. */
export function addAssistantMessage(session: Session, content: string): void {
  session.history.push({ role: "assistant", content });
  session.lastActiveAt = new Date();
}

/** Delete a session. */
export function deleteSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

/** Attach or replace the loaded deck for a session. */
export function setSessionDeck(session: Session, deck: LoadedDeck): void {
  session.loadedDeck = deck;
  session.lastActiveAt = new Date();
}

/** Return a serialisable snapshot of a session (no methods). */
export function sessionSnapshot(session: Session): {
  id: string;
  messageCount: number;
  createdAt: string;
  lastActiveAt: string;
  hasDeck: boolean;
  deckCommanders: string[];
  deckCardCount: number;
} {
  return {
    id: session.id,
    messageCount: session.history.length,
    createdAt: session.createdAt.toISOString(),
    lastActiveAt: session.lastActiveAt.toISOString(),
    hasDeck: session.loadedDeck !== undefined,
    deckCommanders: session.loadedDeck?.commanders ?? [],
    deckCardCount: session.loadedDeck?.cardCount ?? 0,
  };
}
