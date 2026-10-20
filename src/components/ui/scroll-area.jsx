import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "../../lib/utils";

export function ScrollArea({ children, className }) {
  return (
    <ScrollAreaPrimitive.Root className={cn("overflow-hidden", className)}>
      <ScrollAreaPrimitive.Viewport className="h-full w-full">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex w-2.5 touch-none p-0.5">
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-muted/25" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
