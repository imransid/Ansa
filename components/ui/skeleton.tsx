import { cn } from "cn"

// A grey block standing in for content that is still loading. Hidden from
// screen readers: whatever holds skeletons says "Loading..." in words
// (components/page-loading.tsx). The pulse stops for people who asked their
// system for less motion.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
