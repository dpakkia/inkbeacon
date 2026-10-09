import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CORSI, trovaCorso } from '@/lib/corsi';

export function generateStaticParams() {
  return CORSI.map((corso) => ({ corso: corso.slug }));
}

const ETICHETTA_TIPO = {
  libro: 'Testo',
  analisi: 'Analisi',
  schemi: 'Schemi',
} as const;

export default async function PaginaCorso({
  params,
}: {
  params: Promise<{ corso: string }>;
}) {
  const { corso: slug } = await params;
  const corso = trovaCorso(slug);
  if (!corso) notFound();

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-16 font-ui text-ink md:py-24">
      <Link
        href="/"
        className="text-[11px] text-muted-ink transition-colors hover:text-ink"
      >
        ← Tutti i corsi
      </Link>

      <h1 className="mt-6 font-heading text-[clamp(1.8rem,3.4vw,2.6rem)] font-medium leading-tight tracking-[-0.03em]">
        {corso.nome}
      </h1>
      <p className="mt-3 text-muted-ink">{corso.descrizione}</p>

      <ul className="mt-12 space-y-3">
        {corso.fonti.map((fonte) => (
          <li key={fonte.id}>
            <Link
              href={`/${corso.slug}/${fonte.id}`}
              className="block rounded-xl border border-line bg-card/60 p-5 transition-colors hover:border-accent-strong hover:bg-card"
            >
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-heading text-lg font-medium">
                  {fonte.title}
                </h2>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-ink">
                  {ETICHETTA_TIPO[fonte.tipo]}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted-ink">
                {fonte.author}
                {fonte.author && ' · '}
                {fonte.total} {fonte.unit}
                {!fonte.leggibile && ' · testo non ancora disponibile'}
              </p>
            </Link>
          </li>
        ))}

        <li>
          <Link
            href={`/${corso.slug}/free`}
            className="block rounded-xl border border-dashed border-line p-5 text-sm text-muted-ink transition-colors hover:border-accent-strong hover:text-ink"
          >
            Schemi liberi — mappe non legate a un capitolo
          </Link>
        </li>
      </ul>
    </main>
  );
}
