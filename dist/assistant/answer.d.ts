import type { ChatMessage } from "./intent.js";
import type { BuiltContext } from "./context.js";
export type TokenCallback = (token: string) => void;
export type DoneCallback = (fullText: string) => void;
export interface StreamOptions {
    onToken: TokenCallback;
    onDone: DoneCallback;
    onError?: (err: Error) => void;
}
export declare function streamAnswer(systemPrompt: string, context: BuiltContext, history: ChatMessage[], userMessage: string, opts: StreamOptions): Promise<void>;
//# sourceMappingURL=answer.d.ts.map