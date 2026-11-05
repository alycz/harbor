import { Button } from '@harbor/ui/components/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@harbor/ui/components/sheet';
import { Link, useNavigate } from '@tanstack/react-router';
import { MessageCircle, PanelLeftClose, PanelLeftOpen, SquarePen } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ConversationDraft } from '../components/conversation-draft.tsx';
import { useWorkspaceSession } from '../components/workspace-session.tsx';

/** `ask` is a question carried from the landing page; it fills the composer once and is not sent. */
export function ChatPage({ ask }: { ask?: string | undefined }) {
  const { setDraft, chat } = useWorkspaceSession();
  const [expanded, setExpanded] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!ask) return;
    setDraft(ask);
    void navigate({ to: '/chat', search: {}, replace: true });
  }, [ask, setDraft, navigate]);

  function newConversation() {
    setDraft('');
    chat.reset();
  }

  return (
    <div
      className={`grid h-full min-h-0 min-w-0 gap-6 transition-[grid-template-columns] duration-300 ease-[cubic-bezier(0.45,0,0.1,1)] motion-reduce:transition-none ${expanded ? '@3xl/workspace:grid-cols-[248px_minmax(0,1fr)]' : '@3xl/workspace:grid-cols-[58px_minmax(0,1fr)]'}`}
    >
      <aside
        className="ws-card hidden min-h-0 min-w-0 flex-col overflow-hidden p-2 @3xl/workspace:flex"
        aria-label="Conversation history"
      >
        <div className="flex flex-col gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground"
            aria-label={expanded ? 'Collapse conversation history' : 'Expand conversation history'}
            aria-expanded={expanded}
            aria-controls="conversation-history"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
          <Button
            variant="ghost"
            className={`h-9 gap-2.5 text-muted-foreground hover:text-foreground ${expanded ? 'w-full justify-start px-2.5' : 'size-9 px-0'}`}
            aria-label="New conversation"
            title={expanded ? undefined : 'New conversation'}
            onClick={newConversation}
          >
            <SquarePen />
            {expanded ? 'New conversation' : null}
          </Button>
        </div>
        <div id="conversation-history" className="mt-4 flex min-h-0 flex-1 flex-col">
          <HistoryContents expanded={expanded} />
        </div>
      </aside>

      <section className="chat-column flex min-h-0 min-w-0 flex-col gap-4">
        <div className="-mt-2 -mb-1 flex shrink-0 items-center justify-end gap-3 @3xl/workspace:contents">
          {/* The top bar already names the page. */}
          <h1 className="sr-only">Ask Harbor</h1>
          <div className="flex items-center gap-1 @3xl/workspace:hidden">
            <Sheet>
              <SheetTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10 text-muted-foreground"
                    aria-label="Open conversation history"
                  />
                }
              >
                <PanelLeftOpen />
              </SheetTrigger>
              <SheetContent side="left" className="w-[min(88vw,320px)] gap-0 p-0">
                <SheetHeader className="border-b border-border px-5 py-4">
                  <SheetTitle className="text-[15px] font-medium">Conversations</SheetTitle>
                  <SheetDescription className="text-[13px]">Your current session and workspace.</SheetDescription>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col px-3 py-4">
                  <SheetClose
                    render={<Button variant="outline" className="mb-4 h-10 justify-start gap-2.5 px-3" />}
                    onClick={newConversation}
                  >
                    <SquarePen />
                    New conversation
                  </SheetClose>
                  <HistoryContents expanded />
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
        </div>
        <ConversationDraft />
      </section>
    </div>
  );
}

function HistoryContents({ expanded }: { expanded: boolean }) {
  return (
    <>
      {expanded ? <p className="ws-label mb-1.5 px-2.5">Today</p> : null}
      <Link
        to="/chat"
        aria-label="Current conversation"
        title={expanded ? undefined : 'Current conversation'}
        className={`flex min-h-9 items-center gap-2.5 rounded-md bg-secondary text-[13.5px] font-medium ${expanded ? 'px-2.5 py-2' : 'size-9 justify-center'}`}
      >
        <MessageCircle className="size-4 shrink-0 text-primary" aria-hidden="true" />
        {expanded ? (
          <span className="min-w-0">
            <span className="block truncate">Current conversation</span>
            <span className="block text-[12px] font-normal text-muted-foreground">This session</span>
          </span>
        ) : null}
      </Link>
    </>
  );
}
