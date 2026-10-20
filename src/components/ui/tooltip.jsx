import * as TooltipPrimitive from "@radix-ui/react-tooltip";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ children, label }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={7}
          className="z-50 rounded-md bg-ink px-2.5 py-1.5 text-xs text-canvas shadow-quiet"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-ink" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
