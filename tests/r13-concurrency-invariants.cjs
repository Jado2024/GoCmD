'use strict';

function paymentRacePass({statuses, payments, invoice, totalCents, auditCount}) {
  return Array.isArray(statuses) && [...statuses].sort((a,b) => a-b).join(',') === '201,409'
    && payments?.c === 1 && payments?.total === totalCents
    && invoice?.version === 1 && invoice?.status === 'paid' && invoice?.totalCents === totalCents
    && auditCount === 1;
}

function reservationRacePass({statuses, reservations, qty, physical, lineIds}) {
  const reserved = reservations?.reduce((sum, row) => sum + Number(row.qty), 0);
  return Array.isArray(statuses) && [...statuses].sort((a,b) => a-b).join(',') === '200,409'
    && Array.isArray(lineIds) && lineIds.length === 2 && lineIds[0] !== lineIds[1]
    && reservations?.length === 1
    && Number.isFinite(qty) && qty > 0
    && Math.abs(reserved - qty) < 1e-7 && reserved <= physical + 1e-7;
}

function technicalErrors({serverLog, httpObservations, transportFailures}) {
  // R13.2 : P2002 (unicité) et P2010 (raw query) sont des signaux techniques
  // exigés par la mission §2 C7. Les 409 métier convertis par les routes API
  // n'écrivent PAS ces codes dans les journaux serveur : leur présence dans
  // srvLog caractérise donc une erreur Prisma non maîtrisée.
  const signals = serverLog.match(/SQLITE_BUSY|SQLITE_LOCKED|P1008|P2002|P2010|P2028|P2034|GOCMD_SQLITE_RETRY_EXHAUSTED|GOCMD_SQLITE_OUTCOME_UNCERTAIN/g) ?? [];
  const http5xx = httpObservations.filter(r => r.status >= 500);
  const failures = transportFailures.length;
  return {pass:signals.length === 0 && http5xx.length === 0 && failures === 0, signals, http5xx, failures};
}

module.exports = {paymentRacePass, reservationRacePass, technicalErrors};
