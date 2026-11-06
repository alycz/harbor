import { Button } from '@harbor/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@harbor/ui/components/sheet';
import { useNavigate } from '@tanstack/react-router';
import { PanelLeftOpen, SquarePen } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ConversationDraft } from '../components/conversation-draft.tsx';
import { ConversationList, useNewConversation } from '../components/conversation-list.tsx';
import { useWorkspaceSession } from '../components/workspace-session.tsx';

/**
 * The chat. Its history lives in the sidebar under the navigation; below the desktop breakpoint,
 * where there is no sidebar, a sheet holds it instead.
 *
 * `ask` is a question carried from the landing page; it fills the composer once and is not sent.
 */
export function ChatPage({ ask }: { ask?: string | undefined }) {
  const { setDraft } = useWorkspaceSession();
  const newConversation = useNewConversation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!ask) return;
    setDraft(ask);
    void navigate({ to: '/chat', search: {}, replace: true });
  }, [ask, setDraft, navigate]);

  return (
    <section className="chat-column flex h-full min-h-0 min-w-0 flex-col gap-4">
      {/* The top bar already names the page. */}
      <h1 className="sr-only">Ask Harbor</h1>
      <div className="-mt-2 -mb-1 flex shrink-0 items-center justify-end gap-1 lg:hidden">
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-10 text-muted-foreground"
                aria-label="Open conversations"
              />
            }
          >
            <PanelLeftOpen />
          </SheetTrigger>
          <SheetContent side="left" className="w-[min(88vw,320px)] gap-0 bg-white p-0">
            <SheetHeader className="border-b border-border px-5 py-4">
              <SheetTitle className="text-[15px] font-medium">Conversations</SheetTitle>
              <SheetDescription className="sr-only">Start a new conversation or return to this one.</SheetDescription>
            </SheetHeader>
            <div className="px-3 py-4">
              <ConversationList onNavigate={() => setHistoryOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 text-muted-foreground"
          aria-label="New conversation"
          onClick={newConversation}
        >
          <SquarePen />
        </Button>
      </div>
      <ConversationDraft />
    </section>
  );
}
