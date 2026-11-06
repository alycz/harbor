import { Button } from '@harbor/ui/components/button';
import { Link } from '@tanstack/react-router';
import { MessageCircle, SquarePen } from 'lucide-react';

import { useWorkspaceSession } from './workspace-session.tsx';

/** Starts over: clears the composer and the thread. */
export function useNewConversation() {
  const { setDraft, chat } = useWorkspaceSession();
  return () => {
    setDraft('');
    chat.reset();
  };
}

/**
 * The chat's history, attached to the navigation it lives under: a new-conversation row, then the
 * conversations in this session. Only the current one exists until conversations are saved.
 */
export function ConversationList({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const newConversation = useNewConversation();
  return (
    <section aria-label="Conversations" className="flex flex-col">
      <p className="ws-label mb-1.5 px-2.5">Conversations</p>
      <Button
        variant="ghost"
        onClick={() => {
          newConversation();
          onNavigate?.();
        }}
        className="h-9 justify-start gap-3 px-2.5 text-[14px] font-medium text-muted-foreground hover:bg-secondary/55 hover:text-foreground pointer-coarse:h-11"
      >
        <SquarePen className="size-4" strokeWidth={1.75} /> New conversation
      </Button>
      <Link
        to="/chat"
        onClick={onNavigate}
        className="mt-0.5 flex items-center gap-3 rounded-md px-2.5 py-2 text-[13.5px] transition-colors hover:bg-secondary/55"
      >
        <MessageCircle className="size-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate font-medium">Current conversation</span>
          <span className="block text-[12px] text-muted-foreground">This session</span>
        </span>
      </Link>
    </section>
  );
}
