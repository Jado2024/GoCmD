import Image from "next/image"

/** Logo SODEPI transmis pour ce projet : image officielle, non redessinée.
 * Les deux variantes utilisent les mêmes fichiers dans public/branding. */
export function SodepiSymbol({className = "", size = 40}: {className?: string; size?: number}) {
  return <Image
    src="/branding/sodepi-symbol.png" alt="" aria-hidden="true"
    width={Math.round(size * 395 / 449)} height={size}
    className={className} priority={false}
  />
}

export function SodepiLogo({className = "", priority = false}: {className?: string; priority?: boolean}) {
  return <Image
    src="/branding/sodepi-logo.png" alt="SODEPI"
    width={454} height={541} className={className} priority={priority}
  />
}
