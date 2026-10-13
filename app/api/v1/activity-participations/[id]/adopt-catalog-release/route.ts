import { catalogRoute } from "../../../../../../src/server/catalog/http";
import { CatalogParticipationWorkflow } from "../../../../../../src/server/workflows/catalog-participation";
import { AppError } from "../../../../../../src/shared/errors";
export const POST=catalogRoute(false,async({service,actor,params,request,key})=>{
 if(process.env.FEATURE_CATALOG_JOIN!=="true") throw new AppError("NOT_FOUND","目录跟踪尚未开放");
 const workflow=new CatalogParticipationWorkflow(service);
 return workflow.adopt({actor,idempotencyKey:key},params.id,await request.json());
});
