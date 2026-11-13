'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {paymentRacePass, reservationRacePass, technicalErrors} = require('./r13-concurrency-invariants.cjs');

test('C4: exactly one payment and one audit event, no skipped fixture', () => {
  const valid = {statuses:[409,201],payments:{c:1,total:10000},invoice:{version:1,status:'paid',totalCents:10000},totalCents:10000,auditCount:1};
  assert.equal(paymentRacePass(valid),true);
  assert.equal(paymentRacePass({...valid,statuses:[]}),false);
  assert.equal(paymentRacePass({...valid,payments:{c:2,total:20000}}),false);
  assert.equal(paymentRacePass({...valid,auditCount:0}),false);
  assert.equal(paymentRacePass({...valid,invoice:{version:1,status:'issued',totalCents:10000}}),false);
});

test('C5: distinct order line identifiers and one successful whole-stock reservation', () => {
  const valid = {statuses:[200,409],reservations:[{orderLineId:51,qty:2}],qty:2,physical:2,lineIds:[51,52]};
  assert.equal(reservationRacePass(valid),true);
  assert.equal(reservationRacePass({...valid,lineIds:[51,51]}),false);
  assert.equal(reservationRacePass({...valid,statuses:[200,200]}),false);
  assert.equal(reservationRacePass({...valid,reservations:[{qty:2},{qty:2}]}),false);
  assert.equal(reservationRacePass({...valid,physical:1}),false);
});

test('C7: technical server errors, HTTP 5xx and transport failures independently fail', () => {
  const valid = {serverLog:'startup and healthy requests',httpObservations:[{status:200},{status:409}],transportFailures:[]};
  assert.equal(technicalErrors(valid).pass,true);
  assert.equal(technicalErrors({...valid,serverLog:'Prisma P1008 transaction timeout'}).pass,false);
  assert.equal(technicalErrors({...valid,httpObservations:[{status:503}]}).pass,false);
  assert.equal(technicalErrors({...valid,transportFailures:[{error:'ECONNRESET'}]}).pass,false);
});

test('C7 (R13.2): unexpected Prisma P2002 and P2010 in the server log fail the campaign', () => {
  const valid = {serverLog:'startup and healthy requests',httpObservations:[{status:200},{status:409}],transportFailures:[]};
  assert.equal(technicalErrors(valid).pass,true);
  assert.equal(technicalErrors({...valid,serverLog:'PrismaClientKnownRequestError P2002 unique constraint failed'}).pass,false);
  assert.equal(technicalErrors({...valid,serverLog:'PrismaClientKnownRequestError P2010 raw query failed'}).pass,false);
  // Un 409 métier attendu ne contient pas ces codes côté serveur : reste PASS.
  assert.equal(technicalErrors({...valid,httpObservations:[{status:409},{status:409}]}).pass,true);
});
