import * as React from "react"

import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/async-view"
import { Caption } from "@/components/ui/prose-text"

/**
 * Panel — the side-drawer scaffold.
 *
 * Panels live inside a sheet/drawer/column that already scopes width and
 * background. The scaffold provides the vertical rhythm: a breathable
 * serif-titled header, a scrolling body, an optional sticky footer.
 *
 * Compose with the standard shadcn pattern:
 *
 *   <Panel>
 *     <PanelHeader>
 *       <PanelTitle>…</PanelTitle>
 *       <PanelDescription>…</PanelDescription>
 *       <PanelActions>…</PanelActions>
 *     </PanelHeader>
 *     <PanelBody>…</PanelBody>
 *     <PanelFooter>…</PanelFooter>
 *   </Panel>
 */

function Panel({
  className,
  loading,
  children,
  ...props
}: React.ComponentProps<"div"> & { loading?: boolean }) {
  return (
    <div
      data-slot="panel"
      className={cn("flex h-full min-h-0 flex-col", className)}
      {...props}
    >
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        children
      )}
    </div>
  )
}

function PanelHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "shrink-0 flex items-center justify-between gap-4 px-5 py-5 border-b border-border/60",
        className
      )}
      {...props}
    />
  )
}

function PanelHeaderText({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-header-text"
      className={cn("min-w-0 flex-1 flex flex-col gap-1", className)}
      {...props}
    />
  )
}

function PanelTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="panel-title"
      className={cn(
        "font-display font-normal text-lg leading-tight tracking-tight truncate",
        className
      )}
      {...props}
    />
  )
}

function PanelDescription({
  className,
  ...props
}: React.ComponentProps<typeof Caption>) {
  return (
    <Caption
      data-slot="panel-description"
      className={cn("text-xs leading-snug", className)}
      {...props}
    />
  )
}

function PanelActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-actions"
      className={cn("shrink-0 flex items-center gap-1.5", className)}
      {...props}
    />
  )
}

function PanelBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-body"
      className={cn(
        "flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4",
        className
      )}
      {...props}
    />
  )
}

function PanelFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-footer"
      className={cn(
        "shrink-0 flex items-center gap-2 px-5 py-3 border-t border-border/60",
        className
      )}
      {...props}
    />
  )
}

export {
  Panel,
  PanelHeader,
  PanelHeaderText,
  PanelTitle,
  PanelDescription,
  PanelActions,
  PanelBody,
  PanelFooter,
}
