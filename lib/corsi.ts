/**
 * Registro dei corsi e delle loro fonti.
 *
 * Unica fonte di verita': prima gli id erano ripetuti nella pagina, nella route
 * dello stato di studio e in una route per ogni libro. Aggiungere un corso ora
 * significa toccare solo questo file.
 */

export type TipoFonte = 'libro' | 'analisi' | 'schemi';

export type Fonte = {
  id: string;
  tipo: TipoFonte;
  shortTitle: string;
  title: string;
  author: string;
  /** Nome dell'unita' di avanzamento: capitoli, pagine, film. */
  unit: string;
  total: number;
  /** true quando esiste il testo completo da leggere nell'app. */
  leggibile: boolean;
};

export type Corso = {
  slug: string;
  nome: string;
  descrizione: string;
  fonti: Fonte[];
};

export const CORSI: Corso[] = [
  {
    slug: 'corso-esempio',
    nome: 'Corso di esempio',
    descrizione: 'Un corso dimostrativo: sostituiscilo con i tuoi.',
    fonti: [
      {
        id: 'esempio',
        tipo: 'libro',
        shortTitle: 'Esempio',
        title: 'Come si studia un testo',
        author: 'Autore di esempio',
        unit: 'capitoli',
        total: 3,
        leggibile: true,
      },
    ],
  },
];

export const TUTTE_LE_FONTI: Fonte[] = CORSI.flatMap((corso) => corso.fonti);

export const ID_FONTI: string[] = TUTTE_LE_FONTI.map((fonte) => fonte.id);

export const TOTALI_FONTI: Record<string, number> = Object.fromEntries(
  TUTTE_LE_FONTI.map((fonte) => [fonte.id, fonte.total]),
);

export function trovaCorso(slug: string): Corso | undefined {
  return CORSI.find((corso) => corso.slug === slug);
}

export function trovaFonte(id: string): Fonte | undefined {
  return TUTTE_LE_FONTI.find((fonte) => fonte.id === id);
}

/** Corso a cui appartiene una fonte, per costruire i link e le briciole. */
export function corsoDiFonte(fonteId: string): Corso | undefined {
  return CORSI.find((corso) => corso.fonti.some((f) => f.id === fonteId));
}
