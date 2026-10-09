import { Request, Response, NextFunction } from 'express';
import { ApiSuccessResponse } from '../../shared/types';
import { reportsRepository } from './repository';
import { ReportFilters } from './types';
import { resolveReportScope } from './service';
import { canViewFnbCosts, FnbFilters } from './fnb';
import { departmentOperationalPerformance, fnbSalesPerformance } from './performance';
import { getTransactionHistoryDetail, listTransactionHistory, TransactionHistoryFilters } from './transactions';
import { financialReconciliationReport, shiftFinancialReport } from './financialTruth';

function filters(req: Request): ReportFilters { return req.query as unknown as ReportFilters; }
function scope(req: Request, allowMulti = false) { return resolveReportScope(req.user, req.query.branchId ? Number(req.query.branchId) : undefined, allowMulti); }
function ok(res: Response, data: unknown) { res.json({success:true,data} satisfies ApiSuccessResponse); }
async function currentDayFilters(sc:{organizationId:number;branchIds:number[]}, f:ReportFilters):Promise<ReportFilters>{
  if(f.businessDayId||f.from||f.to||sc.branchIds.length!==1) return f;
  const day=await reportsRepository.currentBusinessDay(sc);
  return {...f,businessDayId:day?.id ?? -1};
}

export class ReportsController {
  occupancyOptions=async(req:Request,res:Response,next:NextFunction)=>{try{ok(res,await reportsRepository.occupancyOptions(scope(req)));}catch(e){next(e);}};
  dashboard=async(req:Request,res:Response,next:NextFunction)=>{try{
    const sc=scope(req);
    const base=await reportsRepository.dashboard(sc,filters(req));
    const effective:ReportFilters={...filters(req),businessDayId:base.scope?.businessDayId??undefined};
    const financial=await financialReconciliationReport(sc,effective);
    ok(res,{...base,financial});
  }catch(e){next(e);}};
  sales=async(req:Request,res:Response,next:NextFunction)=>{try{const sc=scope(req);ok(res,await reportsRepository.sales(sc,await currentDayFilters(sc,filters(req))));}catch(e){next(e);}};
  financial=async(req:Request,res:Response,next:NextFunction)=>{try{const sc=scope(req);ok(res,await financialReconciliationReport(sc,await currentDayFilters(sc,filters(req))));}catch(e){next(e);}};
  fnb=async(req:Request,res:Response,next:NextFunction)=>{try{
    const sc=scope(req); const requested=req.query as unknown as FnbFilters & {period?:'current'|'previous'|'all'};
    const effective=requested.period==='all'?requested:await reportsRepository.fnbPeriod(sc,requested as FnbFilters);
    const [base,salesPerformance]=await Promise.all([reportsRepository.fnb(sc,effective,canViewFnbCosts(req.user)),fnbSalesPerformance(sc,effective)]);
    ok(res,{...base,salesPerformance,summary:{...base.summary,...salesPerformance.summary}});
  }catch(e){next(e);}};
  fnbOptions=async(req:Request,res:Response,next:NextFunction)=>{try{ok(res,await reportsRepository.fnbOptions(scope(req)));}catch(e){next(e);}};
  departments=async(req:Request,res:Response,next:NextFunction)=>{try{const sc=scope(req);ok(res,await departmentOperationalPerformance(sc,await currentDayFilters(sc,filters(req))));}catch(e){next(e);}};
  staff=async(req:Request,res:Response,next:NextFunction)=>{try{const sc=scope(req);ok(res,await reportsRepository.staff(sc,await currentDayFilters(sc,filters(req))));}catch(e){next(e);}};
  occupancy=async(req:Request,res:Response,next:NextFunction)=>{try{const sc=scope(req);ok(res,await reportsRepository.occupancy(sc,await currentDayFilters(sc,filters(req))));}catch(e){next(e);}};
  payments=async(req:Request,res:Response,next:NextFunction)=>{try{const sc=scope(req);ok(res,await reportsRepository.payments(sc,await currentDayFilters(sc,filters(req))));}catch(e){next(e);}};
  transactions=async(req:Request,res:Response,next:NextFunction)=>{try{ok(res,await listTransactionHistory(scope(req),req.query as unknown as TransactionHistoryFilters));}catch(e){next(e);}};
  transactionDetail=async(req:Request,res:Response,next:NextFunction)=>{try{const billId=Number(req.params.billId);ok(res,await getTransactionHistoryDetail(scope(req),billId));}catch(e){next(e);}};
  tax=async(req:Request,res:Response,next:NextFunction)=>{try{const sc=scope(req);ok(res,await reportsRepository.tax(sc,await currentDayFilters(sc,filters(req))));}catch(e){next(e);}};
  shifts=async(req:Request,res:Response,next:NextFunction)=>{try{const sc=scope(req);ok(res,await shiftFinancialReport(sc,await currentDayFilters(sc,filters(req))));}catch(e){next(e);}};
  inventory=async(req:Request,res:Response,next:NextFunction)=>{try{ok(res,await reportsRepository.inventory(scope(req),filters(req)));}catch(e){next(e);}};
  inventoryMovements=async(req:Request,res:Response,next:NextFunction)=>{try{ok(res,await reportsRepository.inventoryMovements(scope(req),filters(req)));}catch(e){next(e);}};
  purchasing=async(req:Request,res:Response,next:NextFunction)=>{try{ok(res,await reportsRepository.purchasing(scope(req),filters(req)));}catch(e){next(e);}};
  expenses=async(req:Request,res:Response,next:NextFunction)=>{try{const sc=scope(req);ok(res,await reportsRepository.expenses(sc,await currentDayFilters(sc,filters(req))));}catch(e){next(e);}};
  controls=async(req:Request,res:Response,next:NextFunction)=>{try{const sc=scope(req);ok(res,await reportsRepository.controls(sc,await currentDayFilters(sc,filters(req))));}catch(e){next(e);}};
  branches=async(req:Request,res:Response,next:NextFunction)=>{try{ok(res,await reportsRepository.branches(scope(req,true),filters(req)));}catch(e){next(e);}};
}
export const reportsController = new ReportsController();
