import type { ProposalKind, PublicAgentEvent } from '@harbor/agent-runtime/events';
import { useCallback, useEffect, useRef, useState } from 'react';

interface PreparationStep {
  id: string;
  label: string;
  state: 'running' | 'complete' | 'failed';
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  preparation?: PreparationStep[];
  error?: string;
  /** The user stopped this answer; what arrived before the stop stays. */
  stopped?: boolean;
  /** Intents Harbor created for this answer; each renders as a proposal card. */
  proposals?: { intentId: string; kind: ProposalKind }[];
}

export interface AgentChat {
  messages: ConversationMessage[];
  running: boolean;
  /** The open conversation, once its first message is sent. */
  conversationId: string | null;
  /** Earlier conversations kept in this browser only, newest first. */
  saved: SavedConversation[];
  send(text: string): Promise<void>;
  /** Stops the answer being generated. It never cancels anything already done. */
  stop(): void;
  /** Forgets the current conversation; the next message starts a new one. */
  reset(): void;
  /** Reopens a saved conversation; its text goes back to Harbor only as context, never as evidence. */
  open(id: string): void;
}

interface SavedConversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: { id: string; role: 'user' | 'assistant'; text: string }[];
}

const STORAGE_KEY = 'harbor.conversations.v1';
const MAX_SAVED = 8;
const MAX_HISTORY = 12;
const MAX_HISTORY_TEXT = 12_000;
const MAX_HISTORY_TOTAL = 48_000;

function loadSaved(): SavedConversation[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as SavedConversation[]).slice(0, MAX_SAVED) : [];
  } catch {
    return [];
  }
}

function storeSaved(saved: SavedConversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.slice(0, MAX_SAVED)));
  } catch {
    // Private windows and full storage keep chats for this page only.
  }
}

/** The last exchanges of a reopened chat, bounded as the API requires. */
function historyOf(messages: SavedConversation['messages']) {
  const history: { role: 'user' | 'assistant'; text: string }[] = [];
  let total = 0;
  for (const message of [...messages].reverse()) {
    const text = message.text.slice(0, MAX_HISTORY_TEXT);
    if (!text || history.length >= MAX_HISTORY || total + text.length > MAX_HISTORY_TOTAL) break;
    history.unshift({ role: message.role, text });
    total += text.length;
  }
  return history;
}

interface Admitted {
  status: 'started' | 'duplicate';
  runId: string;
  afterEventId: number;
}

const TOOL_LABELS: Record<string, string> = {
  list_markets: 'Read the dated research snapshot',
  read_feed: 'Read recent posts as untrusted data',
  propose_intent: 'Prepared a proposal for your review',
};

export class ChatRequestError extends Error {
  override name = 'ChatRequestError';
}

/** One conversation with the Harbor agent: send a message, then follow its events until the turn ends. */
export function useAgentChat(): AgentChat {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<SavedConversation[]>(loadSaved);
  const [openId, setOpenId] = useState<string | null>(null);
  const conversationId = useRef<string | null>(null);
  const runId = useRef<string | null>(null);
  const source = useRef<EventSource | null>(null);
  /** Text of a reopened chat, sent once as context with its next message. */
  const pendingHistory = useRef<SavedConversation['messages'] | null>(null);

  useEffect(() => () => source.current?.close(), []);

  // Keeps each finished exchange in this browser, so the conversation can be reopened later.
  useEffect(() => {
    const id = conversationId.current;
    if (running || !id || messages.length === 0) return;
    const firstQuestion = messages.find((message) => message.role === 'user')?.text ?? 'Conversation';
    const entry: SavedConversation = {
      id,
      title: firstQuestion.slice(0, 80),
      updatedAt: new Date().toISOString(),
      messages: messages
        .filter((message) => message.text)
        .map((message) => ({ id: message.id, role: message.role, text: message.text.slice(0, MAX_HISTORY_TEXT) })),
    };
    setSaved((current) => {
      const next = [entry, ...current.filter((conversation) => conversation.id !== id)].slice(0, MAX_SAVED);
      storeSaved(next);
      return next;
    });
  }, [messages, running]);

  const send = useCallback(async (text: string) => {
    const messageId = crypto.randomUUID();
    const replyId = crypto.randomUUID();
    setRunning(true);
    try {
      conversationId.current ??= await createConversation();
      setOpenId(conversationId.current);
      const history = pendingHistory.current ? historyOf(pendingHistory.current) : undefined;
      const admitted = await postMessage(conversationId.current, messageId, text, history);
      pendingHistory.current = null;
      setMessages((current) => [
        ...current,
        { id: messageId, role: 'user', text },
        { id: replyId, role: 'assistant', text: '' },
      ]);
      runId.current = admitted.runId;
      source.current = follow(conversationId.current, admitted.runId, admitted.afterEventId, (event) => {
        setMessages((current) => current.map((message) => (message.id === replyId ? apply(message, event) : message)));
        if (isTerminal(event)) {
          runId.current = null;
          setRunning(false);
        }
      });
    } catch (error) {
      setRunning(false);
      throw error;
    }
  }, []);

  const stop = useCallback(() => {
    const conversation = conversationId.current;
    const run = runId.current;
    // The stream reports the stop; a failed request leaves the answer running, which the stream also shows.
    if (conversation && run) {
      fetch(`/api/agent/conversations/${conversation}/runs/${run}/abort`, { method: 'POST' }).catch(() => {});
    }
  }, []);

  const reset = useCallback(() => {
    source.current?.close();
    source.current = null;
    conversationId.current = null;
    runId.current = null;
    pendingHistory.current = null;
    setOpenId(null);
    setMessages([]);
    setRunning(false);
  }, []);

  const open = useCallback(
    (id: string) => {
      const conversation = saved.find((entry) => entry.id === id);
      if (!conversation) return;
      source.current?.close();
      source.current = null;
      runId.current = null;
      conversationId.current = conversation.id;
      pendingHistory.current = conversation.messages;
      setOpenId(conversation.id);
      setRunning(false);
      setMessages(conversation.messages.map((message) => ({ ...message })));
    },
    [saved],
  );

  return { messages, running, conversationId: openId, saved, send, stop, reset, open };
}

