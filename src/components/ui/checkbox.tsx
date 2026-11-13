"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Case à cocher native utilisée dans la gestion des autorisations.
 * Une entrée HTML native préserve l'activation clavier, le focus et
 * l'association automatique avec les <label> englobants.
 */
type CheckboxProps = Omit<React.ComponentProps<"input">, "type"> & {
  onCheckedChange?: (checked: boolean) => void
}

function Checkbox({
  className,
  onChange,
  onCheckedChange,
  ...props
}: CheckboxProps) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-6 shrink-0 cursor-pointer rounded accent-primary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
      onChange={(event) => {
        onChange?.(event)
        onCheckedChange?.(event.currentTarget.checked)
      }}
    />
  )
}

export { Checkbox }
