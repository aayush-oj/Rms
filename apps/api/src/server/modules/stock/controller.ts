import { NextFunction, Request, Response } from 'express';
import { ForbiddenError, NotFoundError } from '../../shared/errors';
import { realtimePublisher } from '../../realtime/publisher';
import type { RealtimeEventType } from '../../realtime/events';
import { stockRepository } from './repository';
import { menuLinksForStock, setMenuLinksForStock } from './menuLinks';
import { setMenuDependencies } from './dependencyLinks';

function context(req:Request){
  if(!req.user?.organizationId||!req.user.activeBranchId) throw new ForbiddenError('Active tenant and branch context are required','MISSING_TENANT_CONTEXT');
  return {organizationId:req.user.organizationId,branchId:req.user.activeBranchId,userId:req.user.id,role:req.user.role,permissions:req.user.permissions,allowedBranchIds:req.user.allowedBranchIds};
}

function itemId(req:Request){const id=Number(req.params.id);if(!Number.isInteger(id)||id<=0) throw new NotFoundError('Stock item not found','STOCK_ITEM_NOT_FOUND');return id}
function menuItemId(req:Request){const id=Number(req.params.menuItemId);if(!Number.isInteger(id)||id<=0) throw new NotFoundError('Menu item not found','MENU_ITEM_NOT_FOUND');return id}

function publish(org:number,branch:number,type:RealtimeEventType,id:number,data:Record<string,unknown>={}){
  realtimePublisher.publish({type,organizationId:org,branchId:branch,entityType:'stock_item',entityId:id,data});
}

export const stockController={
  list:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);res.json({success:true,data:await stockRepository.listItems(c.organizationId,c.branchId)});}catch(error){next(error)}},
  get:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);const item=await stockRepository.getItem(itemId(req),c.organizationId,c.branchId);if(!item)throw new NotFoundError('Stock item not found','STOCK_ITEM_NOT_FOUND');res.json({success:true,data:item});}catch(error){next(error)}},
  create:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);const item=await stockRepository.createItem(c.organizationId,c.branchId,c.userId,req.body);publish(c.organizationId,c.branchId,'stock.created',item.id,{currentQuantity:item.currentQuantity});res.status(201).json({success:true,data:item});}catch(error){next(error)}},
  update:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);const item=await stockRepository.updateItem(itemId(req),c.organizationId,c.branchId,c.userId,req.body);publish(c.organizationId,c.branchId,'stock.updated',item.id,{currentQuantity:item.currentQuantity});res.json({success:true,data:item});}catch(error){next(error)}},
  stockIn:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);const item=await stockRepository.stockIn(itemId(req),c.organizationId,c.branchId,c.userId,req.body);publish(c.organizationId,c.branchId,'stock.changed',item.id,{currentQuantity:item.currentQuantity,source:'STOCK_IN'});res.json({success:true,data:item});}catch(error){next(error)}},
  adjust:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);const item=await stockRepository.adjust(itemId(req),c.organizationId,c.branchId,c.userId,req.body.newQuantity,req.body.reason);publish(c.organizationId,c.branchId,'stock.changed',item.id,{currentQuantity:item.currentQuantity,source:'ADJUSTMENT'});res.json({success:true,data:item});}catch(error){next(error)}},
  dependencies:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);res.json({success:true,data:await stockRepository.dependenciesForMenu(menuItemId(req),c.organizationId,c.branchId)});}catch(error){next(error)}},
  setDependencies:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);const id=menuItemId(req);await setMenuDependencies(id,c.organizationId,c.branchId,c.userId,req.body.dependencies);realtimePublisher.publish({type:'stock.dependencies_changed',organizationId:c.organizationId,branchId:c.branchId,entityType:'menu_item',entityId:id,data:{menuItemId:id}});res.json({success:true,data:await stockRepository.dependenciesForMenu(id,c.organizationId,c.branchId)});}catch(error){next(error)}},
  menuLinks:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);const id=itemId(req);res.json({success:true,data:await menuLinksForStock(id,c.organizationId,c.branchId)});}catch(error){next(error)}},
  setMenuLinks:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);const id=itemId(req);await setMenuLinksForStock(id,c.organizationId,c.branchId,c.userId,req.body.links);realtimePublisher.publish({type:'stock.dependencies_changed',organizationId:c.organizationId,branchId:c.branchId,entityType:'stock_item',entityId:id,data:{stockItemId:id}});res.json({success:true,data:await menuLinksForStock(id,c.organizationId,c.branchId)});}catch(error){next(error)}},
  availability:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);res.json({success:true,data:await stockRepository.availability(c.organizationId,c.branchId)});}catch(error){next(error)}},
  movements:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);const result=await stockRepository.movements(c.organizationId,c.branchId,req.query as any);res.json({success:true,data:result.items,meta:{total:result.total,limit:Number(req.query.limit||50),offset:Number(req.query.offset||0)}});}catch(error){next(error)}},
  transfer:async(req:Request,res:Response,next:NextFunction)=>{try{const c=context(req);const destination=Number(req.body.destinationBranchId);const privileged=c.role==='OWNER'||c.permissions.includes('admin:all')||c.permissions.includes('admin:branches:manage');if(!privileged&&!c.allowedBranchIds.includes(destination))throw new ForbiddenError('Destination branch is outside your authorized scope','UNAUTHORIZED_BRANCH_ACCESS');await stockRepository.transfer(c.organizationId,c.branchId,c.userId,req.body);publish(c.organizationId,c.branchId,'stock.changed',Number(req.body.sourceStockItemId),{source:'TRANSFER_OUT'});publish(c.organizationId,destination,'stock.changed',Number(req.body.destinationStockItemId),{source:'TRANSFER_IN'});res.json({success:true,data:{transferred:true}});}catch(error){next(error)}},
};
