import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({ children }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/45 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-hairline bg-canvas p-6 shadow-quiet focus:outline-none">
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral">
          <X size={17} />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export const DialogClose = DialogPrimitive.Close;
