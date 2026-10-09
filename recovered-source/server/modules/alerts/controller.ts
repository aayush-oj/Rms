import { NextFunction, Request, Response } from 'express';
import { ApiSuccessResponse } from '../../shared/types';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { alertRepository } from './repository';
import { resolveAlertBranchScope, canViewAlert } from './access';

function ctx(req:Request){
  if(!req.user) throw new ForbiddenError('Authentication required','AUTH_REQUIRED');
  return req.user;
}
const id=(raw:string)=>{
  const value=Number(raw);
  if(!Number.isInteger(value)||value<=0) throw new BadRequestError('Valid alert ID is required','INVALID_ALERT_ID');
  return value;
};

export class AlertsController {
  list=async(req:Request,res:Response,next:NextFunction)=>{
    try{
      const user=ctx(req);
      const filters=req.query as any;
      const requested=filters.branchId?Number(filters.branchId):undefined;
      const data=await alertRepository.list(user.organizationId,resolveAlertBranchScope(user,requested),user,filters);
      res.json({success:true,data:data.items,meta:{total:data.total,limit:Number(filters.limit||50),offset:Number(filters.offset||0)}} satisfies ApiSuccessResponse<any>);
    }catch(error){next(error)}
  };

  get=async(req:Request,res:Response,next:NextFunction)=>{
    try{
      const user=ctx(req);
      const alert=await alertRepository.getById(id(req.params.id),user.organizationId,user.allowedBranchIds);
      if(!alert||!canViewAlert(user,alert)) throw new NotFoundError('Alert not found','ALERT_NOT_FOUND');
      res.json({success:true,data:alert} satisfies ApiSuccessResponse<any>);
    }catch(error){next(error)}
  };

  settings=async(req:Request,res:Response,next:NextFunction)=>{
    try{
      const user=ctx(req);
      const branchId=req.query.branchId?Number(req.query.branchId):user.activeBranchId;
      resolveAlertBranchScope(user,branchId);
      const data=await alertRepository.getSettings(user.organizationId,branchId);
      res.json({success:true,data} satisfies ApiSuccessResponse<any>);
    }catch(error){next(error)}
  };

  updateSettings=async(req:Request,res:Response,next:NextFunction)=>{
    try{
      const user=ctx(req);
      const branchId=req.body.branchId?Number(req.body.branchId):user.activeBranchId;
      resolveAlertBranchScope(user,branchId);
      const body={...req.body};
      delete body.branchId;
      const data=await alertRepository.updateSettings(user.organizationId,branchId,body);
      res.json({success:true,data} satisfies ApiSuccessResponse<any>);
    }catch(error){next(error)}
  };
}

export const alertsController=new AlertsController();
