/**
 * The frame for a legal page: a title, a "last updated" line, and prose
 * with sane measure and heading rhythm. Content is plain JSX in each page.
 */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl py-10 sm:py-14">
      <h1 className="display">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated {updated}</p>
      <div className="prose-legal mt-8 space-y-6 text-[15px] leading-relaxed [&_h2]:mt-10 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mt-6 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_a]:underline [&_a]:underline-offset-4 [&_p]:text-foreground/90">
        {children}
      </div>
    </article>
  )
}
