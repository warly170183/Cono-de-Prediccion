import path from 'path';

/**
 * Directorio de persistencia del diario, de las opciones registradas y del archivo micro.
 * En despliegues con disco efímero (Cloud Run, AI Studio) apunta JOURNAL_DIR a un volumen
 * persistente; además, el cliente rehidrata los ficheros desde Firestore (POST /api/journal/restore).
 */
export const JOURNAL_DIR = path.resolve(process.env.JOURNAL_DIR ?? path.join(process.cwd(), 'journal'));
