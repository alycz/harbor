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
        className="workspace-action border bg-card shadow-lg"
        aria-label={assistantOpen ? 'Close Ask Harbor' : 'Open Ask Harbor'}
        aria-expanded={assistantOpen}
        aria-controls="context-assistant"
        onClick={() => setAssistantOpen(!assistantOpen)}
      >
        <HarborMark className="mr-2 size-6 text-primary" /> Ask Harbor <ArrowUpRight className="ml-3 text-primary" />
      </Button>
    );
  return (
    <Sheet open={assistantOpen} onOpenChange={setAssistantOpen}>
      <SheetTrigger
        render={
          <Button
            id="ask-harbor-trigger"
            variant="outline"
            className="workspace-action border bg-card shadow-lg"
            aria-label="Open Ask Harbor"
          />
        }
      >
        <HarborMark className="mr-2 size-6 text-primary" /> Ask Harbor <ArrowUpRight className="ml-3 text-primary" />
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
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-xl font-semibold">Ask Harbor</h2>
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
        className="mt-4 min-h-11 rounded-lg py-3 text-center text-sm text-primary hover:underline"
      >
        Continue in chat
      </Link>
      <p className="text-center text-xs text-subtle">This conversation carries over in this session.</p>
    </div>
  );
}
