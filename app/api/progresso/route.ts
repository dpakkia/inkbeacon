/**
 * Percentuali di avanzamento per corso.
 *
 * Lo stato di studio e' salvato per fonte; un corso pero' puo' averne piu'
 * d'una. Qui le fonti si sommano in unita', non in medie: un capitolo e una
 * pagina non pesano uguale, e una media delle percentuali darebbe alla fonte
 * piu' corta lo stesso peso di un manuale da centinaia di pagine.
 */

import { CORSI } from '@/lib/corsi';
import { readState } from '@/lib/stato-studio';
import {
  hasStudioAccess,
  isBlobConfigured,
  isStudioConfigured,
} from '@/lib/studio-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Quota = { fatte: number; totale: number; percentuale: number };

function quota(fatte: number, totale: number): Quota {
  return {
    fatte,
    totale,
    // un decimale: due sono rumore su un manuale di 336 pagine
    percentuale: totale > 0 ? Math.round((fatte / totale) * 1000) / 10 : 0,
  };
}

function somma(quote: Quota[]): Quota {
  return quota(
    quote.reduce((acc, q) => acc + q.fatte, 0),
    quote.reduce((acc, q) => acc + q.totale, 0),
  );
}

export async function GET(request: Request) {
  if (!isStudioConfigured() || !isBlobConfigured()) {
    return Response.json(
      { error: 'Sincronizzazione server non configurata.' },
      { status: 503 },
    );
  }
  if (!(await hasStudioAccess(request))) {
    return Response.json({ error: 'Accesso richiesto.' }, { status: 401 });
  }

  let stato: Awaited<ReturnType<typeof readState>>;
  try {
    stato = await readState();
  } catch (error) {
    console.error('Unable to read study state from Vercel Blob', error);
    return Response.json(
      { error: 'Impossibile leggere i dati di studio.' },
      { status: 502 },
    );
  }

  const corsi = CORSI.map((corso) => {
    const fonti = corso.fonti.map((fonte) => {
      const lettura = quota(stato.progress[fonte.id] ?? 0, fonte.total);
      // le unita' spuntate sopravvivono a una reimportazione che accorcia il
      // libro: senza il taglio si potrebbe leggere piu' del 100%
      const completate = quota(
        Math.min(stato.completedUnits[fonte.id]?.length ?? 0, fonte.total),
        fonte.total,
      );
      return {
        id: fonte.id,
        titolo: fonte.title,
        autore: fonte.author,
        unita: fonte.unit,
        lettura,
        completate,
      };
    });

    return {
      slug: corso.slug,
      nome: corso.nome,
      lettura: somma(fonti.map((f) => f.lettura)),
      completate: somma(fonti.map((f) => f.completate)),
      fonti,
    };
  });

  return Response.json(
    {
      aggiornatoIl: stato.updatedAt,
      inizializzato: stato.initialized,
      corsi,
      totale: {
        lettura: somma(corsi.map((c) => c.lettura)),
        completate: somma(corsi.map((c) => c.completate)),
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