async function createConversation(): Promise<string> {
  const response = await fetch('/api/agent/conversations', { method: 'POST' });
  if (!response.ok) throw new ChatRequestError('Could not start a conversation.');
  const body: { conversationId: string } = await response.json();
  return body.conversationId;
}

async function postMessage(
  conversationId: string,
  messageId: string,
  text: string,
  history?: { role: 'user' | 'assistant'; text: string }[],
): Promise<Admitted> {
  const response = await fetch(`/api/agent/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messageId, text, ...(history && history.length > 0 ? { history } : {}) }),
  });
  if (response.ok) return response.json();
  const body: { error?: { message?: string; retryAfterSeconds?: number } } = await response.json().catch(() => ({}));
  const message = body.error?.message ?? 'The message was not sent.';
  const wait = body.error?.retryAfterSeconds;
  throw new ChatRequestError(wait ? `${message} Try again in ${formatWait(wait)}.` : message);
}

function formatWait(seconds: number): string {
  return seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}

function follow(
  conversationId: string,
  runId: string,
  after: number,
  onEvent: (event: PublicAgentEvent) => void,
): EventSource {
  const events = new EventSource(`/api/agent/conversations/${conversationId}/runs/${runId}/events?after=${after}`);
  events.onmessage = (message: MessageEvent<string>) => {
    const event: PublicAgentEvent = JSON.parse(message.data);
    onEvent(event);
    // The server closes the stream after a terminal event; closing here stops EventSource reconnecting.
    if (isTerminal(event)) events.close();
  };
  // EventSource retries dropped connections itself; CLOSED means it has given up.
  events.onerror = () => {
    if (events.readyState === EventSource.CLOSED) {
      onEvent({ type: 'error', code: 'failed', message: 'Lost the connection to Harbor.' });
    }
  };
  return events;
}

function isTerminal(event: PublicAgentEvent): boolean {
  return event.type === 'settled' || event.type === 'interrupted' || event.type === 'error';
}

function apply(message: ConversationMessage, event: PublicAgentEvent): ConversationMessage {
  switch (event.type) {
    case 'text_delta':
      return { ...message, text: message.text + event.delta };
    case 'tool_started':
      return {
        ...message,
        preparation: [
          ...(message.preparation ?? []),
          { id: event.toolCallId, label: TOOL_LABELS[event.name] ?? event.name, state: 'running' },
        ],
      };
    case 'tool_completed':
      if (!message.preparation) return message;
      return {
        ...message,
        preparation: message.preparation.map((step) =>
          step.id === event.toolCallId ? { ...step, state: event.isError ? 'failed' : 'complete' } : step,
        ),
      };
    case 'error':
      return { ...message, error: event.message };
    case 'interrupted':
      return event.reason === 'stopped'
        ? { ...message, stopped: true }
        : { ...message, error: 'The answer was interrupted. Send the message again.' };
    case 'proposal':
      return {
        ...message,
        proposals: [...(message.proposals ?? []), { intentId: event.intentId, kind: event.kind }],
      };
    case 'settled':
      return message;
  }
}
