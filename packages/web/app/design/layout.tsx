import type { Metadata } from "next"
import type { JSX, ReactNode } from "react"
import { DocumentShell } from "@/app/_components/document-shell"
import { generateSiteMetadata, siteViewport } from "@/app/_components/site-metadata"
import { defaultLocale, languageTag } from "@/i18n/config"

export const viewport = siteViewport

export function generateMetadata(): Promise<Metadata> {
  return generateSiteMetadata()
}

/** Root layout of the non-localized `/design` showcase (DESIGN.md §13). */
export default function DesignLayout({ children }: { readonly children: ReactNode }): JSX.Element {
  return <DocumentShell lang={languageTag(defaultLocale)}>{children}</DocumentShell>
}
