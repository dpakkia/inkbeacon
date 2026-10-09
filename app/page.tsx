import Link from 'next/link';

import { CORSI } from '@/lib/corsi';

export default function Home() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-16 font-ui text-ink md:py-24">
      <h1 className="font-heading text-[clamp(2rem,4vw,3rem)] font-medium leading-tight tracking-[-0.03em]">
        Piattaforma di studio
      </h1>
      <p className="mt-3 text-muted-ink">
        I tuoi corsi, i loro testi e gli schemi.
      </p>

      <ul className="mt-12 space-y-3">
        {CORSI.map((corso) => {
          const libri = corso.fonti.filter((f) => f.tipo === 'libro').length;
          return (
            <li key={corso.slug}>
              <Link
                href={`/${corso.slug}`}
                className="block rounded-xl border border-line bg-card/60 p-5 transition-colors hover:border-accent-strong hover:bg-card"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-heading text-xl font-medium">
                    {corso.nome}
                  </h2>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-ink">
                    {libri} {libri === 1 ? 'testo' : 'testi'}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-muted-ink">
                  {corso.descrizione}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
