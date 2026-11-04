import { Button } from '@harbor/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@harbor/ui/components/sheet';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, X } from 'lucide-react';

import { ConversationDraft } from './conversation-draft.tsx';
import { HarborMark } from './harbor-logo.tsx';
import { useWorkspaceSession } from './workspace-session.tsx';

export function AgentPanel({ desktop }: { desktop: boolean }) {
  const { assistantOpen, setAssistantOpen } = useWorkspaceSession();
  if (desktop)
    return (
      <Button
        id="ask-harbor-trigger"
        variant="ghost"
        className="h-12 gap-3 border border-band bg-band px-4 text-band-foreground hover:-translate-x-[3px] hover:-translate-y-[3px] hover:bg-band hover:text-band-foreground hover:shadow-[4px_4px_0_var(--harbor-accent)] motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0"
        aria-label={assistantOpen ? 'Close Ask Harbor' : 'Open Ask Harbor'}
        aria-expanded={assistantOpen}
        aria-controls="context-assistant"
        onClick={() => setAssistantOpen(!assistantOpen)}
      >
        <HarborMark className="size-6 text-band-foreground" beacon="var(--harbor-sky)" /> Ask Harbor{' '}
        <ArrowUpRight className="text-sky" />
      </Button>
    );
  return (
    <Sheet open={assistantOpen} onOpenChange={setAssistantOpen}>
      <SheetTrigger
        render={
          <Button
            id="ask-harbor-trigger"
            variant="ghost"
            className="h-12 gap-3 border border-band bg-band px-4 text-band-foreground hover:-translate-x-[3px] hover:-translate-y-[3px] hover:bg-band hover:text-band-foreground hover:shadow-[4px_4px_0_var(--harbor-accent)] motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0"
            aria-label="Open Ask Harbor"
          />
        }
      >
        <HarborMark className="size-6 text-band-foreground" beacon="var(--harbor-sky)" /> Ask Harbor{' '}
        <ArrowUpRight className="text-sky" />
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>Ask Harbor</SheetTitle>
          <SheetDescription>Keep a question beside your workspace.</SheetDescription>
        </SheetHeader>
        <AssistantContents />
      </SheetContent>
    </Sheet>
  );
}

export function AdjacentAssistant() {
  const { setAssistantOpen } = useWorkspaceSession();
  return (
    <aside
      id="context-assistant"
      aria-label="Context assistant"
      className="flex h-full min-h-0 min-w-0 flex-col bg-card"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-lg tracking-[-0.5px] uppercase">
          <HarborMark className="size-6 text-primary" /> Ask Harbor
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close assistant"
          onClick={() => {
            setAssistantOpen(false);
            document.getElementById('ask-harbor-trigger')?.focus();
          }}
        >
          <X />
        </Button>
      </div>
      <AssistantContents />
    </aside>
  );
}

function AssistantContents() {
  const { setAssistantOpen } = useWorkspaceSession();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <ConversationDraft compact />
      <Link
        to="/chat"
        onClick={() => setAssistantOpen(false)}
        className="mt-4 inline-flex min-h-11 items-center justify-center border border-line text-sm text-primary hover:bg-secondary"
      >
        Continue in chat
      </Link>
      <p className="mt-2 text-center text-xs text-muted-foreground">This conversation carries over in this session.</p>
    </div>
  );
}
