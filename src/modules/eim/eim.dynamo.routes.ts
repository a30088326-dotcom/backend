import { Router, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { StorageConflictError } from '../../storage/dynamodb';
import * as service from './eim.dynamo.service';
const router=Router();
const route=(fn:(req:Request)=>Promise<any>,status=200)=>async(req:Request,res:Response)=>{try{res.status(status).json({success:true,...await fn(req)});}catch(error){const code=error instanceof service.EimError?error.status:error instanceof ZodError?400:error instanceof StorageConflictError?409:500;res.status(code).json({success:false,message:code===500?'Unable to update EIM records.':error instanceof ZodError?'Enter valid EIM field values.':(error as Error).message});}};
router.get('/dashboard-stats',route(async()=>({data:await service.dashboard()})));
router.get('/hierarchy-config',route(async()=>({data:await service.hierarchyConfig()})));
router.put('/hierarchy-config',route(async req=>{await service.saveHierarchyConfig(req.body.configs);return{message:'Hierarchy config updated'};}));
router.get('/audit-logs',route(async()=>({data:await service.auditLogs()})));
for(const resource of Object.keys(service.resources)){
  router.get('/'+resource,route(async()=>({data:await service.list(resource)})));
  router.post('/'+resource,route(async req=>({data:await service.save(resource,req.body,req.user!.userId),message:'Created'}),201));
  router.put('/'+resource+'/:id',route(async req=>({data:await service.save(resource,req.body,req.user!.userId,String(req.params.id)),message:'Updated'})));
  router.delete('/'+resource+'/:id',route(async req=>{await service.remove(resource,String(req.params.id),req.user!.userId);return{message:'Deleted successfully'};}));
}
for(const resource of ['structures','geography'])router.put('/'+resource+'/:id/parent',route(async req=>({data:await service.parent(resource,String(req.params.id),req.body.parentId||null,req.user!.userId),message:'Parent updated'})));
// Never fall through to a legacy SQL handler when this provider owns the request.
router.use((_req,res)=>res.status(404).json({success:false,message:'Unknown EIM operation.'}));
export default router;
