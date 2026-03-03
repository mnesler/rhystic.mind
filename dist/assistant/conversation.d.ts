import type { ChatMessage } from "./intent.js";
import type { LoadedDeck } from "../deck/types.js";
export interface Session {
    id: string;
    history: ChatMessage[];
    createdAt: Date;
    lastActiveAt: Date;
    /** The deck loaded into this session, if any. */
    loadedDeck?: LoadedDeck;
}
/** Create a new session and return its ID.
 *  If an id is supplied, that exact id is used (allows the client to pre-assign
 *  a UUID so deck-load and chat calls share the same session).
 */
export declare function createSession(id?: string): Session;
/** Get an existing session by ID, or create a new one if not found.
 *  When a sessionId is provided and not found (e.g. fresh server, session
 *  expired) we create a new session using that SAME id so subsequent requests
 *  from the client will continue to find it.
 */
export declare function getOrCreateSession(sessionId?: string): Session;
/** Get a session by ID. Returns undefined if not found. */
export declare function getSession(sessionId: string): Session | undefined;
/** Append a user message to the session history. */
export declare function addUserMessage(session: Session, content: string): void;
/** Append an assistant message to the session history. */
export declare function addAssistantMessage(session: Session, content: string): void;
/** Delete a session. */
export declare function deleteSession(sessionId: string): boolean;
/** Attach or replace the loaded deck for a session. */
export declare function setSessionDeck(session: Session, deck: LoadedDeck): void;
/** Return a serialisable snapshot of a session (no methods). */
export declare function sessionSnapshot(session: Session): {
    id: string;
    messageCount: number;
    createdAt: string;
    lastActiveAt: string;
    hasDeck: boolean;
    deckCommanders: string[];
    deckCardCount: number;
};
//# sourceMappingURL=conversation.d.ts.map