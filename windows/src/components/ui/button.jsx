import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "bg-coral text-white active:bg-coral-active",
        secondary: "border border-hairline bg-canvas text-ink active:bg-surface-card",
        ghost: "bg-transparent text-muted active:bg-surface-card active:text-ink",
        dark: "bg-dark-elevated text-canvas active:bg-[#302d29]",
        danger: "border border-danger/35 bg-transparent text-[#f4b5aa] active:bg-danger/15",
      },
      size: {
        default: "h-10",
        sm: "h-9 min-h-9 px-3 text-xs",
        icon: "h-10 w-10 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const Button = React.forwardRef(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

export { Button, buttonVariants };
