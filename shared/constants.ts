/**
 * Costanti di dominio condivise fra server e SPA. Qui sta solo ciò che entrambi
 * usano davvero: i limiti che riguardano un lato solo (per esempio il primo
 * anno di `/installed-capacity`, che la SPA legge dal metadata) restano dove
 * sono nati.
 */

/**
 * Primo anno pubblicato dagli endpoint della generazione. Verificato con le
 * chiavi reali: `renewable-source-capacity` risponde con 832 righe per il 2000
 * e con un 406 per il 1999; la documentazione Terna dice la stessa cosa
 * ("data are represented by region and province from 2000 onwards").
 */
export const DATA_FIRST_YEAR = 2000;
