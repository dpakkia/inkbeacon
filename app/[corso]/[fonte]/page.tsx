import { notFound } from 'next/navigation';

import Studio from '@/components/studio';
import { CORSI, trovaCorso, type Fonte } from '@/lib/corsi';

export function generateStaticParams() {
  return CORSI.flatMap((corso) =>
    [...corso.fonti.map((f) => f.id), 'free'].map((fonte) => ({
      corso: corso.slug,
      fonte,
    })),
  );
}

/** Voce non libresca: gli schemi liberi esistono in ogni corso. */
const SCHEMI_LIBERI: Fonte = {
  id: 'free',
  tipo: 'schemi',
  shortTitle: 'Schemi liberi',
  title: 'Schemi liberi',
  author: '',
  unit: 'schemi',
  total: 0,
  leggibile: false,
};

export default async function PaginaFonte({
  params,
}: {
  params: Promise<{ corso: string; fonte: string }>;
}) {
  const { corso: slug, fonte: fonteId } = await params;
  const corso = trovaCorso(slug);
  if (!corso) notFound();

  const fonte =
    fonteId === 'free'
      ? SCHEMI_LIBERI
      : corso.fonti.find((f) => f.id === fonteId);
  if (!fonte) notFound();

  return <Studio corso={corso} fonte={fonte} />;
}
