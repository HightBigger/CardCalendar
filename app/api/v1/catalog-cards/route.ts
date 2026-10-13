import { privateRoute, privateQuery } from "../../../../src/server/catalog/private-http";
export const GET=privateRoute(({actor,service})=>privateQuery(actor,service,async tx=>(await tx.query('select id,issuer_name as bank,name,last4,bank_id as "bankId" from cards where user_id=$1 and status=\'active\' order by name,id',[actor.userId])).rows));
