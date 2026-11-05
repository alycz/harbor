import { Button } from '@harbor/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@harbor/ui/components/sheet';
import { X } from 'lucide-react';

import { ConversationDraft } from './conversation-draft.tsx';
import { HarborMark } from './harbor-logo.tsx';
import { useWorkspaceSession } from './workspace-session.tsx';

const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';

/** The floating trigger: an ink pill that lifts a pixel under the pointer. */
const TRIGGER =
  'size-12 gap-2.5 rounded-full border border-white/10 bg-primary px-0 text-[14px] sm:h-11 sm:w-auto sm:pr-4 sm:pl-3 font-medium text-white shadow-[0_1px_2px_rgb(23_25_31/0.12),0_10px_28px_-8px_rgb(31_86_199/0.55)] transition-[translate,background-color,box-shadow] duration-200 hover:-translate-y-px hover:bg-[var(--harbor-accent-hover)] hover:text-white motion-reduce:hover:translate-y-0';

export function AgentPanel({ desktop }: { desktop: boolean }) {
  const { assistantOpen, setAssistantOpen } = useWorkspaceSession();
  const label = (
    <>
      <HarborMark className="size-5 text-white" beacon="var(--harbor-sky)" />
      <span className="hidden sm:inline">Ask Harbor</span>
      <kbd className="ml-0.5 hidden rounded-[4px] border border-white/25 px-1 py-px font-sans text-[11px] text-white/80 sm:inline">
        {SHORTCUT}
      </kbd>
    </>
  );
  if (desktop)
    return (
      <Button
        id="ask-harbor-trigger"
        variant="ghost"
        className={TRIGGER}
        aria-label={assistantOpen ? 'Close Ask Harbor' : 'Open Ask Harbor'}
        aria-expanded={assistantOpen}
        aria-controls="context-assistant"
        onClick={() => setAssistantOpen(!assistantOpen)}
      >
        {label}
      </Button>
    );
  return (
    <Sheet open={assistantOpen} onOpenChange={setAssistantOpen}>
      <SheetTrigger
        render={<Button id="ask-harbor-trigger" variant="ghost" className={TRIGGER} aria-label="Open Ask Harbor" />}
      >
        {label}
      </SheetTrigger>
      <SheetContent side="left" className="w-full gap-0 p-0 sm:max-w-[440px]">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-[15px] font-medium">
            <HarborMark className="size-5 text-primary" /> Ask Harbor
          </SheetTitle>
          <SheetDescription className="text-[13px]">Keep a question beside your workspace.</SheetDescription>
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
      className="flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-card"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border pr-2 pl-4">
        <h2 className="flex items-center gap-2 text-[14px] font-medium">
          <HarborMark className="size-5 text-primary" /> Ask Harbor
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close assistant"
          className="text-muted-foreground"
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
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <ConversationDraft compact />
    </div>
  );
}
