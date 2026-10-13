import { privateRoute,privateQuery } from "../../../../../../src/server/catalog/private-http";
import { AppError } from "../../../../../../src/shared/errors";
export const GET=privateRoute(async({queries,service,actor,params})=>privateQuery(actor,service,async tx=>(await queries.detail(tx,actor.userId,params.id)).periods));
